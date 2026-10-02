import { Shell, agentCommands, commandRuntimeIdentity, CommandArgumentIdentityError } from '@poe-platform/safe-bash';
import * as contracts from '@poe-platform/safe-bash/contracts/command';
import { shellValueFromBytes } from '@poe-platform/safe-bash/contracts/value';
import { MemoryFileSystem } from '@poe-platform/safe-fs/core';
import { createPlaywrightCli, PlaywrightCheckpointError, PlaywrightResourceLimitError } from '@poe-platform/safe-bash/commands/playwright';
import * as alias from '@poe-platform/safe-bash/playwright';
const assert = (value, message) => { if (!value) throw new Error(message); };
export const verification = (async () => {
  assert(commandRuntimeIdentity === contracts.commandRuntimeIdentity, 'canonical command argv identity');
  assert(CommandArgumentIdentityError === contracts.CommandArgumentIdentityError, 'canonical argv error identity');
  const carrier = contracts.createCommandArguments([shellValueFromBytes(Uint8Array.of(255))]);
  assert(contracts.getCommandArguments({ args: carrier.args, argumentValues: carrier }) === carrier, 'canonical value carrier identity');
  assert(alias.createPlaywrightCli === createPlaywrightCli, 'public command route identity');
  assert(alias.PlaywrightCheckpointError === PlaywrightCheckpointError, 'checkpoint error identity');
  assert(alias.PlaywrightResourceLimitError === PlaywrightResourceLimitError, 'resource error identity');
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands());
  assert((await shell.exec('true')).exitCode === 0, 'default commands installed');
  assert(!shell.commands.has('playwright-cli'), 'optional command is absent from defaults');
  const cli = createPlaywrightCli();
  shell.use(cli.plugin);
  let argvBytes;
  shell.use({ name: 'packed-byte-producer', setup(host) {
    host.commands.register({ name: 'raw-byte', async execute(context) {
      await context.stdout.write(Uint8Array.of(255)); return { exitCode: 0 };
    } });
  } });
  shell.use(async (context, next) => {
    if (context.command === 'playwright-cli' && context.args.length === 2) argvBytes = contracts.getCommandArguments(context).bytes(1);
    return next();
  });
  await shell.exec('playwright-cli --help "$(raw-byte)"');
  assert(argvBytes?.length === 1 && argvBytes[0] === 255, 'Shell-created raw argv identity');
  await fs.writeFile('/help.sh', new TextEncoder().encode('playwright-cli --help | cat'));
  const help = await shell.exec('sh /help.sh');
  assert(help.exitCode === 0 && help.stdout.includes('playwright-cli'), 'VFS script and pipeline');
  assert((await shell.exec('playwright-cli open https://offline.invalid')).exitCode === 1, 'no implicit browser capability');
  let collision = false;
  try { await createPlaywrightCli().plugin.setup(shell); } catch { collision = true; }
  assert(collision, 'registration collision');
  shell.use(createPlaywrightCli({ replace: true }).plugin);
  const abort = new AbortController();
  const cancellation = new Error('packed caller cancellation'); abort.abort(cancellation);
  let cancelled = false;
  try { await shell.exec('playwright-cli --help', { signal: abort.signal }); } catch (error) { cancelled = error === cancellation; }
  assert(cancelled, 'caller cancellation reason identity');
  await shell.dispose();
  const sessions = [];
  let releases = 0;
  const page = { async goto() {}, url: () => 'about:blank' };
  const injected = createPlaywrightCli({ adapter: {
    browsers: { chromium: { headed: false } },
    async acquire(request) {
      sessions.push(request.session);
      return { context: { async newPage() { return page; }, pages: () => [page], async close() {}, on() {}, off() {} },
        onClosed() { return () => {}; }, async release() { releases++; } };
    },
  } });
  const injectedShell = new Shell({ fs: new MemoryFileSystem() }).use(injected.plugin);
  const opened = await injectedShell.exec('playwright-cli -s=packed open');
  assert(opened.exitCode === 0, 'injected browser acquisition: ' + opened.stdout + opened.stderr);
  assert(sessions.length === 1 && sessions[0] === 'packed', 'session identity through packed adapter');
  const closed = await injectedShell.exec('playwright-cli -s=packed close');
  assert(closed.exitCode === 0 && releases === 1, 'injected browser release');
  await injectedShell.dispose();
})();
