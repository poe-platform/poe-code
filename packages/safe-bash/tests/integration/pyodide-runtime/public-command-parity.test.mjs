import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { Shell, agentCommands } from 'poe-code/safe-bash';
import { MemoryFileSystem } from 'poe-code/safe-fs/core';
import { pythonCommands } from 'poe-code/safe-bash/commands/python';
import { createNodePythonWorker } from 'poe-code/safe-bash/commands/python/node';

// Opt-in integration only: host files are native oracle fixtures, never unit fixtures.
// Assets and the exact CPython version must be installed before this suite runs.
const runtimeModuleURL = process.env.SAFE_BASH_PYODIDE_RUNTIME_URL
  ?? new URL('./node_modules/pyodide/pyodide.mjs', import.meta.url).href;
const quote = value => "'" + value.split("'").join("'\\''") + "'";
const code = source => '-c ' + quote(source);
const encoder = new TextEncoder();

async function fixture(t) {
  const nativePython = process.env.SAFE_BASH_NATIVE_PYTHON;
  assert.ok(nativePython && isAbsolute(nativePython),
    'Provision matched CPython outside tests and set SAFE_BASH_NATIVE_PYTHON to its absolute executable');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'safe-bash-python-parity-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fs = new MemoryFileSystem();
  await fs.mkdir(root, { recursive: true });
  const bin = join(root, 'bin');
  await mkdir(bin);
  for (const alias of ['python', 'python3']) await symlink(nativePython, join(bin, alias));
  const env = { PATH: bin + ':/usr/bin:/bin', HOME: root, PYTHONDONTWRITEBYTECODE: '1', APPLICATION_VALUE: 'café two words' };
  const shell = new Shell({ fs, cwd: root, env }).use(agentCommands()).use(pythonCommands({
    createWorker: () => createNodePythonWorker({ runtimeModuleURL, trustedPython: true }),
  }));
  t.after(() => shell.dispose());
  t.diagnostic("Node " + process.version + "; " + spawnSync("/bin/bash", ["--version"], { encoding: "utf8" }).stdout.split("\n")[0]);
  async function file(name, content, mode = 0o644) {
    const path = join(root, name);
    const bytes = typeof content === 'string' ? encoder.encode(content) : content;
    await writeFile(path, bytes, { mode });
    await fs.writeFile(path, bytes, { mode });
  }
  async function directory(name) {
    await mkdir(join(root, name));
    await fs.mkdir(join(root, name));
  }
  function native(command, stdin) {
    const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', command], {
      cwd: root, env, input: stdin, timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null, 'Native oracle must complete without a signal');
    return { exitCode: result.status, stdoutBytes: new Uint8Array(result.stdout), stderrBytes: new Uint8Array(result.stderr) };
  }
  async function compare(command, stdin, effects = []) {
    const expected = native(command, stdin);
    const actual = await shell.exec(command, { stdin });
    assert.equal(actual.exitCode, expected.exitCode, command + '\n' + actual.stderr);
    assert.deepEqual(actual.stdoutBytes, expected.stdoutBytes, command + ' stdout\nnative: '
      + JSON.stringify(new TextDecoder().decode(expected.stdoutBytes)) + '\nsafe-bash: ' + JSON.stringify(actual.stdout));
    assert.deepEqual(actual.stderrBytes, expected.stderrBytes, command + ' stderr\nnative: '
      + JSON.stringify(new TextDecoder().decode(expected.stderrBytes)) + '\nsafe-bash: ' + JSON.stringify(actual.stderr));
    for (const name of effects) assert.deepEqual(await fs.readFile(join(root, name)),
      new Uint8Array(await readFile(join(root, name))), name + ' canonical file effect');
    return actual;
  }
  const versionSource = 'import sys; print(".".join(map(str,sys.version_info[:3])))';
  const nativeVersion = native('python ' + code(versionSource));
  const guestVersion = await shell.exec('python3 ' + code(versionSource));
  assert.equal(guestVersion.exitCode, 0, guestVersion.stderr);
  assert.deepEqual(guestVersion.stdoutBytes, nativeVersion.stdoutBytes,
    'Exact CPython patch version mismatch: differential evidence requires matched versions');
  const runtimeIdentity = await shell.exec('python ' + code('import pyodide,sys,struct,json; print(json.dumps([pyodide.__version__,sys.platform,struct.calcsize("P"),sys.executable]))'));
  assert.equal(runtimeIdentity.exitCode, 0, runtimeIdentity.stderr);
  const identity = JSON.parse(runtimeIdentity.stdout);
  assert.equal(identity[1], 'emscripten');
  assert.equal(identity[2], 4);
  t.diagnostic('Intentional runtime identity [Pyodide, platform, pointer bytes, executable]: ' + runtimeIdentity.stdout.trim());
  const nativeIdentity = native('python ' + code('import sys,struct,json; print(json.dumps([sys.platform,struct.calcsize("P"),sys.executable]))'));
  t.diagnostic('Native identity [platform, pointer bytes, executable]: ' + new TextDecoder().decode(nativeIdentity.stdoutBytes).trim());
  t.diagnostic('Matched CPython ' + guestVersion.stdout.trim() + '; native Bash and public built Pyodide command exports');
  return { root, fs, shell, file, directory, compare };
}

const metadata = `import sys,json,os,__main__
assert __main__.__dict__ is globals()
print(json.dumps([__name__,globals().get('__file__'),__package__,sys.argv,sys.path[0],os.getcwd(),os.environ['APPLICATION_VALUE']],ensure_ascii=False))`;

test('built public Python aliases match native CPython-in-Bash command and file behavior', async t => {
  const { compare, file, directory } = await fixture(t);
  await directory('pkg');
  await directory('other');
  await file('entry.py', metadata);
  await file('local.py', 'value = "local café"\n');
  await file('pkg/__init__.py', 'value = 42\n');
  await file('pkg/__main__.py', metadata);
  await file('pkg/helper.py', 'from . import value\n');
  await file('binary.in', Uint8Array.of(0, 255, 128, 10, 13, 0));
  const argumentsText = ' "two words" "" "café 日本語" --flag';
  for (const alias of ['python', 'python3']) {
    const cases = [
      ['file arguments and metadata', alias + ' entry.py' + argumentsText],
      ['inline arguments and metadata', alias + ' ' + code(metadata) + argumentsText],
      ['module arguments and metadata', alias + ' -m pkg' + argumentsText],
      ['explicit stdin arguments and metadata', alias + ' -' + argumentsText, metadata],
      ['implicit stdin metadata', alias, metadata],
      ['local and relative package imports', alias + ' ' + code('import local,pkg.helper; print(local.value,pkg.helper.value)')],
      ['cwd and environment mutation', 'cd other; APPLICATION_VALUE="child env" ' + alias + ' ' + code('import os; print(os.getcwd(),os.environ["APPLICATION_VALUE"])')],
      ['uncaught exception stderr', alias + ' ' + code('raise ValueError("guest failure")')],
      ['nested inline traceback', alias + ' ' + code('def fail():\n    return 1 / 0\nfail()')],
      ['nested explicit stdin traceback', alias + ' -', 'def fail():\n    return 1 / 0\nfail()'],
      ['chained inline traceback', alias + ' ' + code('try:\n    raise ValueError("first")\nexcept ValueError as error:\n    raise RuntimeError("second") from error')],
      ['indented inline source', alias + ' ' + code('    print("dedented")\n')],
      ['explicit relative script path', alias + ' ./entry.py' + argumentsText],
      ['parent relative script path', alias + ' other/../entry.py' + argumentsText],
      ['syntax error stderr', alias + ' ' + code('if True')],
      ['success stderr', alias + ' ' + code('import sys; print("out"); print("err",file=sys.stderr)')],
      ['numeric failure status', alias + ' ' + code('raise SystemExit(7)')],
      ['negative failure status', alias + ' ' + code('raise SystemExit(-1)')],
      ['wrapped failure status', alias + ' ' + code('raise SystemExit(256)')],
      ['string failure and stderr', alias + ' ' + code('raise SystemExit("failure café")')],
      ['shell status', alias + ' ' + code('raise SystemExit(9)') + '; echo $?'],
      ['heredoc', alias + " - <<'PY'\n" + metadata + '\nPY'],
      ['binary stdin stdout stderr', alias + ' ' + code('import sys; b=sys.stdin.buffer.read(); sys.stdout.buffer.write(b); sys.stderr.buffer.write(b)'), Uint8Array.of(0,255,128,10,13)],
      ['binary pipeline and redirect', alias + ' ' + code('import sys; sys.stdout.buffer.write(bytes([0,255,128,10]))') + ' | ' + alias + ' ' + code('import sys; sys.stdout.buffer.write(sys.stdin.buffer.read())') + ' > captured.bin', undefined, ['captured.bin']],
      ['input and stderr redirects', alias + ' ' + code('import sys; sys.stderr.buffer.write(sys.stdin.buffer.read())') + ' < binary.in 2> errors.bin', undefined, ['errors.bin']],
      ['random access and shell reopen', alias + ' ' + code('f=open("seek.bin","w+b"); f.write(b"abcdef"); f.seek(2); f.write(b"XY"); f.truncate(5); f.close()') + '; cat seek.bin', undefined, ['seek.bin']],
    ];
    for (const [name, command, stdin, effects] of cases) await t.test(alias + ': ' + name,
      () => compare(command, stdin, effects));
    await t.test(alias + ': executable env shebang', async () => {
      await file('script', '#!/usr/bin/env ' + alias + '\n' + metadata, 0o755);
      await compare('./script' + argumentsText);
    });
  }
});

test('built public Python invocations isolate interpreter state and observe canonical edits', async t => {
  const { compare, file, directory, root, shell, fs } = await fixture(t);
  await directory('other');
  await file('local.py', 'value = 1\n');
  await compare('python ' + code('import os,sys,builtins,local; local.value=99; builtins.leaked=True; os.environ["LEAK"]="yes"; os.chdir("other"); sys.path[:]=[]; print("mutated")'));
  await file('local.py', 'value = 222\n');
  await compare('python3 ' + code('import os,builtins,local; assert not hasattr(builtins,"leaked"); assert "LEAK" not in os.environ; print(os.getcwd(),local.value)'));
  await fs.writeFile(join(root, 'canonical.txt'), encoder.encode('canonical edit'));
  const read = await shell.exec('python ' + code('from pathlib import Path; print(Path("canonical.txt").read_text()); Path("canonical.txt").write_text("python edit")'));
  assert.equal(read.exitCode, 0, read.stderr);
  assert.equal(read.stdout, 'canonical edit\n');
  assert.equal(new TextDecoder().decode(await fs.readFile(join(root, 'canonical.txt'))), 'python edit');
  assert.equal((await shell.exec('cat canonical.txt')).stdout, 'python edit');
});
