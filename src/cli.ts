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
  .action(async (options) => {
    try {
      const inputOptions = parseInputOptions(options.input);
      if (inputOptions) {
        console.log('inputs', inputOptions);
        console.log(`dest: ${options.destinationFolder}, source: ${options.sourceFolder}`);
        await doPackage({
          dest: options.destinationFolder || '.',
          source: options.sourceFolder,
          inputs: inputOptions,
          stagingDir: options.stagingDir,
          noImplicitAudio: options.noImplicitAudio,
          shakaExecutable: options.shakaExecutable || process.env.SHAKA_PACKAGER_EXECUTABLE
        });
      } else {
        console.error('Need at least one input!\n');
        cli.help();
        process.exit(1);
      }
    } catch (err) {
      console.log((err as Error).message);
    }
  });

cli.parseAsync(process.argv);
