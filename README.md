# shaka-packager-s3

CLI and library for creating a streaming bundle from an ABR bundle [shaka-packager](https://github.com/shaka-project/shaka-packager). Input and output can be in S3 buckets.

## Requirements

shaka-packager executable must be available in path under the name `packager`. When using S3 for input and output the AWS CLI must be installed and configured.

## Usage

### CLI

```
> npm install -g shaka-packager-s3
> shaka-packager-s3 s3://source-bucket/folder s3://output-bucket/folder -i a:1=audio.mp4 -i v:1=video.mp4
> shaka-packager-s3 /path/to/source/folder /path/to/output/folder -i a:1=audio.mp4 -i v:1=video.mp4

```

### Library

```javascript
import { Input, doPackage } from '@eyevinn/shaka-packager-s3';

const inputs = [
  {
    type: 'audio',
    key: '1',
    filename: 'audio.mp4'
  },
  {
    type: 'video',
    key: '1',
    filename: 'video.mp4'
  }
];

const dest = '/my/output/folder';
doPackage({
  dest,
  inputs
})
  .then(() => {
    console.log('done');
  })
  .catch((err) => {
    console.error(err);
  });
```

### Docker

```
docker build -t shaka-packager-s3:local .
```

Package an ABR bundle on S3 and upload to another S3 bucket

```
docker run --rm \
  -e AWS_ACCESS_KEY_ID=<aws-access-key-id> \
  -e AWS_SECRET_ACCESS_KEY=<aws-secret-access-key> \
  shaka-packager-s3:local \
  shaka-packager-s3 s3://source/abr s3://dest/vod \
  -i a:audio=snaxax_STEREO.mp4 \
  -i v:324=snaxax_x264_324.mp4 \
  -i v:1312=snaxax_x264_1312.mp4 \
  -i v:2069=snaxax_x264_2069.mp4 \
  -i v:3100=snaxax_x264_3100.mp4
```

## Development

Prerequisites:

- shaka-packager
- AWS cli

Install Node dependencies

```
npm install
```

Build

```
npm run build
```

Run script locally

```
% node dist/cli.js -h
Usage: cli [options]

Run shaka-packager with source on S3 or locally, and output to S3 or local

  Examples:
    $ shaka-packager-s3 -i a:1=audio.mp4 -i v:1=video.mp4 -s s3://source-bucket/folder -d s3://output-bucket/folder
    $ shaka-packager-s3 -i a:1=audio.mp4 -i v:1=video.mp4 -s /path/to/source/folder -d /path/to/output/folder
    $ shaka-packager-s3 -i a:2=audio.mp4 -i v:1=video.mp4 -s /path/to/source/folder -d /path/to/output/folder --segment-single-file --segment-single-file-name 'Container$KEY$.mp4' --segment-duration 3.84



Options:
  -s, --source-folder [sourceFolder]                  Source folder URL, ignored if input uses absolute path (supported protocols: s3, local file)
  -i, --input [inputOptions...]                       Input options on the format: [a|v]:<key>=filename
  --staging-dir [stagingDir]                          Staging directory (default: /tmp/data)
  --shaka-executable [shakaExecutable]                Path to shaka-packager executable, defaults to 'packager'. Can also be set with environment variable SHAKA_PACKAGER_EXECUTABLE.
  --no-implicit-audio [noImplicitAudio]               Do not include audio unless audio input specified
  -d, --destination-folder <dest>                     Destination folder URL (supported protocols: s3, local file). Defaults to CWD.
  --endpoint-url [s3EndpointUrl]                      S3 endpoint URL
  --dash-only                                         Package only DASH format
  --hls-only                                          Package only HLS format
  --segment-single-file                               Use byte range addressing and a single segment file per stream
  --segment-single-file-name [segmentSingleFileName]  Template for single segment file name, $KEY$ will be replaced with stream key
  --segment-duration [segmentDuration]                Segment target duration
  -h, --help                                          display help for command

```

## Support

Join our [community on Slack](http://slack.streamingtech.se) where you can post any questions regarding any of our open source projects. Eyevinn's consulting business can also offer you:

- Further development of this component
- Customization and integration of this component into your platform
- Support and maintenance agreement

Contact [sales@eyevinn.se](mailto:sales@eyevinn.se) if you are interested.

## About Eyevinn Technology

[Eyevinn Technology](https://www.eyevinntechnology.se) is an independent consultant firm specialized in video and streaming. Independent in a way that we are not commercially tied to any platform or technology vendor. As our way to innovate and push the industry forward we develop proof-of-concepts and tools. The things we learn and the code we write we share with the industry in [blogs](https://dev.to/video) and by open sourcing the code we have written.

Want to know more about Eyevinn and how it is to work here. Contact us at work@eyevinn.se!
