#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { recognizePdf, parseOcrmypdf } from './index.js';
import { read } from './cli-io.js';
import { resolve } from 'node:path';

try {
  const request = parseOcrmypdf(process.argv.slice(2));
  if (typeof request === 'string') process.stdout.write(request);
  else {
    if (request.sidecar && [request.input, request.output].some(path => path && resolve(path) === resolve(request.sidecar))) throw new Error('Sidecar must differ from input and PDF output');
    const controller = new AbortController();
    const abort = () => controller.abort(new Error('OCR interrupted'));
    process.once('SIGINT', abort);
    try {
      const image = await read(request.input, 64 << 20, controller.signal);
      const model = request.modelPath ? await read(request.modelPath, 64 << 20, controller.signal) : undefined;
      const result = await recognizePdf(image, { language: request.language, model, skipText: request.skipText, dpi: request.dpi, signal: controller.signal });
      const output = result.pdf;
      if (request.output) await writeFile(request.output, output);
      else process.stdout.write(output);
      if (request.sidecar) {
        if (request.sidecar === '-') process.stdout.write(result.text);
        else await writeFile(request.sidecar, result.text);
      }
    } finally { process.off('SIGINT', abort); }
  }
} catch (error) {
  process.stderr.write(`ocrmypdf: ${error.message}\n`);
  process.exitCode = 1;
}
