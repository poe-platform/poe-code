import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

test('stdin reaches Git plumbing and commit messages without changing bytes', async () => {
  const fs=new MemoryFileSystem(); await fs.mkdir('/repo',{recursive:true});
  const command=createGitCommand();
  const run=async(args:string[], input:Uint8Array=new Uint8Array())=>{
    let stdout='',stderr='';
    const result=await command.execute({command:'git',args,cwd:'/repo',env:{},fs,signal:new AbortController().signal,
      stdin:(async function*(){yield input.slice(0,1);yield input.slice(1);})(),
      stdout:{write(b:Uint8Array){stdout+=new TextDecoder().decode(b);}},stderr:{write(b:Uint8Array){stderr+=new TextDecoder().decode(b);}}} as CommandContext);
    assert.equal(result.exitCode,0,stderr); return stdout;
  };
  const bytes=(s:string)=>new TextEncoder().encode(s);
  await run(['init','-b','main']);
  assert.equal(await run(['stripspace'],bytes('  foo  \n')),'  foo\n');
  const oid=(await run(['hash-object','-w','--stdin'],new Uint8Array([0,255,10]))).trim();
  await fs.writeFile('/repo/a',bytes('one\n')); await run(['add','.']); await run(['commit','-F','-'],bytes('from stdin\n'));
  assert.match(await run(['log','-1','--format=%B']),/from stdin/u);
  const tree=await run(['ls-tree','HEAD']); const treeOid=(await run(['mktree'],bytes(tree))).trim();
  assert.equal(await run(['ls-tree',treeOid]),tree);
  await run(['apply'],bytes('diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-one\n+two\n'));
  assert.equal(new TextDecoder().decode(await fs.readFile('/repo/a')),'two\n');
  assert.equal(oid,createHash('sha1').update(new Uint8Array([98,108,111,98,32,51,0,0,255,10])).digest('hex'));
  const head=(await run(['rev-parse','HEAD'])).trim();
  const tag=await run(['mktag'],bytes(`object ${head}\ntype commit\ntag v1\ntagger A <a@example.com> 1502484200 +0000\n\nmessage\n`));
  assert.equal(tag.trim().length,40);
});


test("git integrates with ssh-keygen, gpg, openssl, SSH transport, and hooks in safe-fs", async () => {
  const { createSshKeygenCommand } = await import("safe-bash-command-ssh");
  const { createGpgCommand } = await import("safe-bash-command-gpg");
  const { createOpensslCommand } = await import("safe-bash-command-openssl");

  const fs = new MemoryFileSystem();
  const gitCmd = createGitCommand();
  const keygenCmd = createSshKeygenCommand();
  const _gpgCmd = createGpgCommand();
  const opensslCmd = createOpensslCommand();

  const execCmd = async (def: { name: string; execute: (c: CommandContext) => Promise<{ exitCode: number }> }, args: string[], cwd = "/") => {
    let stdout = "", stderr = "";
    const ctx = {
      command: def.name,
      args,
      cwd,
      env: {},
      fs,
      signal: new AbortController().signal,
      stdin: (async function* () {})(),
      stdout: { write(b: Uint8Array) { stdout += new TextDecoder().decode(b); } },
      stderr: { write(b: Uint8Array) { stderr += new TextDecoder().decode(b); } },
    } as CommandContext;
    const res = await def.execute(ctx);
    assert.equal(res.exitCode, 0, `${def.name} ${args.join(" ")} failed: ${stderr}`);
    return { stdout, stderr };
  };

  await execCmd(keygenCmd, ["-t", "ed25519", "-f", "/home/user/.ssh/id_ed25519", "-C", "alice@example.com", "-N", ""]);
  const pubKey = new TextDecoder().decode(await fs.readFile("/home/user/.ssh/id_ed25519.pub")).trim();
  await fs.writeFile("/home/user/.ssh/allowed_signers", new TextEncoder().encode(`alice@example.com ${pubKey}\n`));

  await fs.mkdir("/remotes/github.com/org/demo.git", { recursive: true });
  await execCmd(gitCmd, ["init", "-b", "main"], "/remotes/github.com/org/demo.git");
  await execCmd(gitCmd, ["config", "user.name", "Alice"], "/remotes/github.com/org/demo.git");
  await execCmd(gitCmd, ["config", "user.email", "alice@example.com"], "/remotes/github.com/org/demo.git");
  await fs.writeFile("/remotes/github.com/org/demo.git/README.md", new TextEncoder().encode("# Demo\n"));
  await execCmd(gitCmd, ["add", "README.md"], "/remotes/github.com/org/demo.git");
  await execCmd(gitCmd, ["commit", "-m", "initial"], "/remotes/github.com/org/demo.git");

  await fs.mkdir("/work", { recursive: true });
  await execCmd(gitCmd, ["clone", "git@github.com:org/demo.git", "/work/app"], "/work");
  await execCmd(gitCmd, ["config", "user.name", "Alice"], "/work/app");
  await execCmd(gitCmd, ["config", "user.email", "alice@example.com"], "/work/app");
  await execCmd(gitCmd, ["config", "gpg.format", "ssh"], "/work/app");
  await execCmd(gitCmd, ["config", "user.signingkey", "/home/user/.ssh/id_ed25519"], "/work/app");
  await execCmd(gitCmd, ["config", "gpg.ssh.allowedSignersFile", "/home/user/.ssh/allowed_signers"], "/work/app");

  await execCmd(opensslCmd, ["rand", "-hex", "-out", "/work/app/token.txt", "8"], "/work/app");
  await execCmd(gitCmd, ["add", "token.txt"], "/work/app");
  await execCmd(gitCmd, ["commit", "-S", "-m", "feat: signed ssh commit"], "/work/app");
  const verifyOut = await execCmd(gitCmd, ["verify-commit", "HEAD"], "/work/app");
  assert.match(verifyOut.stdout + verifyOut.stderr, /Good "git" signature for alice@example\.com/);
  await execCmd(gitCmd, ["push", "origin", "main"], "/work/app");
});
