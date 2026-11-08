import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryFileSystem } from '@poe-code/safe-fs/core';
import { Shell } from '../../safe-bash/src/shell/shell.js';
import { standardCommands } from '../../safe-bash/src/commands/index.js';
import { nodeCommands } from './index.js';

test('QuickJS evaluates modern JavaScript without ambient host capabilities', async () => {
  const shell = new Shell({fs:createMemoryFileSystem()}).use(standardCommands()).use(nodeCommands());
  const result = await shell.exec(`node -p 'JSON.stringify([2n ** 10n + "", typeof fetch, typeof process.binding])'`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, '["1024","undefined","undefined"]\n');
});

test('script, CommonJS modules, and binary data use the same safe-fs as the shell', async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile('/module.cjs', new TextEncoder().encode('module.exports = 42;'));
  await fs.writeFile('/main.cjs', new TextEncoder().encode(`
    const fs = require('node:fs');
    fs.writeFileSync('/result', Buffer.from([0, 255, require('./module.cjs')]));
    console.log(fs.readFileSync('/result')[1], process.argv[2]);
  `));
  const shell = new Shell({ fs }).use(standardCommands()).use(nodeCommands());
  const result = await shell.exec('node /main.cjs hello');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, '255 hello\n');
  assert.deepEqual(await fs.readFile('/result'), new Uint8Array([0, 255, 42]));
});

test('child_process dispatches shell syntax and literal argv through safe-bash', async () => {
  const shell = new Shell({fs:createMemoryFileSystem()}).use(standardCommands()).use(nodeCommands());
  const result = await shell.exec(`node -e 'const cp = require("node:child_process"); console.log(cp.execSync("printf hello | cat", {encoding:"utf8"})); console.log(cp.execFileSync("printf", ["%s", "a; echo unsafe"], {encoding:"utf8"}));'`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, 'hello\na; echo unsafe\n');
});

test('stdin scripts and guest failures report the correct status', async () => {
  const shell = new Shell({fs:createMemoryFileSystem()}).use(standardCommands()).use(nodeCommands());
  const result = await shell.exec(`printf 'console.log(6*7)' | node`);
  assert.equal(result.stdout, '42\n');
  assert.equal((await shell.exec(`node -e 'throw new Error("guest failure")'`)).exitCode, 1);
  assert.equal((await shell.exec(`node -e 'process.exitCode = 7'`)).exitCode, 7);
});

test('bounds terminate infinite execution and excessive output', async () => {
  const shell = new Shell({fs:createMemoryFileSystem()}).use(standardCommands()).use(nodeCommands({limits:{timeoutMs:100, outputBytes:100}}));
  assert.notEqual((await shell.exec(`node -e 'while(true) {}'`)).exitCode, 0);
  assert.notEqual((await shell.exec(`node -e 'console.log("x".repeat(101))'`)).exitCode, 0);
});

test('filesystem errors retain codes and unavailable native modules fail closed', async () => {
  const shell = new Shell({fs:createMemoryFileSystem()}).use(standardCommands()).use(nodeCommands());
  const result = await shell.exec(`node -e 'try {require("fs").readFileSync("/absent")} catch(e) { console.log(e.code) }'`);
  assert.equal(result.stdout, 'ENOENT\n');
  assert.notEqual((await shell.exec(`node -e 'require("node:net")'`)).exitCode, 0);
});
