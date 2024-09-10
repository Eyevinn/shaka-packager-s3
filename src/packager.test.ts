import { createShakaArgs, doPackage, Input } from './packager';

const singleInputVideo = [
  {
    type: 'video',
    filename: 'test.mp4',
    key: '1'
  } as Input
];

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
