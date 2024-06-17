import { createShakaArgs, Input } from './packager';

describe('Test create shaka args', () => {
  const singleInputVideo = [
    {
      type: 'video',
      filename: 'test.mp4',
      key: '1'
    } as Input
  ];
  it('Should use first video file as audio source if noImplicitAudio not set', async () => {
    const args = createShakaArgs(singleInputVideo, false);
    expect(args).toEqual([
      'in=test.mp4,stream=video,init_segment=video-1/init.mp4,segment_template=video-1/$Number$.m4s,playlist_name=video-1.m3u8',
      'in=test.mp4,stream=audio,init_segment=audio/init.mp4,segment_template=audio/$Number$.m4s,playlist_name=audio.m3u8,hls_group_id=audio,hls_name=ENGLISH',
      '--hls_master_playlist_output',
      'index.m3u8',
      '--mpd_output',
      'manifest.mpd'
    ]);
  });

  it('Should not use first video file as audio source if noImplicitAudio is true', async () => {
    const args = createShakaArgs(singleInputVideo, true);
    expect(args).toEqual([
      'in=test.mp4,stream=video,init_segment=video-1/init.mp4,segment_template=video-1/$Number$.m4s,playlist_name=video-1.m3u8',
      '--hls_master_playlist_output',
      'index.m3u8',
      '--mpd_output',
      'manifest.mpd'
    ]);
  });
});
