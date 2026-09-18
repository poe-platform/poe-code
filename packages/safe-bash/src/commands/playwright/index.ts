import { createPlaywrightController, type PlaywrightControllerOptions } from '../../playwright/index.js';
import type { VirtualShellPlugin } from '../../contracts/plugin.js';
import { dirname, resolvePath } from '../../contracts/path.js';
import { writeBytes } from '../../contracts/io.js';
import { isPlaywrightResourceLimitError } from '../../playwright/resource-limit.js';

export type PlaywrightCliOptions = PlaywrightControllerOptions & { readonly replace?: boolean };

function errorMessage(error: unknown): string {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  const pending = [error];
  while (pending.length && seen.size < 32) {
    const item = pending.shift();
    if (seen.has(item)) continue;
    seen.add(item);
    const message = item instanceof Error ? item.message : String(item);
    if (!messages.includes(message)) messages.push(message);
    if (item instanceof AggregateError) pending.unshift(...item.errors.slice(0, 32 - seen.size));
  }
  return messages.join(': ');
}

/** Host-owned qualified agent subset; never installed by agentCommands. */
export function createPlaywrightCli(options: PlaywrightCliOptions = {}) {
  if (options?.replace !== undefined && typeof options.replace !== 'boolean') throw new TypeError('Invalid Playwright replacement option');
  const { replace, ...controllerOptions } = options;
  const controller = createPlaywrightController(controllerOptions);
  const plugin: VirtualShellPlugin = {
    name: 'playwright-cli',
    setup(host) {
      host.commands.register({
        name: 'playwright-cli',
        description: 'Playwright commands selected and implemented by injected client abilities',
        async execute(context) {
          try {
            await controller.run({
              args: context.args,
              env: context.env,
              signal: context.signal,
              registerCleanup: context.registerCleanup,
              workspace: {
                cwd: context.cwd,
                ...(context.env.HOME ? { home: context.env.HOME } : {}),
                async mkdir(filename) { await context.fs.mkdir(resolvePath(context.cwd, filename), { recursive: true, signal: context.signal }); },
                async exists(filename) {
                  try { await context.fs.stat(resolvePath(context.cwd, filename), { signal: context.signal }); return true; }
                  catch (error) { if (error && typeof error === 'object' && Reflect.get(error, 'code') === 'ENOENT') return false; throw error; }
                },
                async listFiles(directory, maxEntries) {
                  const pending = [resolvePath(context.cwd, directory)];
                  const files: { filename: string; size: number; mtimeMs: number }[] = [];
                  let visited = 0;
                  while (pending.length) {
                    const path = pending.pop()!;
                    let entries;
                    try { entries = await context.fs.readdir(path, { signal: context.signal, maxEntries: maxEntries - visited }); }
                    catch (error) { if (error && typeof error === 'object' && Reflect.get(error, 'code') === 'ENOENT') continue; throw error; }
                    visited += entries.length;
                    if (visited > maxEntries) throw new Error('Playwright output directory entry limit exceeded');
                    for (const entry of entries) {
                      const filename = resolvePath(path, entry.name);
                      if (entry.type === 'directory') pending.push(filename);
                      else if (entry.type === 'file') {
                        const stat = await context.fs.stat(filename, { signal: context.signal });
                        if (stat.type === 'file') files.push({ filename, size: stat.size, mtimeMs: stat.mtimeMs });
                      }
                    }
                  }
                  return files;
                },
                async removeFile(filename) { await context.fs.rm(filename, { signal: context.signal }); },
              },
              readArtifact: async (filename, maxBytes) => {
                context.signal.throwIfAborted();
                const path = resolvePath(context.cwd, filename);
                const bytes = await context.fs.readFile(path, { signal: context.signal, maxBytes });
                if (bytes.byteLength > maxBytes) throw new Error('Artifact byte limit exceeded');
                return bytes;
              },
              writeArtifact: async (bytes, filename) => {
                context.signal.throwIfAborted();
                if (filename === undefined) await writeBytes(context.stdout, bytes, context.signal);
                else {
                  const path = resolvePath(context.cwd, filename);
                  await context.fs.mkdir(dirname(path), { recursive: true, signal: context.signal });
                  await context.fs.writeFile(path, bytes, { signal: context.signal });
                }
              },
              write: text => writeBytes(context.stdout, new TextEncoder().encode(text), context.signal),
            });
            return { exitCode: 0 };
          } catch (error) {
            context.signal.throwIfAborted();
            const end = context.args.indexOf('--');
            if (!isPlaywrightResourceLimitError(error) && context.args.slice(0, end === -1 ? undefined : end).includes('--json')) {
              await writeBytes(context.stdout, new TextEncoder().encode(JSON.stringify({ isError: true, error: errorMessage(error) }, null, 2) + '\n'), context.signal);
              return { exitCode: 1 };
            }
            await writeBytes(context.stderr, new TextEncoder().encode(`playwright-cli: ${errorMessage(error)}\n`), context.signal);
            return { exitCode: 1 };
          }
        },
      }, { replace: replace ?? false });
    },
    dispose: controller.dispose,
  };
  return { plugin, dispose: controller.dispose, restoreSession: controller.restoreSession, inspectSessions: controller.inspectSessions };
}

export * from '../../playwright/index.js';
