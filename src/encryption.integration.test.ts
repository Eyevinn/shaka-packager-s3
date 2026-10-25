import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doPackage } from './packager';

/**
 * Integration test: package a small fixture with a raw key and check that the
 * manifests carry the protection signalling and that the segments are
 * encrypted.
 *
 * Requires a Shaka Packager binary (`packager`, or SHAKA_PACKAGER_EXECUTABLE)
 * and ffmpeg to build the fixture. The suite is skipped when either is
 * missing, so it runs in the container image but not on a bare checkout.
 */
const SHAKA = process.env.SHAKA_PACKAGER_EXECUTABLE || 'packager';

function isAvailable(bin: string, args: string[]): boolean {
  try {
    const { status, error } = spawnSync(bin, args, { stdio: 'ignore' });
    return !error && status === 0;
  } catch (err) {
    return false;
  }
}

const toolsAvailable =
  isAvailable(SHAKA, ['--version']) && isAvailable('ffmpeg', ['-version']);

const KEY_ID = '00112233445566778899aabbccddeeff';
const KEY = 'ffeeddccbbaa99887766554433221100';

const describeIfTools = toolsAvailable ? describe : describe.skip;

describeIfTools('Encrypted packaging of a fixture', () => {
  let workDir: string;
  let fixture: string;

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), 'encryption-it-'));
    fixture = join(workDir, 'fixture.mp4');
    const { status, stderr } = spawnSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=2:size=320x240:rate=25',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      fixture
    ]);
    if (status !== 0) {
      throw new Error(`Failed to create fixture: ${stderr?.toString()}`);
    }
  }, 120000);

  afterAll(() => {
    if (workDir) {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('signals cenc protection in both manifests and encrypts the segments', async () => {
    const dest = join(workDir, 'out-cenc');
    await doPackage({
      inputs: [{ type: 'video', key: '1', filename: fixture }],
      dest,
      stagingDir: join(workDir, 'staging-cenc'),
      shakaExecutable: SHAKA,
      packageFormatOptions: { segmentDuration: 1 },
      encryption: {
        scheme: 'cenc',
        keys: [{ keyId: KEY_ID, key: KEY }],
        protectionSystems: ['common'],
        clearLead: 0
      }
    });

    const mpd = readFileSync(join(dest, 'manifest.mpd'), 'utf-8');
    expect(mpd).toContain('ContentProtection');
    expect(mpd).toContain('urn:mpeg:dash:mp4protection:2011');
    expect(mpd.toLowerCase()).toContain('cenc');
    // The key id is signalled as the default KID
    expect(mpd.toLowerCase().replace(/-/g, '')).toContain(KEY_ID);

    const master = readFileSync(join(dest, 'index.m3u8'), 'utf-8');
    const videoPlaylist = readFileSync(join(dest, 'video-1.m3u8'), 'utf-8');
    expect(master).toContain('video-1.m3u8');
    expect(videoPlaylist).toContain('#EXT-X-KEY');

    // The init segment carries an encrypted sample entry and a PSSH box
    const initSegment = readFileSync(join(dest, 'video-1', 'init.mp4'));
    expect(existsSync(join(dest, 'video-1', 'init.mp4'))).toBe(true);
    const initAsLatin1 = initSegment.toString('latin1');
    expect(initAsLatin1).toContain('encv');
    expect(initAsLatin1).toContain('sinf');
    expect(initAsLatin1).toContain('pssh');

    // The media segments carry sample encryption boxes
    const mediaSegment = readFileSync(join(dest, 'video-1', '1.m4s')).toString(
      'latin1'
    );
    expect(mediaSegment).toContain('senc');

    // And the clear fixture bytes are not in the encrypted segment
    expect(mediaSegment).not.toContain(KEY);
  }, 180000);

  it('signals cbcs protection with a FairPlay style key uri', async () => {
    const dest = join(workDir, 'out-cbcs');
    await doPackage({
      inputs: [{ type: 'video', key: '1', filename: fixture }],
      dest,
      stagingDir: join(workDir, 'staging-cbcs'),
      shakaExecutable: SHAKA,
      packageFormatOptions: { hlsOnly: true, segmentDuration: 1 },
      encryption: {
        scheme: 'cbcs',
        keys: [{ keyId: KEY_ID, key: KEY }],
        protectionSystems: ['fairplay'],
        hlsKeyUri: `skd://${KEY_ID}`,
        clearLead: 0
      }
    });

    const videoPlaylist = readFileSync(join(dest, 'video-1.m3u8'), 'utf-8');
    expect(videoPlaylist).toContain('#EXT-X-KEY');
    expect(videoPlaylist).toContain('METHOD=SAMPLE-AES');
    expect(videoPlaylist).toContain(`skd://${KEY_ID}`);
    expect(videoPlaylist).toContain('com.apple.streamingkeydelivery');
    expect(videoPlaylist).not.toContain(KEY);

    const initAsLatin1 = readFileSync(
      join(dest, 'video-1', 'init.mp4')
    ).toString('latin1');
    expect(initAsLatin1).toContain('encv');
    expect(initAsLatin1).toContain('sinf');
  }, 180000);
});
