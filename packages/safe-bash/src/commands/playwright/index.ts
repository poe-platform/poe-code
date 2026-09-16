import { createPlaywrightController, type PlaywrightControllerOptions } from '../../playwright/index.js';
import type { VirtualShellPlugin } from '../../contracts/plugin.js';
import { resolvePath } from '../../contracts/path.js';
import { writeBytes } from '../../contracts/io.js';

export type PlaywrightCliOptions = PlaywrightControllerOptions & { readonly replace?: boolean };

/** Host-owned qualified agent subset; never installed by agentCommands. */
export function createPlaywrightCli(options: PlaywrightCliOptions = {}): { readonly plugin: VirtualShellPlugin; dispose(): Promise<void> } {
  if (options?.replace !== undefined && typeof options.replace !== 'boolean') throw new TypeError('Invalid Playwright replacement option');
  const { replace, ...controllerOptions } = options;
  const controller = createPlaywrightController(controllerOptions);
  const plugin: VirtualShellPlugin = {
    name: 'playwright-cli',
    setup(host) {
      host.commands.register({
        name: 'playwright-cli',
        description: 'Qualified injected subset: sessions, DOM snapshot refs, click/fill/press, screenshots, tabs',
        async execute(context) {
          try {
            await controller.run({
              args: context.args,
              env: context.env,
              signal: context.signal,
              registerCleanup: context.registerCleanup,
              writeArtifact: async (bytes, filename) => {
                context.signal.throwIfAborted();
                if (filename === undefined) await writeBytes(context.stdout, bytes, context.signal);
                else await context.fs.writeFile(resolvePath(context.cwd, filename), bytes, { signal: context.signal });
              },
              write: text => writeBytes(context.stdout, new TextEncoder().encode(text), context.signal),
            });
            return { exitCode: 0 };
          } catch (error) {
            context.signal.throwIfAborted();
            await writeBytes(context.stderr, new TextEncoder().encode(`playwright-cli: ${error instanceof Error ? error.message : String(error)}\n`), context.signal);
            return { exitCode: 1 };
          }
        },
      }, { replace: replace ?? false });
    },
    dispose: controller.dispose,
  };
  return { plugin, dispose: controller.dispose };
}

export * from '../../playwright/index.js';
