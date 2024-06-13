import path, { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { readdir, rename, mkdir } from 'node:fs/promises';
import { toUrl, toUrlOrUndefined } from './util';

const DEFAULT_STAGING_DIR = '/tmp/data';

export type Input = {
  type: 'audio' | 'video';
  key: string;
  filename: string;
};

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
): Promise<string> {

  if (!source) {
    return input.filename;
  }
  if (!source.protocol || source.protocol === 'file:') {
    return path.resolve(source?.pathname || '.', input.filename);
  }

  if (source.protocol === 's3:') {
    const sourceFile = new URL(join(source.pathname, input.filename), source);
    const localFilename = join(stagingDir!, input.filename);
    const { status, stdout, stderr } = spawnSync('aws', [
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
    return localFilename;
  } else {
    throw new Error(`Unsupported protocol for download: ${source.protocol}`);
  }

}

export async function uploadPackage(dest: URL, stagingDir: string) {
  if (!dest.protocol || dest.protocol === 'file:') {
    await mkdir(dest.pathname, { recursive: true });
    const files = await readdir(stagingDir);
    await Promise.all(
      files.map((file) =>
        rename(join(stagingDir, file), join(dest.pathname, file))
      )
    );
    return;
  }
  if (dest.protocol === 's3:') {
    const { status, stdout, stderr } = spawnSync('aws', [
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

export interface CreatePackageOptions {
  inputs: Input[];
  source?: string;
  stagingDir?: string;
  noImplicitAudio?: boolean;
};

export async function createPackage(
  opts: CreatePackageOptions
) {
  const { inputs, source, stagingDir, noImplicitAudio} = opts;
  const sourceUrl = toUrlOrUndefined(source);
  const cmdInputs: string[] = [];
  let fileForAudio;
  for (const input of inputs) {
    const localFilename = await download(input, sourceUrl, stagingDir);
    console.log(`Downloaded ${input.filename} to ${localFilename}`);
    if (input.type === 'video') {
      const initSegment = join(input.key, 'init.mp4');
      const segmentTemplate = join(input.key, '$Number$.m4s');
      const playlist = `video-${input.key}.m3u8`;
      const args = `in=${localFilename},stream=video,init_segment=${initSegment},segment_template=${segmentTemplate},playlist_name=${playlist}`;
      cmdInputs.push(args);
      if (!fileForAudio && noImplicitAudio) {
        fileForAudio = localFilename;
      }
    } else if (input.type === 'audio') {
      fileForAudio = localFilename;
    }
  }
  if (fileForAudio) {
    cmdInputs.push(
      `in=${fileForAudio},stream=audio,init_segment=audio/init.mp4,segment_template=audio/$Number$.m4s,playlist_name=audio.m3u8,hls_group_id=audio,hls_name=ENGLISH`
    );
  }
  const args = cmdInputs.concat([
    '--hls_master_playlist_output',
    'index.m3u8',
    '--mpd_output',
    'manifest.mpd'
  ]);
  console.log(args);
  const { status, stdout, stderr } = spawnSync('packager', args, {
    cwd: stagingDir
  });
  if (status !== 0) {
    console.log(`Packager failed with exit code ${status}`);
    console.log(stderr.toString());
    throw new Error('Packager failed');
  }
}
