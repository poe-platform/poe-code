#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { recognize, parseTesseract } from './index.js';
import { read } from './cli-io.js';


try {
  const request = parseTesseract(process.argv.slice(2));
  if (typeof request === 'string') process.stdout.write(request);
  else {
    const controller = new AbortController();
    const abort = () => controller.abort(new Error('OCR interrupted'));
    process.once('SIGINT', abort);
    try {
      const image = await read(request.input, 64 << 20, controller.signal);
      const model = request.modelPath ? await read(request.modelPath, 64 << 20, controller.signal) : undefined;
      const result = await recognize(image, { language: request.language, model, psm: request.psm, dpi: request.dpi, signal: controller.signal });
      const output = request.format === 'txt' ? result.text : result[request.format];
      if (request.output) await writeFile(request.output, output);
      else process.stdout.write(output);
    } finally { process.off('SIGINT', abort); }
  }
} catch (error) {
  process.stderr.write(`tesseract: ${error.message}\n`);
  process.exitCode = 1;
}
