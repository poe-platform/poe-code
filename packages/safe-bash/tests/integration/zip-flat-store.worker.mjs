import { Shell, archiveCommands, standardCommands } from '@poe-platform/safe-bash';
import { flatStore } from '../commands/zip-flat-store.helpers.ts';

export default {
  async fetch() {
    const host = flatStore();
    const binary = new Uint8Array([137, 80, 78, 71, 0, 255, 128]);
    const absent = new Uint8Array([0, 254, 10]);
    host.write('/work/colored/cat.png', binary);
    host.write('/work/colored/dog.png', absent);
    const shell = new Shell({ fs: host.fs }).use(standardCommands()).use(archiveCommands());
    const command = 'cd /work/colored && zip -j /work/colored_animals.zip *.png && ls -la /work/colored_animals.zip';
    const destination = '/work/colored_animals.zip';
    try {
      const created = await shell.exec(command);
      await host.fs.rm('/work/colored/dog.png');
      const replacement = new Uint8Array([255, 0, 42, 13, 10]);
      host.write('/work/colored/cat.png', replacement);
      host.write('/work/colored/fox.png', binary);
      host.alias('/work/colored/archive.png', destination);
      const updated = await shell.exec(command);
      const payloads = [];
      for (const name of ['cat.png', 'dog.png', 'fox.png']) {
        const result = await shell.exec(`unzip -p ${destination} ${name}`);
        payloads.push({ name, status: result.exitCode, bytes: Array.from(result.stdoutBytes), stderr: result.stderr });
      }
      const before = await host.fs.readFile(destination);
      host.beforeCommit = () => { throw new Error('upload failed'); };
      const failed = await shell.exec(command);
      const after = await host.fs.readFile(destination);
      return Response.json({ created: { status: created.exitCode, stderr: created.stderr },
        updated: { status: updated.exitCode, stderr: updated.stderr }, payloads,
        failed: failed.exitCode, preserved: before.length === after.length && before.every((byte, index) => byte === after[index]),
        paths: [...host.rows.keys()], publications: host.publications });
    } finally { await shell.dispose(); }
  },
};
