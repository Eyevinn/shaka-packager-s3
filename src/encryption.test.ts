import {
  EncryptionOptions,
  createEncryptionArgs,
  redactArgs,
  redactKeyMaterial,
  validateEncryptionOptions
} from './encryption';

const KEY_ID = '00112233445566778899aabbccddeeff';
const KEY = 'ffeeddccbbaa99887766554433221100';
const AUDIO_KEY_ID = 'aabbccddeeff00112233445566778899';
const AUDIO_KEY = '99887766554433221100ffeeddccbbaa';

const singleKey: EncryptionOptions = {
  scheme: 'cenc',
  keys: [{ keyId: KEY_ID, key: KEY }]
};

const hlsContext = { hlsEnabled: true };
const dashOnlyContext = { hlsEnabled: false };

describe('createEncryptionArgs', () => {
  it('returns no args when encryption is not requested', () => {
    expect(createEncryptionArgs(undefined, hlsContext)).toEqual([]);
  });

  it('creates raw key args for cenc with a single default key', () => {
    expect(createEncryptionArgs(singleKey, hlsContext)).toEqual([
      '--enable_raw_key_encryption',
      '--keys',
      `key_id=${KEY_ID}:key=${KEY}`,
      '--protection_scheme',
      'cenc'
    ]);
  });

  it('creates raw key args for cbcs', () => {
    expect(
      createEncryptionArgs({ ...singleKey, scheme: 'cbcs' }, hlsContext)
    ).toEqual([
      '--enable_raw_key_encryption',
      '--keys',
      `key_id=${KEY_ID}:key=${KEY}`,
      '--protection_scheme',
      'cbcs'
    ]);
  });

  it('creates one comma separated --keys value for per label keys', () => {
    const args = createEncryptionArgs(
      {
        scheme: 'cenc',
        keys: [
          { label: 'SD', keyId: KEY_ID, key: KEY },
          { label: 'HD', keyId: AUDIO_KEY_ID, key: AUDIO_KEY },
          { label: 'AUDIO', keyId: AUDIO_KEY_ID, key: KEY }
        ]
      },
      hlsContext
    );
    expect(args).toEqual([
      '--enable_raw_key_encryption',
      '--keys',
      `label=SD:key_id=${KEY_ID}:key=${KEY},` +
        `label=HD:key_id=${AUDIO_KEY_ID}:key=${AUDIO_KEY},` +
        `label=AUDIO:key_id=${AUDIO_KEY_ID}:key=${KEY}`,
      '--protection_scheme',
      'cenc'
    ]);
  });

  it('adds protection systems as a comma separated list', () => {
    const args = createEncryptionArgs(
      {
        ...singleKey,
        protectionSystems: ['widevine', 'playready', 'common']
      },
      hlsContext
    );
    expect(args).toContain('--protection_systems');
    expect(args[args.indexOf('--protection_systems') + 1]).toBe(
      'widevine,playready,common'
    );
  });

  it('passes through a pre-built pssh box as hex', () => {
    const pssh = '000000207073736800000000';
    const args = createEncryptionArgs({ ...singleKey, pssh }, hlsContext);
    expect(args[args.indexOf('--pssh') + 1]).toBe(pssh);
  });

  it('concatenates a list of pre-built pssh boxes', () => {
    const args = createEncryptionArgs(
      { ...singleKey, pssh: ['0000000170737368', '0000000270737368'] },
      hlsContext
    );
    expect(args[args.indexOf('--pssh') + 1]).toBe(
      '00000001707373680000000270737368'
    );
  });

  it('adds hls key uri and clear lead', () => {
    const args = createEncryptionArgs(
      { ...singleKey, hlsKeyUri: `skd://${KEY_ID}`, clearLead: 0 },
      hlsContext
    );
    expect(args[args.indexOf('--hls_key_uri') + 1]).toBe(`skd://${KEY_ID}`);
    expect(args[args.indexOf('--clear_lead') + 1]).toBe('0');
  });

  it('works for dash only output', () => {
    const args = createEncryptionArgs(
      { ...singleKey, protectionSystems: ['widevine'], clearLead: 2.5 },
      dashOnlyContext
    );
    expect(args).toEqual([
      '--enable_raw_key_encryption',
      '--keys',
      `key_id=${KEY_ID}:key=${KEY}`,
      '--protection_scheme',
      'cenc',
      '--protection_systems',
      'widevine',
      '--clear_lead',
      '2.5'
    ]);
  });
});

describe('validateEncryptionOptions', () => {
  it('rejects an unsupported protection scheme', () => {
    expect(() =>
      validateEncryptionOptions(
        { ...singleKey, scheme: 'cbc1' } as unknown as EncryptionOptions,
        hlsContext
      )
    ).toThrow('Unsupported protection scheme: cbc1');
  });

  it('rejects an empty key list', () => {
    expect(() =>
      validateEncryptionOptions({ scheme: 'cenc', keys: [] }, hlsContext)
    ).toThrow('At least one encryption key is required');
  });

  it('rejects a key id that is not 16 bytes of hex', () => {
    expect(() =>
      validateEncryptionOptions(
        { scheme: 'cenc', keys: [{ keyId: 'abcd', key: KEY }] },
        hlsContext
      )
    ).toThrow('Invalid key id');
  });

  it('rejects a key that is not 16 bytes of hex', () => {
    expect(() =>
      validateEncryptionOptions(
        { scheme: 'cenc', keys: [{ keyId: KEY_ID, key: 'zzzz' }] },
        hlsContext
      )
    ).toThrow('Invalid key for label');
  });

  it('rejects duplicated labels', () => {
    expect(() =>
      validateEncryptionOptions(
        {
          scheme: 'cenc',
          keys: [
            { label: 'SD', keyId: KEY_ID, key: KEY },
            { label: 'SD', keyId: AUDIO_KEY_ID, key: AUDIO_KEY }
          ]
        },
        hlsContext
      )
    ).toThrow('Duplicated key label: SD');
  });

  it('rejects more than one default key', () => {
    expect(() =>
      validateEncryptionOptions(
        {
          scheme: 'cenc',
          keys: [
            { keyId: KEY_ID, key: KEY },
            { keyId: AUDIO_KEY_ID, key: AUDIO_KEY }
          ]
        },
        hlsContext
      )
    ).toThrow('Duplicated default key');
  });

  it('rejects a label with separator characters', () => {
    expect(() =>
      validateEncryptionOptions(
        { scheme: 'cenc', keys: [{ label: 'S:D', keyId: KEY_ID, key: KEY }] },
        hlsContext
      )
    ).toThrow('Invalid key label');
  });

  it('rejects an unsupported protection system', () => {
    expect(() =>
      validateEncryptionOptions(
        {
          ...singleKey,
          protectionSystems: ['clearkey']
        } as unknown as EncryptionOptions,
        hlsContext
      )
    ).toThrow('Unsupported protection system: clearkey');
  });

  it('rejects a pssh that is not hex', () => {
    expect(() =>
      validateEncryptionOptions(
        { ...singleKey, pssh: 'bm90LWhleA==' },
        hlsContext
      )
    ).toThrow('Invalid pssh');
  });

  it('rejects hlsKeyUri when HLS is disabled', () => {
    expect(() =>
      validateEncryptionOptions(
        { ...singleKey, hlsKeyUri: `skd://${KEY_ID}` },
        dashOnlyContext
      )
    ).toThrow('hlsKeyUri requires HLS output');
  });

  it('rejects a negative clear lead', () => {
    expect(() =>
      validateEncryptionOptions({ ...singleKey, clearLead: -1 }, hlsContext)
    ).toThrow('clearLead must be a non-negative number');
  });

  it('never includes the key value in a validation error', () => {
    const badKey = `${KEY}ff`;
    let message = '';
    try {
      validateEncryptionOptions(
        { scheme: 'cenc', keys: [{ keyId: KEY_ID, key: badKey }] },
        hlsContext
      );
      fail('Should throw');
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('Invalid key for label');
    expect(message).not.toContain(KEY);
    expect(message).not.toContain(badKey);
  });
});

describe('redactKeyMaterial', () => {
  it('redacts the key value but keeps label and key id', () => {
    const redacted = redactKeyMaterial(
      `label=SD:key_id=${KEY_ID}:key=${KEY},label=HD:key_id=${AUDIO_KEY_ID}:key=${AUDIO_KEY}`
    );
    expect(redacted).toBe(
      `label=SD:key_id=${KEY_ID}:key=<redacted>,` +
        `label=HD:key_id=${AUDIO_KEY_ID}:key=<redacted>`
    );
    expect(redacted).not.toContain(KEY);
    expect(redacted).not.toContain(AUDIO_KEY);
  });

  it('redacts a key at the start of a string', () => {
    expect(redactKeyMaterial(`key=${KEY}`)).toBe('key=<redacted>');
  });

  it('redacts key material echoed by a failed packager run', () => {
    const stderr = `Failed to parse --keys key_id=${KEY_ID}:key=${KEY}\n`;
    const redacted = redactKeyMaterial(stderr);
    expect(redacted).not.toContain(KEY);
    expect(redacted).toContain(KEY_ID);
  });

  it('leaves argv without key material untouched', () => {
    const args = [
      'in=test.mp4,stream=video,playlist_name=video-1.m3u8',
      '--hls_master_playlist_output',
      'index.m3u8'
    ];
    expect(redactArgs(args)).toEqual(args);
  });

  it('redacts every key in a command line', () => {
    const args = createEncryptionArgs(
      {
        scheme: 'cbcs',
        keys: [
          { label: 'SD', keyId: KEY_ID, key: KEY },
          { label: 'AUDIO', keyId: AUDIO_KEY_ID, key: AUDIO_KEY }
        ]
      },
      hlsContext
    );
    const redacted = redactArgs(args).join(' ');
    expect(redacted).not.toContain(KEY);
    expect(redacted).not.toContain(AUDIO_KEY);
    expect(redacted).toContain('key=<redacted>');
  });
});
