import { Shell, standardCommands, createMemoryFileSystem, FsError } from '@poe-platform/safe-bash';
import { FsError as CanonicalFsError } from '@poe-platform/safe-fs/core';
import { xmlCommands } from '@poe-platform/safe-bash/commands/xml';

export const verification = (async () => {
  if (FsError !== CanonicalFsError) throw new Error('XML filesystem identity diverged');
  const fs = createMemoryFileSystem();
  const encoder = new TextEncoder();
  await fs.writeFile('/input', encoder.encode('<root><item/><item/></root>'));
  await fs.writeFile('/run.sh', encoder.encode("cat /input | xmllint --xpath 'count(/root/item)'\n"));
  const shell = new Shell({ fs }).use(standardCommands()).use(xmlCommands());
  try {
    const script = await shell.exec('sh /run.sh');
    if (script.exitCode !== 0 || script.stdout !== '2\n') throw new Error('Portable XML pipe/script failed');
    const query = await shell.exec("xq '.root.item | length' /input");
    if (query.exitCode !== 0 || query.stdout.trim() !== '2') throw new Error('Portable shared XML tree failed');
    const controller = new AbortController();
    const reason = new Error('portable XML cancellation');
    let retired = false;
    const stdin = (async function* () {
      try { yield encoder.encode('<root/>'); controller.abort(reason); }
      finally { retired = true; }
    })();
    let failure;
    try { await shell.exec('xmllint --noout', { stdin, signal: controller.signal }); }
    catch (error) { failure = error; }
    if (failure !== reason || !retired) throw new Error('Portable XML cancellation identity/retirement failed');
    xmlCommands({ replace: true, limits: { maxNodes: 1 } }).setup({ commands: shell.commands });
    if ((await shell.exec('xmllint --noout /input')).exitCode !== 5) throw new Error('Portable XML node admission failed');
  } finally { await shell.dispose(); }
})();
await verification;
