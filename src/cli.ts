#! /usr/bin/env node

import { Command } from 'commander';
import { doPackage, Input } from './packager';

function parseInputOptions(inputOptions: string[]): Input[] | undefined {
  if (inputOptions) {
    const inputs: Input[] = [];
    inputOptions.map((inputOption) => {
      const [type, keyAndFilename] = inputOption.split(':');
      const [key, filename] = keyAndFilename.split('=');
      if (type && key && filename) {
        const inputType = type === 'a' ? 'audio' : 'video';
        inputs.push({ type: inputType, key, filename });
      }
    });
    return inputs;
  }
  return undefined;
}

const cli = new Command();
cli
  .description(
    `Run shaka-packager with source on S3 or locally, and output to S3 or local
  
  Examples:
    $ shaka-packager-s3 -i a:1=audio.mp4 -i v:1=video.mp4 -s s3://source-bucket/folder -d s3://output-bucket/folder 
    $ shaka-packager-s3 -i a:1=audio.mp4 -i v:1=video.mp4 -s /path/to/source/folder -d /path/to/output/folder
    $ shaka-packager-s3 -i a:2=audio.mp4 -i v:1=video.mp4 -s /path/to/source/folder -d /path/to/output/folder --segment-single-file --segment-single-file-name 'Container$KEY$.mp4' --segment-duration 3.84
  `
  )
  .option(
    '-s, --source-folder [sourceFolder]',
    'Source folder URL, ignored if input uses absolute path (supported protocols: s3, local file)'
  )
  .option(
    '-i, --input [inputOptions...]',
    'Input options on the format: [a|v]:<key>=filename'
  )
  .option(
    '--staging-dir [stagingDir]',
    'Staging directory (default: /tmp/data)'
  )
  .option(
    '--shaka-executable [shakaExecutable]',
    `Path to shaka-packager executable, defaults to 'packager'. Can also be set with environment variable SHAKA_PACKAGER_EXECUTABLE.`
  )
  .option(
    '--no-implicit-audio [noImplicitAudio]',
    'Do not include audio unless audio input specified'
  )
  .option(
    '-d, --destination-folder <dest>',
    'Destination folder URL (supported protocols: s3, local file). Defaults to CWD.'
  )
  .option('--endpoint-url [s3EndpointUrl]', 'S3 endpoint URL')
  .option('--dash-only', 'Package only DASH format')
  .option('--hls-only', 'Package only HLS format')
  .option(
    '--segment-single-file',
    'Use byte range addressing and a single segment file per stream'
  )
  .option(
    '--segment-single-file-name [segmentSingleFileName]',
    'Template for single segment file name, must contain $KEY$ which will be replaced with key of corresponding input'
  )
  .option('--segment-duration [segmentDuration]', 'Segment target duration')
  .action(async (options) => {
    try {
      const inputOptions = parseInputOptions(options.input);
      if (!inputOptions) {
        console.error('Need at least one input!\n');
        cli.help();
        process.exit(1);
      }
      if (options.hlsOnly && options.dashOnly) {
        console.error('Cannot disable both hls and dash\n');
        cli.help();
        process.exit(1);
      }
      if (
        options.segmentSingleFileName &&
        options.segmentSingleFileName.indexOf('$KEY$') === -1
      ) {
        console.error(
          '--segment-single-file-name argument must contain $KEY$\n'
        );
        cli.help();
        process.exit(1);
      }
      console.log('inputs', inputOptions);
      console.log(
        `dest: ${options.destinationFolder}, source: ${options.sourceFolder}`
      );
      await doPackage({
        dest: options.destinationFolder || '.',
        s3EndpointUrl: options.s3EndpointUrl,
        source: options.sourceFolder,
        inputs: inputOptions,
        stagingDir: options.stagingDir,
        noImplicitAudio: options.noImplicitAudio,
        packageFormatOptions: {
          hlsOnly: options.hlsOnly,
          dashOnly: options.dashOnly,
          segmentSingleFile: options.segmentSingleFile,
          segmentSingleFileTemplate: options.segmentSingleFileName,
          segmentDuration: options.segmentDuration
            ? parseFloat(options.segmentDuration)
            : undefined
        },
        shakaExecutable:
          options.shakaExecutable || process.env.SHAKA_PACKAGER_EXECUTABLE
      });
    } catch (err) {
      console.log((err as Error).message);
    }
  });

cli.parseAsync(process.argv);
