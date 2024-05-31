#! /usr/bin/env node

import { Command } from 'commander';
import { Input, createPackage, prepare, uploadPackage } from './packager';

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
  .description('Run shaka-packager with source on S3 and output to S3')
  .argument('<source>', 'Source bucket URL (supported protocols: s3')
  .argument('<dest>', 'Destination bucket URL (supported protocols: s3)')
  .option('-i, --input [inputOptions...]', 'Input options on the format: [a|v]:<key>=filename')
  .option(
    '--staging-dir <stagingDir>',
    'Staging directory (default: /tmp/data)'
  )
  .action(async (source, dest, options, command) => {
    try {
      const inputOptions = parseInputOptions(options.input);
      console.log('inputs', inputOptions);
      if (inputOptions) {
        const stagingDir = await prepare(options.stagingDir);
        await createPackage(new URL(source), inputOptions, new URL(dest), stagingDir);
        await uploadPackage(new URL(dest), stagingDir);
      }
    } catch(err) {
      console.log((err as Error).message);
    }
  });

  cli.parse(process.argv);
