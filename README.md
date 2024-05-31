# shaka-packager-s3

Docker container with a script that uses [shaka-packager](https://github.com/shaka-project/shaka-packager) to create a streaming bundle from an ABR bundle on an S3 bucket and uploads the results to another S3 bucket.

## Usage

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
Usage: cli [options] <source> <dest>

Run shaka-packager with source on S3 and output to S3

Arguments:
  source                         Source bucket URL (supported protocols: s3
  dest                           Destination bucket URL (supported protocols: s3)

Options:
  -i, --input [inputOptions...]  Input options on the format: [a|v]:<key>=filename
  --staging-dir <stagingDir>     Staging directory (default: /tmp/data)
  -h, --help                     display help for command
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
