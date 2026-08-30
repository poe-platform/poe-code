import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('.', import.meta.url));
assert.equal(existsSync(`${directory}reference.json`), false, 'frozen reference must not be overwritten');
const executable = '/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const executableSha256 = sha256(readFileSync(executable));
assert.equal(executableSha256, '8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c');
const environment = { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', TZ: 'UTC' };
const cwd = mkdtempSync(`${directory}.native-`);
const run = argv => {
  const result = spawnSync(executable, argv, {
    cwd, env: environment, argv0: 'shell', timeout: 3000, maxBuffer: 16384,
    input: '', shell: false,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return { argv, status: result.status, signal: result.signal,
    stdout: result.stdout.toString(), stderr: result.stderr.toString(),
    stdoutHex: result.stdout.toString('hex'), stderrHex: result.stderr.toString('hex') };
};
try {
  const version = run(['--version']);
  assert.equal(version.status, 0);
  const missing = run(['--noprofile', '--norc', '-c', 'cat < missing.txt']);
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, '');
  assert.equal(missing.stderr, 'shell: line 1: missing.txt: No such file or directory\n');
  assert.deepEqual(readdirSync(cwd), []);
  const sources = [];
  for (const [url, excerpt] of [
    ['https://raw.githubusercontent.com/bminor/glibc/glibc-2.42/sysdeps/gnu/errlist.h', '_S(EROFS, N_("Read-only file system"))'],
    ['https://raw.githubusercontent.com/mirror/bash/bash-5.3/redir.c', 'internal_error ("%s: %s", filename, strerror (error));'],
    ['https://raw.githubusercontent.com/mirror/bash/bash-5.3/execute_cmd.c', 'case EX_REDIRFAIL:'],
    ['https://raw.githubusercontent.com/mirror/bash/bash-5.3/shell.h', '#define EXECUTION_FAILURE 1'],
  ]) {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.length < 300000);
    const text = bytes.toString();
    assert.ok(text.includes(excerpt), `${url}: required source excerpt`);
    sources.push({ url, sha256: sha256(bytes), excerpt,
      line: text.slice(0, text.indexOf(excerpt)).split('\n').length });
  }
  const evidence = {
    capturedAt: new Date().toISOString(), productImported: false, nativeCalls: 2,
    executable, executableSha256, argv0: 'shell', environment, cwd, version,
    missing: { ...missing, namespaceBefore: [], namespaceAfter: [], normalizations: [] },
    readonly: { kind: 'primary-source profile, NOT native EROFS execution',
      reason: 'No read-only filesystem inside the owned temporary directory; no host mutation, chmod, remount, or EACCES substitution attempted.',
      sources, status: 1, stdout: '', stderr: 'shell: line 1: target.txt: Read-only file system\n',
      inference: 'Bash 5.3 renders filename plus strerror; glibc 2.42 C-locale EROFS wording. Prefix is independently executed above. Redirection failure maps to EXECUTION_FAILURE (1). This pins a GNU profile, not Darwin libc or a live EROFS result.',
    },
  };
  const filename = 'tests/integration/adapter-tools-diagnostics/reference.json';
  const patch = `*** Begin Patch\n*** Add File: ${filename}\n${JSON.stringify(evidence, null, 2).split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`;
  const result = spawnSync('apply_patch', [], { input: patch, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  console.log(result.stdout.trim());
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
