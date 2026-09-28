import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createGitCommand, createGitCommands, gitCommands } from './index.js';
import type { CommandContext } from 'safe-bash-contracts';

test('zero-argument factories run Rust Git against safe-fs', async () => {
  assert.equal(createGitCommands()[0]?.name, 'git');
  assert.equal(gitCommands().name, 'git-commands');
  const fs = new MemoryFileSystem();
  await fs.mkdir('/repo', {recursive:true});
  const command = createGitCommand();
  const run = async (args: string[], cwd='/repo') => {
    let stdout='', stderr='';
    const context = {command:'git', args, cwd, env:{}, fs, signal:new AbortController().signal,
      stdin: (async function*(){})(), stdout: {write(bytes: Uint8Array){stdout+=new TextDecoder().decode(bytes);}},
      stderr: {write(bytes: Uint8Array){stderr+=new TextDecoder().decode(bytes);}}} as CommandContext;
    const result=await command.execute(context);
    assert.equal(result.exitCode,0,stderr);
    return stdout;
  };
  await run(['init','-b','main']);
  await fs.writeFile('/repo/a',new TextEncoder().encode('one\n'));
  await run(['add','.']);
  await run(['commit','-m','first']);
  assert.equal(await run(['rev-parse','--abbrev-ref','HEAD']),'main\n');
  await fs.writeFile('/repo/a',new TextEncoder().encode('two\n'));
  assert.match(await run(['diff']),/-one\n\+two\n/u);
  await run(['reset','--hard']);
  assert.equal(new TextDecoder().decode(await fs.readFile('/repo/a')),'one\n');
});

test('resource exhaustion leaves safe-fs unchanged', async () => {
  const fs=new MemoryFileSystem();
  await fs.writeFile('/large',new Uint8Array(64));
  let stderr='';
  const result=await createGitCommand({limits:{maxBytes:32}}).execute({command:'git',args:['init'],cwd:'/',env:{},fs,
    signal:new AbortController().signal,stdin:(async function*(){})(),stdout:{write(){}},stderr:{write(bytes:Uint8Array){stderr+=new TextDecoder().decode(bytes);}}} as CommandContext);
  assert.equal(result.exitCode,128);
  assert.match(stderr,/limit/u);
  assert.equal((await fs.readFile('/large')).length,64);
  await assert.rejects(fs.stat('/.git'));
});

test('HTTP is supplied explicitly by the host', async () => {
  const fs=new MemoryFileSystem();
  await fs.mkdir('/repo/.git',{recursive:true});
  await fs.writeFile('/repo/.git/HEAD',new TextEncoder().encode('ref: refs/heads/main\n'));
  await fs.writeFile('/repo/.git/config',new TextEncoder().encode('[remote "origin"]\nurl = https://git.example/repo.git\n'));
  let url='',stderr='';
  const result=await createGitCommand({http:async request=>{url=request.url;throw new Error('host denied network');}}).execute({command:'git',args:['fetch','--prune','origin','main'],cwd:'/repo',env:{},fs,
    signal:new AbortController().signal,stdin:(async function*(){})(),stdout:{write(){}},stderr:{write(bytes:Uint8Array){stderr+=new TextDecoder().decode(bytes);}}} as CommandContext);
  assert.equal(result.exitCode,128);
  assert.match(url,/^https:\/\/git\.example\/repo\.git\/info\/refs/u);
  assert.match(stderr,/host denied network/u);
});

test('Git works with the Shell default device filesystem', async () => {
  const {createDeviceFileSystem}=await import('@poe-code/safe-fs/core');
  const memory=new MemoryFileSystem();
  await memory.mkdir('/repo',{recursive:true});
  const fs=createDeviceFileSystem(memory);
  let stderr='';
  const result=await createGitCommand().execute({command:'git',args:['init'],cwd:'/repo',env:{},fs,signal:new AbortController().signal,
    stdin:(async function*(){})(),stdout:{write(){}},stderr:{write(bytes:Uint8Array){stderr+=new TextDecoder().decode(bytes);}}} as CommandContext);
  assert.equal(result.exitCode,0,stderr);
  assert.equal((await memory.stat('/repo/.git')).type,'directory');
});

test('cat-file preserves binary object bytes', async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/repo', {recursive:true});
  const command = createGitCommand();
  const run = async (args: string[]) => {
    const chunks: Uint8Array[] = [];
    let stderr = '';
    const result = await command.execute({command:'git',args,cwd:'/repo',env:{},fs,
      signal:new AbortController().signal,stdin:(async function*(){})(),
      stdout:{write(bytes:Uint8Array){chunks.push(bytes.slice());}},
      stderr:{write(bytes:Uint8Array){stderr+=new TextDecoder().decode(bytes);}}} as CommandContext);
    assert.equal(result.exitCode,0,stderr);
    return Uint8Array.from(chunks.flatMap(chunk=>Array.from(chunk)));
  };
  await run(['init']);
  const binary = Uint8Array.of(0,255,128,65,10);
  await fs.writeFile('/repo/binary',binary);
  const oid = new TextDecoder().decode(await run(['hash-object','-w','binary'])).trim();
  assert.deepEqual(await run(['cat-file','-p',oid]),binary);
});

test("extended porcelain and plumbing commands work over safe-fs WASM", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/repo", { recursive: true });
  const command = createGitCommand();
  const run = async (args: string[]) => {
    let stdout = "";
    let stderr = "";
    const result = await command.execute({
      command: "git",
      args,
      cwd: "/repo",
      env: {},
      fs,
      signal: new AbortController().signal,
      stdin: (async function* () {})(),
      stdout: { write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
    } as CommandContext);
    assert.equal(result.exitCode, 0, stderr);
    return stdout;
  };
  await run(["init"]);
  await run(["config", "user.name", "Safe Bash User"]);
  await run(["config", "user.email", "safe@example.com"]);
  await fs.writeFile("/repo/hello.txt", new TextEncoder().encode("Alpha line\nBeta line\n"));
  await run(["add", "hello.txt"]);
  await run(["commit", "-m", "initial commit"]);
  await run(["tag", "v0.1.0"]);

  assert.equal((await run(["describe", "--tags"])).trim(), "v0.1.0");
  assert.match(await run(["shortlog", "-sn"]), /Safe Bash User/u);
  assert.match(await run(["grep", "-n", "Beta"]), /hello\.txt:2:Beta line/u);
  assert.match(await run(["blame", "-L", "1,1", "hello.txt"]), /1\) Alpha line/u);

  await run(["notes", "add", "-m", "verified in wasm", "HEAD"]);
  assert.equal((await run(["notes", "show", "HEAD"])).trim(), "verified in wasm");
  assert.match(await run(["reflog", "show", "HEAD"]), /HEAD@\{0\}:/u);

  await fs.writeFile("/repo/extra.txt", new TextEncoder().encode("temporary\n"));
  await run(["add", "extra.txt"]);
  await run(["commit", "-m", "add extra"]);
  const patchFile = (await run(["format-patch", "-1"])).trim();
  assert.match(patchFile, /\.patch$/u);

  await run(["revert", "HEAD"]);
  await assert.rejects(fs.stat("/repo/extra.txt"));

  await run(["am", patchFile]);
  assert.equal(new TextDecoder().decode(await fs.readFile("/repo/extra.txt")), "temporary\n");

  await run(["archive", "--prefix=dist/", "-o", "bundle.tar", "HEAD"]);
  assert.ok((await fs.readFile("/repo/bundle.tar")).length >= 1024);

  assert.match(await run(["fsck"]), /Checking object directories: 100%/u);
  assert.match(await run(["count-objects", "-v"]), /count:/u);
});

test('archive bytes and linked worktree state survive the WASM filesystem boundary', async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/repo', { recursive: true });
  const command = createGitCommand();
  const run = async (args: string[], cwd = '/repo') => {
    const chunks: Uint8Array[] = [];
    let stderr = '';
    const result = await command.execute({ command: 'git', args, cwd, env: {}, fs,
      signal: new AbortController().signal, stdin: (async function*(){})(),
      stdout: { write(bytes: Uint8Array) { chunks.push(bytes.slice()); } },
      stderr: { write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as CommandContext);
    assert.equal(result.exitCode, 0, stderr);
    const output = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    return output;
  };
  const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  await run(['init', '-b', 'main']);
  await fs.mkdir('/repo/nested', { recursive: true });
  await fs.writeFile('/repo/nested/data', new Uint8Array([0, 255, 128, 10]));
  await run(['add', '.']);
  await run(['commit', '-m', 'binary']);
  const main = text(await run(['rev-parse', 'HEAD']));
  const archive = await run(['archive', 'HEAD']);
  await run(['archive', 'HEAD', '-o', '/output.tar']);
  assert.deepEqual(archive, await fs.readFile('/output.tar'));
  assert.equal(text(archive.slice(257, 262)), 'ustar');
  assert.deepEqual(archive.slice(512, 516), new Uint8Array([0, 255, 128, 10]));
  await run(['worktree', 'add', '/topic']);
  assert.deepEqual(await fs.readFile('/topic/nested/data'), new Uint8Array([0, 255, 128, 10]));
  assert.equal(text(await run(['rev-parse', 'HEAD'], '/topic')), main);
  await fs.writeFile('/topic/nested/data', new Uint8Array([1, 2, 3]));
  await run(['add', '.'], '/topic');
  await run(['commit', '-m', 'topic'], '/topic');
  assert.equal(text(await run(['rev-parse', 'HEAD'])), main);
  const topic = text(await run(['rev-parse', 'HEAD'], '/topic'));
  assert.notEqual(topic, main);
  assert.equal(text(await run(['rev-parse', 'topic'])), topic);
});
