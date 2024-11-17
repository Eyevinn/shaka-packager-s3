import { createS3cmdArgs } from './util';

describe('cmd args helper', () => {
  test('can construct s3cmd args without s3 endpoint url', () => {
    const args = createS3cmdArgs(['ls']);
    expect(args).toEqual(['s3', 'ls']);
  });

  test('can construct s3cmd args s3 endpoint url', () => {
    const args = createS3cmdArgs(['ls'], 'https://my.api.url.com');
    expect(args).toEqual(['s3', '--endpoint-url=https://my.api.url.com', 'ls']);
  });
});
