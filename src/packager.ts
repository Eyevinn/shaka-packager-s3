import path, { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { readdir, mkdir } from 'node:fs/promises';
import { toUrl, toUrlOrUndefined } from './util';
import mv from 'mv';

const DEFAULT_STAGING_DIR = '/tmp/data';

export type Input = {
  type: 'audio' | 'video';
  key: string;
  filename: string;
};

export interface PackageFormatOptions {
  hlsOnly?: boolean;
  dashOnly?: boolean;
  segmentSingleFile?: boolean;
  segmentSingleFileTemplate?: string;
  segmentDuration?: number;
  dashManifestName?: string;
  hlsManifestName?: string;
}

export interface PackageOptions {
  inputs: Input[];
  source?: string;
  dest: string;
  stagingDir?: string;
  noImplicitAudio?: boolean;
  packageFormatOptions?: PackageFormatOptions;
  shakaExecutable?: string;
  serviceAccessToken?: string;
}

function validateOptios(opts: PackageOptions) {
  if (
    opts?.packageFormatOptions?.hlsOnly &&
    opts?.packageFormatOptions?.dashOnly
  ) {
    throw new Error('Cannot disable both hls and dash');
  }
  if (
    opts?.packageFormatOptions?.segmentSingleFileTemplate &&
    opts?.packageFormatOptions?.segmentSingleFileTemplate.indexOf('$KEY$') ===
      -1
  ) {
    throw new Error('segmentSingleFileTemplate must contain $KEY$');
  }
}

export async function doPackage(opts: PackageOptions) {
  validateOptios(opts);
  const stagingDir = await prepare(opts.stagingDir);
  await createPackage({ ...opts, stagingDir });
  await uploadPackage(toUrl(opts.dest), stagingDir);
}

export async function prepare(
  stagingDir = DEFAULT_STAGING_DIR
): Promise<string> {
  const jobId = Math.random().toString(36).substring(7);
  const jobDir = join(stagingDir, jobId);
  if (!existsSync(jobDir)) {
    mkdirSync(jobDir, { recursive: true });
  }
  return jobDir;
}

export async function download(
  input: Input,
  source?: URL,
  stagingDir?: string,
  serviceAccessToken?: string
): Promise<string> {
  if (!source) {
    return input.filename;
  }
  if (!source.protocol || source.protocol === 'file:') {
    return path.resolve(source?.pathname || '.', input.filename);
  }
  if (!stagingDir) {
    throw new Error('Staging directory required for remote download');
  }

  if (source.protocol === 's3:') {
    const sourceFile = new URL(join(source.pathname, input.filename), source);
    const localFilename = join(stagingDir, input.filename);
    const { status, stderr } = spawnSync('aws', [
      's3',
      'cp',
      sourceFile.toString(),
      localFilename
    ]);
    if (status !== 0) {
      if (stderr) {
        console.log(stderr.toString());
      }
      throw new Error('Download failed');
    }
    console.log(`Downloaded ${input.filename} to ${localFilename}`);
    return localFilename;
  } else if (source.protocol === 'http:' || source.protocol === 'https:') {
    const localFilename = join(stagingDir, path.basename(input.filename));
    const auth: string[] = [];
    if (serviceAccessToken) {
      auth.push('-H');
      auth.push(`x-jwt: Bearer ${serviceAccessToken}`);
    }
    const { status, stdout, stderr } = spawnSync(
      'curl',
      auth.concat([
        '-v',
        '-o',
        localFilename,
        source.href.replace(/\/$/, '') + input.filename
      ])
    );
    if (stderr) {
      console.log(stderr.toString());
    }
    if (status !== 0) {
      throw new Error('Download failed');
    }
    console.log(`Downloaded ${input.filename} to ${localFilename}`);
    return localFilename;
  } else {
    throw new Error(`Unsupported protocol for download: ${source.protocol}`);
  }
}

async function moveFile(src: string, dest: string) {
  return new Promise((resolve, reject) => {
    mv(src, dest, (err) => (err ? reject(err) : resolve(dest)));
  });
}

export async function uploadPackage(dest: URL, stagingDir: string) {
  if (!dest.protocol || dest.protocol === 'file:') {
    await mkdir(dest.pathname, { recursive: true });
    const files = await readdir(stagingDir);
    await Promise.all(
      files.map((file) =>
        moveFile(join(stagingDir, file), join(dest.pathname, file))
      )
    );
    return;
  }
  if (dest.protocol === 's3:') {
    const { status, stderr } = spawnSync('aws', [
      's3',
      'cp',
      '--recursive',
      stagingDir,
      dest.toString()
    ]);
    if (status !== 0) {
      if (stderr) {
        console.log(stderr.toString());
      }
      throw new Error('Upload failed');
    }
    console.log(`Uploaded package to ${dest.toString()}`);
  } else {
    throw new Error(`Unsupported protocol for upload: ${dest.protocol}`);
  }
}

export async function createPackage(opts: PackageOptions) {
  const { inputs, source, stagingDir, noImplicitAudio, serviceAccessToken } =
    opts;
  const sourceUrl = toUrlOrUndefined(source);
  const downloadedInputs: Input[] = await Promise.all(
    inputs.map(async (input) => {
      const filename = await download(
        input,
        sourceUrl,
        stagingDir,
        serviceAccessToken
      );
      return {
        ...input,
        filename
      } as Input;
    })
  );

  const args = createShakaArgs(
    downloadedInputs,
    noImplicitAudio === true,
    opts.packageFormatOptions
  );
  console.log(args);
  const shaka = opts.shakaExecutable || 'packager';
  const { status, stderr, error } = spawnSync(shaka, args, {
    cwd: stagingDir
  });
  if (status !== 0) {
    if (error) {
      console.error(`Packager failed: ${error.message}`);
    } else {
      console.error(`Packager failed with exit code ${status}`);
      console.error(stderr.toString());
    }
    throw new Error('Packager failed');
  }
}

/**
 * Create shaka commandline arguments
 *
 * @param inputs List of inputs, filename needs to be a local path
 * @param noImplicitAudio Should we use first video file as audio source if no audio input is provided
 * @param packageFormatOptions Options for package format
 */
export function createShakaArgs(
  inputs: Input[],
  noImplicitAudio: boolean,
  packageFormatOptions?: PackageFormatOptions
): string[] {
  const cmdInputs: string[] = [];

  inputs.forEach((input: Input) => {
    if (input.type === 'video') {
      const playlistName = `video-${input.key}`;
      const playlist = `${playlistName}.m3u8`;
      const streamOptions = [
        `in=${input.filename}`,
        'stream=video',
        `playlist_name=${playlist}`
      ];
      if (packageFormatOptions?.segmentSingleFile) {
        const segmentName =
          packageFormatOptions.segmentSingleFileTemplate?.replace(
            '$KEY$',
            input.key
          ) || `${playlistName}.mp4`;
        streamOptions.push(`out=${segmentName}`);
      } else {
        const initSegment = join(playlistName, 'init.mp4');
        const segmentTemplate = join(playlistName, '$Number$.m4s');
        streamOptions.push(
          `init_segment=${initSegment}`,
          `segment_template=${segmentTemplate}`
        );
      }
      cmdInputs.push(streamOptions.join(','));
    }
  });

  const inputForAudio = getInputForAudio(inputs, noImplicitAudio);

  if (inputForAudio) {
    const playlistName = `audio`;
    const playlist = `${playlistName}.m3u8`;
    const fileForAudio = inputForAudio.filename;
    const streamOptions = [
      `in=${fileForAudio}`,
      'stream=audio',
      `playlist_name=${playlist}`,
      'hls_group_id=audio',
      'hls_name=defaultaudio'
    ];
    if (packageFormatOptions?.segmentSingleFile) {
      // Ensure non-duplicate key, to ensure unique segment file name
      const key = inputs.find(
        (input) => input.type === 'video' && input.key == inputForAudio.key
      )
        ? `audio-${inputForAudio.key}`
        : inputForAudio?.key;
      const segmentName =
        packageFormatOptions.segmentSingleFileTemplate?.replace('$KEY$', key) ||
        `${playlistName}.mp4`;
      streamOptions.push(`out=${segmentName}`);
    } else {
      const segmentTemplate = 'audio/' + '$Number$.m4s';
      streamOptions.push(
        `init_segment=${playlistName}/init.mp4`,
        `segment_template=${segmentTemplate}`
      );
    }
    cmdInputs.push(streamOptions.join(','));
  } else {
    console.log('No audio input found');
  }
  if (packageFormatOptions?.dashOnly !== true) {
    cmdInputs.push(
      '--hls_master_playlist_output',
      packageFormatOptions?.hlsManifestName || 'index.m3u8'
    );
  }
  if (packageFormatOptions?.hlsOnly !== true) {
    cmdInputs.push(
      '--generate_static_live_mpd',
      '--mpd_output',
      packageFormatOptions?.dashManifestName || 'manifest.mpd'
    );
  }
  if (packageFormatOptions?.segmentDuration) {
    cmdInputs.push(
      '--segment_duration',
      packageFormatOptions.segmentDuration.toString()
    );
  }
  return cmdInputs;
}

function getInputForAudio(
  inputs: Input[],
  noImplicitAudio: boolean
): Input | undefined {
  if (noImplicitAudio) {
    return inputs.find((input) => input.type === 'audio');
  }
  return (
    inputs.find((input) => input.type === 'audio') ||
    inputs.find((input) => input.type === 'video')
  );
}
