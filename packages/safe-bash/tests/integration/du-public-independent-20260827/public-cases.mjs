import assert from 'node:assert/strict';
import { assertDefaultNames, assertReplayBindings } from './binding-contract.mjs';

export const callableCaseIds = Object.freeze(['P01', 'R01', 'R02', 'R04', 'R05', 'E01', 'E02', 'E03']);

function exactResult(result, expected) {
  assert.equal(result.exitCode, expected.exitCode);
  assert.equal(result.stdout, expected.stdout);
  assert.equal(result.stderr, expected.stderr);
  assert.deepEqual(result.stdoutBytes, new TextEncoder().encode(expected.stdout));
  assert.deepEqual(result.stderrBytes, new TextEncoder().encode(expected.stderr));
}

async function withShell(root, filesystem, install, action) {
  const shell = new root.Shell({ fs: filesystem, env: {}, cwd: '/' });
  try {
    install(shell);
    await action(shell);
  } finally {
    await shell.dispose();
  }
}

function providerView(filesystem, override) {
  return new Proxy(filesystem, {
    get(target, property) {
      if (Object.hasOwn(override, property)) return override[property];
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export async function runPublicCases({ root, du, bindings, record }) {
  const bound = assertReplayBindings(bindings);
  assert.equal(typeof record, 'function');
  const approved = bound.approved75Inventory.names;
  async function run(id, action) {
    await action();
    await record({ id, status: 'assertions-completed', acceptanceRequiresSupervisorLoadProof: true });
  }
  await run('P01', async () => {
    for (const name of ['duCommands', 'createDuCommand', 'createDuCommands']) {
      assert.equal(typeof root[name], 'function', `root ${name}`);
      assert.equal(typeof du[name], 'function', `subpath ${name}`);
    }
    assert.equal(root.createDuCommand().name, 'du');
    assert.deepEqual(root.createDuCommands().map(command => command.name), ['du']);
    assert.equal(root.duCommands().name, 'du-commands');
    assert.equal(du.createDuCommand().name, 'du');
    assert.deepEqual(du.createDuCommands().map(command => command.name), ['du']);
    assert.equal(du.duCommands().name, 'du-commands');
  });
  await run('R01', async () => {
    assertDefaultNames(root.createAgentCommands().map(command => command.name), approved);
  });
  await run('R02', async () => {
    await withShell(root, new root.MemoryFileSystem(), shell => shell.use(root.agentCommands()), async shell => {
      exactResult(await shell.exec(':'), { exitCode: 0, stdout: '', stderr: '' });
      assertDefaultNames(shell.commands.list().map(command => command.name), approved);
      exactResult(await shell.exec('getopts a selected -a; printf "%s" "$selected"'), { exitCode: 0, stdout: 'a', stderr: '' });
      assertDefaultNames(shell.commands.list().map(command => command.name), approved);
    });
  });
  await run('R04', async () => {
    const sentinel = { name: 'du', execute: () => ({ exitCode: 71 }) };
    await withShell(root, new root.MemoryFileSystem(), shell => {
      shell.register(sentinel);
      shell.use(du.duCommands());
    }, async shell => {
      await assert.rejects(shell.exec(':'), { message: 'Command already registered: du' });
      assert.deepEqual(shell.commands.list().map(command => command.name), ['du']);
      assert.equal(shell.commands.get('du').execute, sentinel.execute);
    });
    await withShell(root, new root.MemoryFileSystem(), shell => {
      shell.register(sentinel);
      shell.use(du.duCommands({ replace: true }));
    }, async shell => {
      const result = await shell.exec('du --help');
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, '');
      assert.ok(result.stdout.length > 0);
      assert.notEqual(shell.commands.get('du').execute, sentinel.execute);
      assert.deepEqual(shell.commands.list().map(command => command.name), ['du']);
    });
  });
  await run('R05', async () => {
    const sentinel = { name: 'du', execute: () => ({ exitCode: 71 }) };
    await withShell(root, new root.MemoryFileSystem(), shell => {
      shell.register(sentinel);
      shell.use(root.agentCommands());
    }, async shell => {
      await assert.rejects(shell.exec(':'), { message: 'Command already registered: du' });
      assert.deepEqual(shell.commands.list().map(command => command.name), ['du']);
      assert.equal(shell.commands.get('du').execute, sentinel.execute);
    });
    await withShell(root, new root.MemoryFileSystem(), shell => {
      shell.register(sentinel);
      shell.use(root.agentCommands({ replace: true }));
    }, async shell => {
      exactResult(await shell.exec(':'), { exitCode: 0, stdout: '', stderr: '' });
      assertDefaultNames(shell.commands.list().map(command => command.name), approved);
      assert.notEqual(shell.commands.get('du').execute, sentinel.execute);
      assert.equal((await shell.exec('du --help')).exitCode, 0);
    });
  });
  await run('E01', async () => {
    const filesystem = new root.MemoryFileSystem();
    await filesystem.writeFile('/payload', new TextEncoder().encode('payload'));
    assert.equal((await filesystem.lstat('/payload')).allocatedBytes, undefined);
    await withShell(root, filesystem, shell => shell.use(du.duCommands()), async shell => {
      exactResult(await shell.exec('du -B1 /payload'), bound.diagnostics.unknownAllocation);
    });
  });
  await run('E02', async () => {
    const filesystem = new root.MemoryFileSystem();
    await filesystem.writeFile('/payload', new TextEncoder().encode('payload'));
    const view = providerView(filesystem, {
      async lstat(path, options) { return { ...await filesystem.lstat(path, options), allocatedBytes: 0 }; },
    });
    await withShell(root, view, shell => shell.use(du.duCommands()), async shell => {
      exactResult(await shell.exec('du -B1 /payload'), { exitCode: 0, stdout: '0\t/payload\n', stderr: '' });
      exactResult(await shell.exec('du -b /payload'), { exitCode: 0, stdout: '7\t/payload\n', stderr: '' });
    });
  });
  await run('E03', async () => {
    const filesystem = new root.MemoryFileSystem();
    await filesystem.mkdir('/usage');
    await filesystem.writeFile('/usage/z', new TextEncoder().encode('abc'));
    await filesystem.writeFile('/usage/A', new TextEncoder().encode('12345'));
    const view = providerView(filesystem, {
      async readdir(path, options) {
        const entries = await filesystem.readdir(path, options);
        return entries.slice().sort((left, right) => left.name < right.name ? 1 : left.name > right.name ? -1 : 0);
      },
    });
    await withShell(root, view, shell => shell.use(du.duCommands()), async shell => {
      exactResult(await shell.exec('du -ab /usage'), { exitCode: 0, stdout: '5\t/usage/A\n3\t/usage/z\n8\t/usage\n', stderr: '' });
      exactResult(await shell.exec('du -b /usage/z /usage/A'), { exitCode: 0, stdout: '3\t/usage/z\n5\t/usage/A\n', stderr: '' });
    });
  });
}
