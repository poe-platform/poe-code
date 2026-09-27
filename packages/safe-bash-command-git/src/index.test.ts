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
