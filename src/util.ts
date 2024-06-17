import path from 'node:path';

export function toUrlOrUndefined(url?: string) {
  if (!url) {
    return undefined;
  }
  return toUrl(url);
}

export function toUrl(url: string) {
  return url.match(/^[a-z0-9]+:.*/)
    ? new URL(url)
    : new URL(`file://${path.resolve(url)}`);
}
