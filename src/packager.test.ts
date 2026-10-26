import {
  createShakaArgs,
  createPackage,
  doPackage,
  Input,
  download,
  uploadPackage
} from './packager';
import {
  spawnSync,
  SpawnSyncOptions,
  SpawnSyncReturns
} from 'node:child_process';
import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { URL } from 'url';

jest.mock('node:child_process', () => ({
  spawnSync: jest.fn()
}));

jest.mock('node:fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  rmSync: jest.fn(),
  unlinkSync: jest.fn()
}));

const mockedSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;

const singleInputVideo = [
  {
    type: 'video',
    filename: 'test.mp4',
    key: '1'
  } as Input
];

beforeEach(() => {
  jest.clearAllMocks();
  mockedSpawnSync.mockReturnValue({
    status: 0,
    stdout: Buffer.from(''),
    stderr: Buffer.from(''),
    pid: 123,
    output: [],
    signal: null
  });
});

describe('Test download function', () => {
  const stagingDir = '/tmp/test-staging';

  beforeEach(() => {
    (existsSync as jest.Mock).mockReturnValue(false);
    mkdirSync(stagingDir, { recursive: true });
  });

  it('should return the filename if no source or URL in filename', async () => {
    const input: Input = {
      type: 'video' as const,
      filename: 'local.mp4',
      key: '1'
    };
    const result = await download(input);
    expect(result).toBe('local.mp4');
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('should resolve path for file protocol', async () => {
    const input: Input = {
      type: 'video' as const,
      filename: 'local.mp4',
      key: '1'
    };
    const source = new URL('file:///path/to/source/');
    const result = await download(input, source);
    expect(result).toBe(path.resolve('/path/to/source/', 'local.mp4'));
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('should throw error if stagingDir is missing for remote download', async () => {
    const input: Input = {
      type: 'video' as const,
      filename: 'remote.mp4',
      key: '1'
    };
    const source = new URL('https://example.com/');

    await expect(download(input, source)).rejects.toThrow(
      'Staging directory required for remote download'
    );
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('should download from S3 source', async () => {
    const input: Input = {
      type: 'video' as const,
      filename: 'video.mp4',
      key: '1'
    };
    const source = new URL('s3://bucket/path/');
    const endpointUrl = 'https://s3.example.com';

    mockedSpawnSync.mockReturnValueOnce({
      status: 0,
      stderr: Buffer.from(''),
      stdout: Buffer.from(''),
      pid: 123,
      output: [],
      signal: null
    });

    const result = await download(
      input,
      source,
      stagingDir,
      undefined,
      endpointUrl
    );

    expect(result).toBe(path.join(stagingDir, 'video.mp4'));
    expect(spawnSync).toHaveBeenCalledWith(
      'aws',
      expect.arrayContaining(['cp', 's3://bucket/path/video.mp4'])
    );
  });

  it('should handle S3 download failure', async () => {
    const input: Input = {
      type: 'video' as const,
      filename: 'video.mp4',
      key: '1'
    };
    const source = new URL('s3://bucket/path/');

    mockedSpawnSync.mockReturnValueOnce({
      status: 1,
      stderr: Buffer.from('Access denied'),
      stdout: Buffer.from(''),
      pid: 123,
      output: [],
      signal: null
    });

    await expect(download(input, source, stagingDir)).rejects.toThrow(
      'Download failed'
    );
    expect(spawnSync).toHaveBeenCalled();
  });

  it('should download from HTTP source', async () => {
    const input: Input = {
      type: 'video' as const,
      filename: 'video.mp4',
      key: '1'
    };
    const source = new URL('https://example.com/videos/');
    const token = 'test-token';

    mockedSpawnSync.mockReturnValueOnce({
      status: 0,
      stderr: Buffer.from(''),
      stdout: Buffer.from(''),
      pid: 123,
      output: [],
      signal: null
    });

    const result = await download(input, source, stagingDir, token);

    expect(result).toBe(path.join(stagingDir, 'video.mp4'));
    expect(spawnSync).toHaveBeenCalledWith(
      'curl',
      expect.arrayContaining([
        '-H',
        'x-jwt: Bearer test-token',
        '-o',
        path.join(stagingDir, 'video.mp4'),
        'https://example.com/videos/video.mp4'
      ])
    );
  });

  it('should handle HTTP download failure', async () => {
    const input: Input = {
      type: 'video' as const,
      filename: 'video.mp4',
      key: '1'
    };
    const source = new URL('https://example.com/videos/');

    mockedSpawnSync.mockReturnValueOnce({
      status: 1,
      stderr: Buffer.from('404 Not Found'),
      stdout: Buffer.from(''),
      pid: 123,
      output: [],
      signal: null,
      error: new Error('404 Not Found')
    });

    await expect(download(input, source, stagingDir)).rejects.toThrow(
      'Download failed'
    );
    expect(spawnSync).toHaveBeenCalled();
  });

  it('should handle URL in filename', async () => {
    const input: Input = {
      type: 'video' as const,
      filename: 'https://cdn.example.com/videos/special.mp4',
      key: '1'
    };

    mockedSpawnSync.mockReturnValueOnce({
      status: 0,
      stderr: Buffer.from(''),
      stdout: Buffer.from(''),
      pid: 123,
      output: [],
      signal: null
    });

    const result = await download(input, undefined, stagingDir);

    expect(result).toBe(path.join(stagingDir, 'special.mp4'));
    expect(spawnSync).toHaveBeenCalledWith(
      'curl',
      expect.arrayContaining([
        '-o',
        path.join(stagingDir, 'special.mp4'),
        'https://cdn.example.com/videos/special.mp4'
      ])
    );
  });

  it('should throw error for unsupported protocol', async () => {
    const input: Input = {
      type: 'video' as const,
      filename: 'video.mp4',
      key: '1'
    };
    const source = new URL('ftp://example.com/');

    await expect(download(input, source, stagingDir)).rejects.toThrow(
      'Unsupported protocol for download: ftp:'
    );
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('should download from S3 with custom endpoint', async () => {
    const input: Input = {
      type: 'video' as const,
      filename: 'video.mp4',
      key: '1'
    };
    const source = new URL('s3://my-bucket/videos/');
    const endpointUrl = 'https://custom-s3.example.com';

    mockedSpawnSync.mockReturnValueOnce({
      status: 0,
      stderr: Buffer.from(''),
      stdout: Buffer.from(''),
      pid: 123,
      output: [],
      signal: null
    });

    const result = await download(
      input,
      source,
      stagingDir,
      undefined,
      endpointUrl
    );

    expect(result).toBe(path.join(stagingDir, 'video.mp4'));
    expect(spawnSync).toHaveBeenCalledWith(
      'aws',
      expect.arrayContaining([
        's3',
        '--endpoint-url=' + endpointUrl,
        'cp',
        's3://my-bucket/videos/video.mp4',
        path.join(stagingDir, 'video.mp4')
      ])
    );
  });

  it('should handle S3 URL in filename', async () => {
    const input: Input = {
      type: 'video' as const,
      filename: 's3://direct-bucket/path/to/video.mp4',
      key: '1'
    };

    mockedSpawnSync.mockReturnValueOnce({
      status: 0,
      stderr: Buffer.from(''),
      stdout: Buffer.from(''),
      pid: 123,
      output: [],
      signal: null
    });

    const result = await download(input, undefined, stagingDir);

    expect(result).toBe(path.join(stagingDir, 'video.mp4'));
    expect(spawnSync).toHaveBeenCalledWith(
      'aws',
      expect.arrayContaining([
        'cp',
        's3://direct-bucket/path/to/video.mp4',
        path.join(stagingDir, 'video.mp4')
      ])
    );
  });

  it('should prioritize URL in filename over source URL for S3', async () => {
    const input: Input = {
      type: 'video' as const,
      filename: 's3://override-bucket/videos/special.mp4',
      key: '1'
    };
    const source = new URL('s3://default-bucket/path/');

    mockedSpawnSync.mockReturnValueOnce({
      status: 0,
      stderr: Buffer.from(''),
      stdout: Buffer.from(''),
      pid: 123,
      output: [],
      signal: null
    });

    const result = await download(input, source, stagingDir);

    expect(result).toBe(path.join(stagingDir, 'special.mp4'));
    expect(spawnSync).toHaveBeenCalledWith(
      'aws',
      expect.arrayContaining([
        'cp',
        's3://override-bucket/videos/special.mp4',
        path.join(stagingDir, 'special.mp4')
      ])
    );
  });

  it('should use custom S3 endpoint with URL in filename', async () => {
    const input: Input = {
      type: 'video' as const,
      filename: 's3://my-bucket/videos/video.mp4',
      key: '1'
    };
    const endpointUrl = 'https://private-s3.company.com';

    mockedSpawnSync.mockReturnValueOnce({
      status: 0,
      stderr: Buffer.from(''),
      stdout: Buffer.from(''),
      pid: 123,
      output: [],
      signal: null
    });

    const result = await download(
      input,
      undefined,
      stagingDir,
      undefined,
      endpointUrl
    );

    expect(result).toBe(path.join(stagingDir, 'video.mp4'));
    expect(spawnSync).toHaveBeenCalledWith(
      'aws',
      expect.arrayContaining([
        's3',
        '--endpoint-url=' + endpointUrl,
        'cp',
        's3://my-bucket/videos/video.mp4',
        path.join(stagingDir, 'video.mp4')
      ])
    );
  });

  it('should handle complex S3 paths with subdirectories', async () => {
    const input: Input = {
      type: 'video' as const,
      filename: 'nested/path/video.mp4',
      key: '1'
    };
    const source = new URL('s3://my-bucket/base/path/');

    mockedSpawnSync.mockReturnValueOnce({
      status: 0,
      stderr: Buffer.from(''),
      stdout: Buffer.from(''),
      pid: 123,
      output: [],
      signal: null
    });

    const result = await download(input, source, stagingDir);

    expect(result).toBe(path.join(stagingDir, 'nested/path/video.mp4'));
    expect(spawnSync).toHaveBeenCalledWith(
      'aws',
      expect.arrayContaining([
        'cp',
        's3://my-bucket/base/path/nested/path/video.mp4',
        path.join(stagingDir, 'nested/path/video.mp4')
      ])
    );
  });

  it('should handle S3 download with detailed error message', async () => {
    const input: Input = {
      type: 'video' as const,
      filename: 'video.mp4',
      key: '1'
    };
    const source = new URL('s3://my-bucket/videos/');

    mockedSpawnSync.mockReturnValueOnce({
      status: 1,
      stderr: Buffer.from(
        'An error occurred (NoSuchBucket) when calling the GetObject operation: The specified bucket does not exist'
      ),
      stdout: Buffer.from(''),
      pid: 123,
      output: [],
      signal: null
    });

    await expect(download(input, source, stagingDir)).rejects.toThrow(
      'Download failed'
    );
    expect(spawnSync).toHaveBeenCalled();
  });
});

describe('Test doPackage', () => {
  it('Both hlsOnly and dashOnly specified, throws error', async () => {
    try {
      await doPackage({
        inputs: singleInputVideo,
        dest: '.',
        packageFormatOptions: {
          hlsOnly: true,
          dashOnly: true
        }
      });
      fail('Should throw');
    } catch (err) {
      expect((err as Error).message).toBe('Cannot disable both hls and dash');
    }
  });

  it('segmentSingleFileTemplate does not contain $KEY$, throws error', async () => {
    try {
      await doPackage({
        inputs: singleInputVideo,
        dest: '.',
        packageFormatOptions: {
          segmentSingleFileTemplate: 'Container.mp4'
        }
      });
      fail('Should throw');
    } catch (err) {
      expect((err as Error).message).toBe(
        'segmentSingleFileTemplate must contain $KEY$'
      );
    }
  });
});

describe('Test key material is never logged', () => {
  const keyId = '00112233445566778899aabbccddeeff';
  const key = 'ffeeddccbbaa99887766554433221100';
  const encryption = {
    scheme: 'cenc' as const,
    keys: [{ keyId, key }]
  };

  it('Does not log the key when running the packager', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    await createPackage({
      inputs: singleInputVideo,
      dest: '.',
      stagingDir: '/tmp/test-staging',
      encryption
    });

    const logged = log.mock.calls
      .map((call) => JSON.stringify(call))
      .join('\n');
    expect(logged).not.toContain(key);
    expect(logged).toContain('key=<redacted>');
    // The key id is not secret and is signalled in the manifests
    expect(logged).toContain(keyId);
    // The packager itself still gets the real key
    expect(mockedSpawnSync).toHaveBeenCalledWith(
      'packager',
      expect.arrayContaining([`key_id=${keyId}:key=${key}`]),
      expect.anything()
    );
    log.mockRestore();
  });

  it('Does not log or throw the key when the packager fails', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorLog = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockedSpawnSync.mockReturnValue({
      status: 1,
      stdout: Buffer.from(''),
      // Shaka echoes the --keys value on a parse error
      stderr: Buffer.from(`Failed to parse --keys key_id=${keyId}:key=${key}`),
      pid: 123,
      output: [],
      signal: null
    });

    let message = '';
    try {
      await createPackage({
        inputs: singleInputVideo,
        dest: '.',
        stagingDir: '/tmp/test-staging',
        encryption
      });
      fail('Should throw');
    } catch (err) {
      message = (err as Error).message;
    }

    const logged = [...log.mock.calls, ...errorLog.mock.calls]
      .map((call) => JSON.stringify(call))
      .join('\n');
    expect(message).toBe('Packager failed');
    expect(message).not.toContain(key);
    expect(logged).not.toContain(key);
    expect(logged).toContain('key=<redacted>');
    log.mockRestore();
    errorLog.mockRestore();
  });
});

describe('Test create shaka args', () => {
  it('Should use first video file as audio source if noImplicitAudio not set', async () => {
    const args = createShakaArgs(singleInputVideo, false);
    expect(args).toEqual([
      'in=test.mp4,stream=video,playlist_name=video-1.m3u8,init_segment=video-1/init.mp4,segment_template=video-1/$Number$.m4s',
      'in=test.mp4,stream=audio,playlist_name=audio.m3u8,hls_group_id=audio,hls_name=defaultaudio,init_segment=audio/init.mp4,segment_template=audio/$Number$.m4s',
      '--hls_master_playlist_output',
      'index.m3u8',
      '--generate_static_live_mpd',
      '--mpd_output',
      'manifest.mpd'
    ]);
  });

  it('Should not use first video file as audio source if noImplicitAudio is true', async () => {
    const args = createShakaArgs(singleInputVideo, true);
    expect(args).toEqual([
      'in=test.mp4,stream=video,playlist_name=video-1.m3u8,init_segment=video-1/init.mp4,segment_template=video-1/$Number$.m4s',
      '--hls_master_playlist_output',
      'index.m3u8',
      '--generate_static_live_mpd',
      '--mpd_output',
      'manifest.mpd'
    ]);
  });

  it('Should set --segement_duration option if segmentDuration is set', async () => {
    const args = createShakaArgs(singleInputVideo, true, {
      segmentDuration: 3.84
    });
    expect(args).toEqual([
      'in=test.mp4,stream=video,playlist_name=video-1.m3u8,init_segment=video-1/init.mp4,segment_template=video-1/$Number$.m4s',
      '--hls_master_playlist_output',
      'index.m3u8',
      '--generate_static_live_mpd',
      '--mpd_output',
      'manifest.mpd',
      '--segment_duration',
      '3.84'
    ]);
  });

  it('Should set correct output path for stream if single file segment specified', async () => {
    const args = createShakaArgs(singleInputVideo, true, {
      segmentSingleFile: true,
      segmentSingleFileTemplate: 'Container-$KEY$.mp4'
    });
    expect(args).toEqual([
      'in=test.mp4,stream=video,playlist_name=video-1.m3u8,out=Container-1.mp4',
      '--hls_master_playlist_output',
      'index.m3u8',
      '--generate_static_live_mpd',
      '--mpd_output',
      'manifest.mpd'
    ]);
  });

  it('Should set correct output path for stream if single file segment specified with audio', async () => {
    const args = createShakaArgs(
      [
        ...singleInputVideo,
        {
          type: 'audio',
          filename: 'audio.mp4',
          key: '2'
        }
      ],
      true,
      {
        segmentSingleFile: true,
        segmentSingleFileTemplate: 'Container-$KEY$.mp4'
      }
    );
    expect(args).toEqual([
      'in=test.mp4,stream=video,playlist_name=video-1.m3u8,out=Container-1.mp4',
      'in=audio.mp4,stream=audio,playlist_name=audio.m3u8,hls_group_id=audio,hls_name=defaultaudio,out=Container-2.mp4',
      '--hls_master_playlist_output',
      'index.m3u8',
      '--generate_static_live_mpd',
      '--mpd_output',
      'manifest.mpd'
    ]);
  });

  it('Should append raw key encryption args when encryption is specified', async () => {
    const args = createShakaArgs(singleInputVideo, true, undefined, {
      scheme: 'cbcs',
      keys: [
        {
          label: 'HD',
          keyId: '00112233445566778899aabbccddeeff',
          key: 'ffeeddccbbaa99887766554433221100'
        }
      ],
      protectionSystems: ['widevine', 'fairplay'],
      hlsKeyUri: 'skd://00112233445566778899aabbccddeeff',
      clearLead: 0
    });
    expect(args).toEqual([
      'in=test.mp4,stream=video,playlist_name=video-1.m3u8,init_segment=video-1/init.mp4,segment_template=video-1/$Number$.m4s',
      '--hls_master_playlist_output',
      'index.m3u8',
      '--generate_static_live_mpd',
      '--mpd_output',
      'manifest.mpd',
      '--enable_raw_key_encryption',
      '--keys',
      'label=HD:key_id=00112233445566778899aabbccddeeff:key=ffeeddccbbaa99887766554433221100',
      '--protection_scheme',
      'cbcs',
      '--protection_systems',
      'widevine,fairplay',
      '--hls_key_uri',
      'skd://00112233445566778899aabbccddeeff',
      '--clear_lead',
      '0'
    ]);
  });

  it('Should produce the same args as without encryption when encryption is omitted', async () => {
    expect(
      createShakaArgs(singleInputVideo, false, undefined, undefined)
    ).toEqual(createShakaArgs(singleInputVideo, false));
  });

  it('Should throw if hlsKeyUri is set for dash only output', async () => {
    expect(() =>
      createShakaArgs(
        singleInputVideo,
        true,
        { dashOnly: true },
        {
          scheme: 'cenc',
          keys: [
            {
              keyId: '00112233445566778899aabbccddeeff',
              key: 'ffeeddccbbaa99887766554433221100'
            }
          ],
          hlsKeyUri: 'skd://00112233445566778899aabbccddeeff'
        }
      )
    ).toThrow('hlsKeyUri requires HLS output');
  });

  it('Should set name of master playlist and manifest as specified', async () => {
    const args = createShakaArgs(singleInputVideo, false, {
      hlsManifestName: 'myHlsMasterPlaylist.m3u8',
      dashManifestName: 'myDashManifest.mpd'
    });
    expect(args).toEqual([
      'in=test.mp4,stream=video,playlist_name=video-1.m3u8,init_segment=video-1/init.mp4,segment_template=video-1/$Number$.m4s',
      'in=test.mp4,stream=audio,playlist_name=audio.m3u8,hls_group_id=audio,hls_name=defaultaudio,init_segment=audio/init.mp4,segment_template=audio/$Number$.m4s',
      '--hls_master_playlist_output',
      'myHlsMasterPlaylist.m3u8',
      '--generate_static_live_mpd',
      '--mpd_output',
      'myDashManifest.mpd'
    ]);
  });
});

describe('Test spawned processes are not killed with ENOBUFS', () => {
  // spawnSync buffers at most 1 MiB of piped output unless maxBuffer says
  // otherwise, see SpawnSyncOptions.maxBuffer in
  // node_modules/@types/node/child_process.d.ts:1398
  const NODE_DEFAULT_MAX_BUFFER = 1024 * 1024;

  /**
   * Stand-in for a child process that writes `bytes` of output, applying the
   * same rule as spawnSync: output past maxBuffer kills the child and reports
   * ENOBUFS.
   */
  function childWritingOutput(bytes: number) {
    return (
      command: string,
      args?: readonly string[],
      options?: SpawnSyncOptions
    ): SpawnSyncReturns<Buffer> => {
      const limit = options?.maxBuffer ?? NODE_DEFAULT_MAX_BUFFER;
      if (bytes > limit) {
        const enobufs: NodeJS.ErrnoException = new Error(
          `spawnSync ${command} ENOBUFS`
        );
        enobufs.code = 'ENOBUFS';
        return {
          pid: 123,
          output: [],
          stdout: Buffer.alloc(0),
          stderr: Buffer.alloc(0),
          status: null,
          signal: 'SIGTERM',
          error: enobufs
        };
      }
      return {
        pid: 123,
        output: [],
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        status: 0,
        signal: null
      };
    };
  }

  it('Asks for a buffer larger than the default when uploading', async () => {
    await uploadPackage(new URL('s3://my-bucket/package/'), '/tmp/test-dir');

    expect(mockedSpawnSync).toHaveBeenCalledWith(
      'aws',
      expect.arrayContaining(['cp', '--recursive', '--only-show-errors']),
      expect.objectContaining({
        stdio: ['ignore', 'ignore', 'pipe'],
        maxBuffer: expect.any(Number)
      })
    );
    const options = mockedSpawnSync.mock.calls[0][2] as SpawnSyncOptions;
    expect(options.maxBuffer).toBeGreaterThan(NODE_DEFAULT_MAX_BUFFER);
  });

  it('Uploads a package whose output exceeds the default buffer', async () => {
    mockedSpawnSync.mockImplementation(
      childWritingOutput(8 * NODE_DEFAULT_MAX_BUFFER) as typeof spawnSync
    );

    await expect(
      uploadPackage(new URL('s3://my-bucket/package/'), '/tmp/test-dir')
    ).resolves.toBeUndefined();
  });

  it('Asks for a buffer larger than the default when running the packager', async () => {
    await createPackage({
      inputs: singleInputVideo,
      dest: '.',
      stagingDir: '/tmp/test-staging'
    });

    expect(mockedSpawnSync).toHaveBeenCalledWith(
      'packager',
      expect.any(Array),
      expect.objectContaining({
        cwd: '/tmp/test-staging',
        maxBuffer: expect.any(Number)
      })
    );
    const options = mockedSpawnSync.mock.calls[0][2] as SpawnSyncOptions;
    expect(options.maxBuffer).toBeGreaterThan(NODE_DEFAULT_MAX_BUFFER);
  });

  it('Packages inputs whose packager output exceeds the default buffer', async () => {
    mockedSpawnSync.mockImplementation(
      childWritingOutput(8 * NODE_DEFAULT_MAX_BUFFER) as typeof spawnSync
    );

    await expect(
      createPackage({
        inputs: singleInputVideo,
        dest: '.',
        stagingDir: '/tmp/test-staging'
      })
    ).resolves.toBeUndefined();
  });

  it('Keeps transfer progress out of the buffered download output', async () => {
    await download(
      { type: 'video', filename: 'video.mp4', key: '1' },
      new URL('s3://my-bucket/videos/'),
      '/tmp/test-staging'
    );
    expect(mockedSpawnSync).toHaveBeenCalledWith(
      'aws',
      expect.arrayContaining(['--only-show-errors'])
    );

    jest.clearAllMocks();
    mockedSpawnSync.mockReturnValue({
      status: 0,
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      pid: 123,
      output: [],
      signal: null
    });

    await download(
      { type: 'video', filename: 'video.mp4', key: '1' },
      new URL('https://example.com/videos/'),
      '/tmp/test-staging'
    );
    expect(mockedSpawnSync).toHaveBeenCalledWith(
      'curl',
      expect.arrayContaining(['-sS'])
    );
  });
});
