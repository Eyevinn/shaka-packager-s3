/**
 * Raw key (CENC) encryption support.
 *
 * Flag names and value formats are taken from Shaka Packager v3.2.0, the
 * version this image ships (see Dockerfile: `FROM google/shaka-packager:v3.2.0`):
 *
 *  - `--enable_raw_key_encryption`  packager/app/raw_key_encryption_flags.cc (ABSL_FLAG bool)
 *  - `--keys`                       packager/app/raw_key_encryption_flags.cc (ABSL_FLAG std::string):
 *                                   "label=<drm label>:key_id=<32-digit key id in hex>:key=<32-digit key in hex>,label=..."
 *                                   parsed by ParseKeys() in packager/app/packager_main.cc
 *  - `--protection_scheme`          packager/app/crypto_flags.cc, values accepted by
 *                                   GetProtectionScheme() in packager/app/packager_main.cc:
 *                                   'cenc', 'cbc1', 'cbcs', 'cens'
 *  - `--protection_systems`         packager/app/protection_system_flags.cc, values accepted by
 *                                   ParseProtectionSystems() in packager/app/packager_main.cc:
 *                                   common | commonsystem | fairplay | marlin | playready | widevine
 *  - `--pssh`                       packager/app/raw_key_encryption_flags.cc (ABSL_FLAG shaka::HexBytes):
 *                                   "One or more PSSH boxes in hex string format." (hex, not base64)
 *  - `--hls_key_uri`                packager/app/hls_flags.cc
 *  - `--clear_lead`                 packager/app/muxer_flags.cc (ABSL_FLAG double, seconds)
 *
 * Stream labels usable in `keys[].label` come from
 * Packager::DefaultStreamLabelFunction() in packager/packager.cc:
 * 'AUDIO' for audio, and 'SD' | 'HD' | 'UHD1' | 'UHD2' for video by pixel count.
 * A key with no label is the default key and is used for every stream that has
 * no label specific key (RawKeySource::GetKey() in packager/media/base/raw_key_source.cc).
 */

/** Protection schemes exposed by this tool (subset of the four Shaka accepts). */
export type ProtectionScheme = 'cenc' | 'cbcs';

/** Protection systems accepted by `--protection_systems`. */
export type ProtectionSystem =
  | 'widevine'
  | 'playready'
  | 'fairplay'
  | 'marlin'
  | 'common';

export interface EncryptionKey {
  /**
   * Stream label this key applies to, e.g. 'AUDIO', 'SD', 'HD', 'UHD1', 'UHD2'.
   * Omit for a default key that is used for all streams.
   */
  label?: string;
  /** Key id as a hex string, 16 bytes (32 hex digits). */
  keyId: string;
  /** Key as a hex string, 16 bytes (32 hex digits). */
  key: string;
}

export interface EncryptionOptions {
  scheme: ProtectionScheme;
  keys: EncryptionKey[];
  protectionSystems?: ProtectionSystem[];
  /** One or more pre-built PSSH boxes as a hex string (concatenated if a list). */
  pssh?: string | string[];
  /** Key URI for 'identity' and 'com.apple.streamingkeydelivery' HLS key formats. */
  hlsKeyUri?: string;
  /** Clear lead in seconds. */
  clearLead?: number;
}

const PROTECTION_SCHEMES: readonly ProtectionScheme[] = ['cenc', 'cbcs'];
const PROTECTION_SYSTEMS: readonly ProtectionSystem[] = [
  'widevine',
  'playready',
  'fairplay',
  'marlin',
  'common'
];

/** 16 bytes as hex, as required by --keys ("32-digit key id in hex"). */
const HEX_16_BYTES = /^[0-9a-fA-F]{32}$/;
const HEX_ANY = /^(?:[0-9a-fA-F]{2})+$/;

const REDACTED = '<redacted>';

/**
 * Remove raw key material from a string so it is safe to log.
 *
 * Only the `key=` values of `--keys` carry secrets; `label=` and `key_id=` are
 * public (the key id is signalled in the manifests). Shaka itself echoes the
 * whole `--keys` value on a parse error ("Failed to parse --keys ..." in
 * packager/app/packager_main.cc), so stderr has to be run through this too.
 */
export function redactKeyMaterial(text: string): string {
  return text.replace(/(^|[^_\w])key=[0-9a-fA-F]*/g, `$1key=${REDACTED}`);
}

/** Redact key material in every element of a command line. */
export function redactArgs(args: string[]): string[] {
  return args.map((arg) => redactKeyMaterial(arg));
}

export interface EncryptionContext {
  /** True when an HLS master playlist is written (i.e. not DASH only). */
  hlsEnabled: boolean;
}

export function validateEncryptionOptions(
  encryption: EncryptionOptions,
  context: EncryptionContext
) {
  if (!PROTECTION_SCHEMES.includes(encryption.scheme)) {
    throw new Error(
      `Unsupported protection scheme: ${
        encryption.scheme
      }, must be one of ${PROTECTION_SCHEMES.join(', ')}`
    );
  }
  if (!encryption.keys || encryption.keys.length === 0) {
    throw new Error('At least one encryption key is required');
  }
  const seenLabels = new Set<string>();
  for (const key of encryption.keys) {
    const label = key.label || '';
    if (label.match(/[,:=]/)) {
      throw new Error(
        `Invalid key label: ${label}, must not contain ',', ':' or '='`
      );
    }
    if (seenLabels.has(label)) {
      throw new Error(
        label
          ? `Duplicated key label: ${label}`
          : 'Duplicated default key (more than one key without a label)'
      );
    }
    seenLabels.add(label);
    if (!HEX_16_BYTES.test(key.keyId || '')) {
      throw new Error(
        `Invalid key id for label '${label}': must be 16 bytes as a hex string (32 hex digits)`
      );
    }
    if (!HEX_16_BYTES.test(key.key || '')) {
      // Never include the key itself in the message.
      throw new Error(
        `Invalid key for label '${label}': must be 16 bytes as a hex string (32 hex digits)`
      );
    }
  }
  for (const system of encryption.protectionSystems || []) {
    if (!PROTECTION_SYSTEMS.includes(system)) {
      throw new Error(
        `Unsupported protection system: ${system}, must be one of ${PROTECTION_SYSTEMS.join(
          ', '
        )}`
      );
    }
  }
  const pssh = toPsshHex(encryption.pssh);
  if (pssh !== undefined && !HEX_ANY.test(pssh)) {
    throw new Error(
      'Invalid pssh: must be one or more PSSH boxes as a hex string'
    );
  }
  if (encryption.hlsKeyUri && !context.hlsEnabled) {
    throw new Error('hlsKeyUri requires HLS output, but HLS is disabled');
  }
  if (encryption.clearLead !== undefined) {
    if (!Number.isFinite(encryption.clearLead) || encryption.clearLead < 0) {
      throw new Error('clearLead must be a non-negative number of seconds');
    }
  }
}

function toPsshHex(pssh?: string | string[]): string | undefined {
  if (pssh === undefined) {
    return undefined;
  }
  const joined = Array.isArray(pssh) ? pssh.join('') : pssh;
  return joined;
}

function toKeysValue(keys: EncryptionKey[]): string {
  return keys
    .map((key) => {
      const parts = [];
      if (key.label) {
        parts.push(`label=${key.label}`);
      }
      parts.push(`key_id=${key.keyId}`, `key=${key.key}`);
      return parts.join(':');
    })
    .join(',');
}

/**
 * Create the Shaka Packager arguments for raw key encryption.
 *
 * Returns an empty array when no encryption is requested, so that the argv is
 * unchanged for unencrypted packaging.
 */
export function createEncryptionArgs(
  encryption: EncryptionOptions | undefined,
  context: EncryptionContext
): string[] {
  if (!encryption) {
    return [];
  }
  validateEncryptionOptions(encryption, context);

  const args: string[] = [
    '--enable_raw_key_encryption',
    '--keys',
    toKeysValue(encryption.keys),
    '--protection_scheme',
    encryption.scheme
  ];
  if (encryption.protectionSystems && encryption.protectionSystems.length > 0) {
    args.push('--protection_systems', encryption.protectionSystems.join(','));
  }
  const pssh = toPsshHex(encryption.pssh);
  if (pssh) {
    args.push('--pssh', pssh);
  }
  if (encryption.hlsKeyUri) {
    args.push('--hls_key_uri', encryption.hlsKeyUri);
  }
  if (encryption.clearLead !== undefined) {
    args.push('--clear_lead', encryption.clearLead.toString());
  }
  return args;
}
