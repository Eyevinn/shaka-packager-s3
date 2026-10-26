import path, { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, unlinkSync } from 'node:fs';
import { readdir, mkdir } from 'node:fs/promises';
import { createS3cmdArgs, toUrl, toUrlOrUndefined } from './util';
import {
  EncryptionOptions,
  createEncryptionArgs,
  redactArgs,
  redactKeyMaterial,
  validateEncryptionOptions
} from './encryption';
import mv from 'mv';

const DEFAULT_STAGING_DIR = '/tmp/data';

/**
 * Upper bound for output we buffer from a spawned child process.
 *
 * spawnSync kills the child and fails with ENOBUFS as soon as a piped stdio
 * stream passes `maxBuffer`, which defaults to 1 MiB. Transfer and packaging
 * tools happily write more than that (per-file transfer lines, packager
 * progress and warnings), so give them room instead of taking the default.
 * See SpawnSyncOptions.maxBuffer in
 * node_modules/@types/node/child_process.d.ts:1398.
 */
const MAX_OUTPUT_BUFFER = 256 * 1024 * 1024;

export type Input = {
  type: 'audio' | 'video' | 'text';
  key: string;
  filename: string;
  hlsName?: string;
};

export interface PackageFormatOptions {
  hlsOnly?: boolean;
  dashOnly?: boolean;
  segmentSingleFile?: boolean;
  segmentSingleFileTemplate?: string;
  segmentDuration?: number;
  dashManifestName?: string;
  hlsManifestName?: string;
  tsOutput?: boolean;
  iframePlaylists?: boolean;
}

export interface PackageOptions {
  inputs: Input[];
  source?: string;
  dest: string;
  stagingDir?: string;
  noImplicitAudio?: boolean;
  packageFormatOptions?: PackageFormatOptions;
  encryption?: EncryptionOptions;
  shakaExecutable?: string;
  serviceAccessToken?: string;
  s3EndpointUrl?: string;
}

function validateOptions(opts: PackageOptions) {
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
  if (opts.encryption) {
    validateEncryptionOptions(opts.encryption, {
      hlsEnabled: opts.packageFormatOptions?.dashOnly !== true
    });
  }
}

export async function doPackage(opts: PackageOptions) {
  validateOptions(opts);
  const stagingDir = await prepare(opts.stagingDir);
  await createPackage({ ...opts, stagingDir });
  if (toUrl(opts.dest).protocol === 's3:') {
    // We don't want to upload source files to S3
    await removeDownloadedFiles(opts.inputs, stagingDir);
  }
  await uploadPackage(toUrl(opts.dest), stagingDir, opts.s3EndpointUrl);
  await cleanup(stagingDir);
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

export async function cleanup(stagingDir: string) {
  console.log(`Cleaning up staging directory: ${stagingDir}`);
  await rmSync(stagingDir, { recursive: true, force: true });
}

export async function download(
  input: Input,
  source?: URL,
  stagingDir?: string,
  serviceAccessToken?: string,
  endpointUrl?: string
): Promise<string> {
  let sourceURL;
  let inputFileURL;
  if (input.filename.includes('://')) {
    console.log('input.filename has an absolute URL:', input.filename);
    inputFileURL = toUrlOrUndefined(input.filename);
  }

  if (inputFileURL) {
    sourceURL = inputFileURL;
  } else if (source) {
    sourceURL = source;
  } else {
    return input.filename;
  }
  if (!sourceURL.protocol || sourceURL.protocol === 'file:') {
    return path.resolve(sourceURL.pathname || '.', input.filename);
  }
  if (!stagingDir) {
    throw new Error('Staging directory required for remote download');
  }
  if (sourceURL.protocol === 's3:') {
    let sourceFileS3URL;
    if (inputFileURL) {
      sourceFileS3URL = inputFileURL;
    } else {
      sourceFileS3URL = new URL(
        join(sourceURL.pathname, input.filename),
        sourceURL
      );
    }
    const localFilename = join(
      stagingDir,
      inputFileURL ? path.basename(input.filename) : input.filename
    );
    const args = createS3cmdArgs(
      [
        'cp',
        // Transfer progress is written continuously to stdout and can grow
        // past the spawnSync output buffer on a large file, which fails the
        // download with ENOBUFS. Errors are still reported.
        '--only-show-errors',
        sourceFileS3URL.toString(),
        localFilename
      ],
      endpointUrl
    );
    const { status, stderr } = spawnSync('aws', args);
    if (status !== 0) {
      if (stderr) {
        console.log(stderr.toString());
      }
      throw new Error('Download failed');
    }
    console.log(`Downloaded ${input.filename} to ${localFilename}`);
    return localFilename;
  } else if (
    sourceURL.protocol === 'http:' ||
    sourceURL.protocol === 'https:'
  ) {
    let sourceFileURL;
    if (inputFileURL) {
      sourceFileURL = inputFileURL;
    } else {
      const baseUrl = sourceURL.href.endsWith('/')
        ? sourceURL.href
        : sourceURL.href + '/';
      const filePath = input.filename.startsWith('/')
        ? input.filename.substring(1)
        : input.filename;
      sourceFileURL = new URL(filePath, baseUrl);
    }
    const localFilename = join(stagingDir, path.basename(input.filename));
    const auth: string[] = [];
    if (serviceAccessToken) {
      auth.push('-H');
      auth.push(`x-jwt: Bearer ${serviceAccessToken}`);
    }
    const { status, stderr, error } = spawnSync(
      'curl',
      auth.concat([
        // The progress meter is written continuously to stderr and can grow
        // past the spawnSync output buffer on a long download, which fails
        // the download with ENOBUFS. -S keeps error messages.
        '-sS',
        '-o',
        localFilename,
        sourceFileURL.toString()
      ])
    );
    if (status !== 0) {
      if (error) {
        console.error(`Download failed: ${error.message}`);
      } else {
        console.error(`Download failed with exit code ${status}`);
        console.log(stderr.toString());
      }
      throw new Error('Download failed');
    }
    console.log(`Downloaded ${input.filename} to ${localFilename}`);
    return localFilename;
  } else {
    const protocol = sourceURL.protocol;
    throw new Error(`Unsupported protocol for download: ${protocol}`);
  }
}

async function removeDownloadedFiles(inputs: Input[], stagingDir: string) {
  console.log(`Removing downloaded files from ${stagingDir}`);
  for (const input of inputs) {
    let inputFileURL;
    if (input.filename.includes('://')) {
      inputFileURL = toUrlOrUndefined(input.filename);
    }
    const localFilename = join(
      stagingDir,
      inputFileURL ? path.basename(input.filename) : input.filename
    );
    console.log(`Removing ${localFilename}`);
    if (existsSync(localFilename)) {
      unlinkSync(localFilename);
    } else {
      console.log(`File not found: ${localFilename}`);
    }
  }
}

async function moveFile(src: string, dest: string) {
  return new Promise((resolve, reject) => {
    mv(src, dest, (err) => (err ? reject(err) : resolve(dest)));
  });
}

export async function uploadPackage(
  dest: URL,
  stagingDir: string,
  s3EndpointUrl?: string
) {
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
    console.log(`Uploading package to ${dest.toString()}`);
    const args = createS3cmdArgs(
      [
        'cp',
        '--recursive',
        // One progress line per file, so a package with many segments writes
        // far more than the spawnSync output buffer holds and the upload
        // fails with ENOBUFS. Errors are still written to stderr.
        '--only-show-errors',
        stagingDir,
        dest.toString()
      ],
      s3EndpointUrl
    );
    const { status, stderr, error } = spawnSync('aws', args, {
      // Keep stderr so a failing upload can be diagnosed, and allow it more
      // than the 1 MiB default before spawnSync gives up with ENOBUFS.
      stdio: ['ignore', 'ignore', 'pipe'],
      maxBuffer: MAX_OUTPUT_BUFFER
    });
    if (status !== 0) {
      if (error) {
        console.error(`Upload failed: ${error.message}`);
      } else {
        console.error(`Upload failed with exit code ${status}`);
      }
      if (stderr) {
        console.error(stderr.toString());
      }
      throw new Error('Upload failed');
    }
    console.log(`Uploaded package to ${dest.toString()}`);
  } else {
    throw new Error(`Unsupported protocol for upload: ${dest.protocol}`);
  }
}

export async function createPackage(opts: PackageOptions) {
  const {
    inputs,
    source,
    stagingDir,
    noImplicitAudio,
    serviceAccessToken,
    s3EndpointUrl
  } = opts;
  const sourceUrl = toUrlOrUndefined(source);
  const downloadedInputs: Input[] = await Promise.all(
    inputs.map(async (input) => {
      const filename = await download(
        input,
        sourceUrl,
        stagingDir,
        serviceAccessToken,
        s3EndpointUrl
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
    opts.packageFormatOptions,
    opts.encryption
  );
  // Never log raw key material, see redactArgs() in ./encryption
  console.log(redactArgs(args));
  const shaka = opts.shakaExecutable || 'packager';
  const { status, stderr, error } = spawnSync(shaka, args, {
    cwd: stagingDir,
    // The packager logs progress and warnings for the whole run; without this
    // a long job is killed with ENOBUFS once the default 1 MiB is filled.
    maxBuffer: MAX_OUTPUT_BUFFER
  });
  if (status !== 0) {
    if (error) {
      console.error(`Packager failed: ${redactKeyMaterial(error.message)}`);
    } else {
      console.error(`Packager failed with exit code ${status}`);
      console.error(redactKeyMaterial(stderr.toString()));
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
 * @param encryption Raw key encryption options, output is unencrypted if omitted
 */
export function createShakaArgs(
  inputs: Input[],
  noImplicitAudio: boolean,
  packageFormatOptions?: PackageFormatOptions,
  encryption?: EncryptionOptions
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
        if (packageFormatOptions?.tsOutput) {
          const segmentTemplate = join(playlistName, '$Number$.ts');
          streamOptions.push(`segment_template=${segmentTemplate}`);
        } else {
          const initSegment = join(playlistName, 'init.mp4');
          const segmentTemplate = join(playlistName, '$Number$.m4s');
          streamOptions.push(
            `init_segment=${initSegment}`,
            `segment_template=${segmentTemplate}`
          );
        }
      }
      if (packageFormatOptions?.iframePlaylists) {
        streamOptions.push(`iframe_playlist_name=iframe-${input.key}.m3u8`);
      }
      cmdInputs.push(streamOptions.join(','));
    }
    if (input.type === 'text') {
      const playlistName = `text-${input.key}`;
      const playlist = `${playlistName}.m3u8`;
      const segmentTemplate = join(playlistName, '$Number$.vtt');
      const streamOptions = [
        `in=${input.filename}`,
        'stream=text',
        `segment_template=${segmentTemplate}`,
        `playlist_name=${playlist}`,
        'hls_group_id=text',
        ...(input.hlsName ? [`hls_name=${input.hlsName}`] : [])
      ];
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
      `hls_name=${inputForAudio.hlsName || 'defaultaudio'}`
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
      const segmentTemplate = packageFormatOptions?.tsOutput
        ? 'audio/$Number$.aac'
        : 'audio/$Number$.m4s';

      if (packageFormatOptions?.tsOutput) {
        streamOptions.push(`segment_template=${segmentTemplate}`);
      } else {
        streamOptions.push(
          `init_segment=${playlistName}/init.mp4`,
          `segment_template=${segmentTemplate}`
        );
      }
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
  cmdInputs.push(
    ...createEncryptionArgs(encryption, {
      hlsEnabled: packageFormatOptions?.dashOnly !== true
    })
  );
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
