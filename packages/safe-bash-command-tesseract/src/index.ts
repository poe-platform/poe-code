import type { OcrLimits } from '@poe-platform/tesseract';
import type { CommandDefinition } from 'safe-bash-contracts/command';
import type { VirtualShellPlugin } from 'safe-bash-contracts/plugin';
import { collectBytes, writeBytes } from 'safe-bash-contracts/io';
import { resolvePath } from 'safe-bash-contracts/path';
import { writeFileOutput } from 'safe-bash-contracts/filesystem-output-budget';

export type TesseractLimits = Required<OcrLimits>;
export interface TesseractCommandsOptions {
  readonly limits?: Partial<TesseractLimits>;
  readonly models?: Readonly<Record<string, Uint8Array>>;
  readonly replace?: boolean;
}

export function createTesseractCommand(options: TesseractCommandsOptions = {}): CommandDefinition {
  for (const [name, value] of Object.entries(options.limits ?? {})) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`Invalid Tesseract limit: ${name}`);
  }
  return {
    name: 'tesseract',
    description: 'Recognize image text and layout using the optional Rust Tesseract engine',
    async execute(context) {
      const controller = new AbortController();
      const signal = AbortSignal.any([context.signal, controller.signal]);
      let complete!: () => void;
      const completion = new Promise<void>(resolve => { complete = resolve; });
      context.registerCleanup?.(async () => { controller.abort(); await completion; });
      try {
        signal.throwIfAborted();
        const { parseTesseract, recognize } = await import('@poe-platform/tesseract');
        signal.throwIfAborted();
        const request = parseTesseract([...context.args]);
        if (typeof request === 'string') {
          await writeBytes(context.stdout, new TextEncoder().encode(request), signal);
          return { exitCode: 0 };
        }
        const maxInputBytes = options.limits?.maxInputBytes ?? 64 * 1024 * 1024;
        const maxModelBytes = options.limits?.maxModelBytes ?? 64 * 1024 * 1024;
        const image = request.input === 'stdin' || request.input === '-'
          ? await collectBytes(context.stdin, { signal, maxBytes: maxInputBytes })
          : await context.fs.readFile(resolvePath(context.cwd, request.input), { signal, maxBytes: maxInputBytes });
        const model = request.modelPath
          ? await context.fs.readFile(resolvePath(context.cwd, request.modelPath), { signal, maxBytes: maxModelBytes })
          : options.models?.[request.language];
        const result = await recognize(image, {
          language: request.language, psm: request.psm, dpi: request.dpi,
          ...(model === undefined ? {} : { model }),
          ...(options.limits === undefined ? {} : { limits: options.limits }), signal,
        });
        const output = new TextEncoder().encode(request.format === 'txt' ? result.text : result[request.format]);
        signal.throwIfAborted();
        if (request.output) {
          await writeFileOutput(context, output, bytes => context.fs.writeFile(resolvePath(context.cwd, request.output!), bytes, { signal }));
        } else await writeBytes(context.stdout, output, signal);
        return { exitCode: 0 };
      } catch (error) {
        signal.throwIfAborted();
        const message = error instanceof Error ? error.message : String(error);
        await writeBytes(context.stderr, new TextEncoder().encode(`tesseract: ${message}\n`), signal);
        return { exitCode: 1 };
      } finally { complete(); }
    },
  };
}

export function createTesseractCommands(options: TesseractCommandsOptions = {}): readonly CommandDefinition[] {
  return [createTesseractCommand(options)];
}

export function tesseractCommands(options: TesseractCommandsOptions = {}): VirtualShellPlugin {
  const command = createTesseractCommand(options);
  return { name: 'tesseract', setup(host) { host.commands.register(command, { replace: options.replace ?? false }); } };
}
