import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { type CommandContext } from 'safe-bash-contracts';
import { createFdCommandWithMatcher, type FdMatcher } from './command.js';
const matcher: FdMatcher={ async pattern(){return true;},async glob(){return false;},async ignores(){return [];} };
test('omitted traversal and ignore-read limits do not impose finite VFS admission caps',async()=>{
  const fs=new MemoryFileSystem();await fs.mkdir('/work');await fs.writeFile('/work/file',new Uint8Array());
  const readdir=fs.readdir.bind(fs),readFile=fs.readFile.bind(fs);
  let traversed=false,ignoreRead=false;
  fs.readdir=async(path,options)=>{traversed=true;assert.ok(options?.maxEntries===undefined||options.maxEntries===Infinity,'default traversal must be unlimited');return readdir(path,options);};
  fs.readFile=async(path,options)=>{ignoreRead=true;assert.ok(options?.maxBytes===undefined||options.maxBytes===Infinity,'default ignore reads must be unlimited');return readFile(path,options);};
  let stdout='',stderr='';
  const context={command:'fd',args:[],cwd:'/work',env:{},fs,signal:new AbortController().signal,stdin:(async function*(){})(),stdout:{async write(bytes){stdout+=new TextDecoder().decode(bytes);}},stderr:{async write(bytes){stderr+=new TextDecoder().decode(bytes);}}} satisfies CommandContext;
  const result=await createFdCommandWithMatcher(async(_context,run)=>run(matcher)).execute(context);
  assert.equal(result.exitCode,0,stderr);assert.equal(stdout,'file\n');assert.equal(traversed,true);assert.equal(ignoreRead,true);
});
test('explicit traversal limits fail instead of silently truncating',async()=>{
  const fs=new MemoryFileSystem();await fs.mkdir('/work');await fs.writeFile('/work/a',new Uint8Array());await fs.writeFile('/work/b',new Uint8Array());
  let stderr='';
  const context={command:'fd',args:['-I'],cwd:'/work',env:{},fs,signal:new AbortController().signal,stdin:(async function*(){})(),stdout:{async write(){}},stderr:{async write(bytes){stderr+=new TextDecoder().decode(bytes);}}} satisfies CommandContext;
  const result=await createFdCommandWithMatcher(async(_context,run)=>run(matcher),{maxEntries:1}).execute(context);
  assert.equal(result.exitCode,1);assert.match(stderr,/limit/iu);
});
test('standalone fd factory provides the shared glob and ignore matcher',async()=>{
  const {createFdCommand}=await import('./index.js');
  const fs=new MemoryFileSystem();await fs.mkdir('/work');await fs.writeFile('/work/a.ts',new Uint8Array());await fs.writeFile('/work/b.ts',new Uint8Array());await fs.writeFile('/work/.ignore',new TextEncoder().encode('b.ts\n'));
  let stdout='',stderr='';
  const context={command:'fd',args:['-g','*.ts'],cwd:'/work',env:{},fs,signal:new AbortController().signal,stdin:(async function*(){})(),stdout:{async write(bytes){stdout+=new TextDecoder().decode(bytes);}},stderr:{async write(bytes){stderr+=new TextDecoder().decode(bytes);}}} satisfies CommandContext;
  const result=await createFdCommand().execute(context);
  assert.equal(result.exitCode,0,stderr);assert.equal(stdout,'a.ts\n');
});
test('legacy nested SDK limits reject invalid values and remain opt-in',async()=>{
  const {createFdCommand}=await import('./index.js');
  assert.throws(()=>createFdCommand({limits:{maxEntries:0}}),/limit|positive/iu);
  assert.throws(()=>createFdCommand({limits:{maxDepth:-1}}),/limit|positive/iu);
});
test('SDK execution fallback receives literal command arguments',async()=>{
  const {createFdCommand,createFdCommands}=await import('./index.js');
  const fs=new MemoryFileSystem();await fs.mkdir('/work');await fs.writeFile('/work/a b.ts',new Uint8Array());
  let stderr='';const calls: string[][]=[];
  const context={command:'fd',args:['-I','-x','inspect','{}',';'],cwd:'/work',env:{},fs,signal:new AbortController().signal,stdin:(async function*(){})(),stdout:{async write(){}},stderr:{async write(bytes){stderr+=new TextDecoder().decode(bytes);}}} satisfies CommandContext;
  assert.equal(createFdCommands().length,1);
  const result=await createFdCommand({execute:async child=>{calls.push([child.command!,...child.args]);return {exitCode:0};}}).execute(context);
  assert.equal(result.exitCode,0,stderr);assert.deepEqual(calls,[['inspect','./a b.ts']]);
});

for (const [args, expected] of [
  [['-p', '-g', '*sub/*.txt'], 'sub/file.txt\n'],
  [['-p', '^(\\./)?sub/file\\.txt$'], 'sub/file.txt\n'],
  [['-p', '^sub/file'], 'sub/file.txt\n'],
  [['-p', 'work'], ''],
  [['-p', '-a', '^/work/sub/file'], '/work/sub/file.txt\n'],
  [['-p', '^\\./sub/file', './sub'], './sub/file.txt\n'],
  [['-H', '-e', 'bashrc'], ''],
  [['-e', 'txt'], 'link.txt\nsub/file.txt\n'],
  [['-t', 'd', '-t', 'x'], 'exec.sh\nsub/\n'],
  [['-u', '-F', '.bashrc'], ''],
  [['-uu', '-F', '.bashrc'], '.bashrc\n'],
] as const) test(`fd parity: ${args.join(' ')}`, async () => {
  const { createFdCommand } = await import('./index.js');
  const fs = new MemoryFileSystem();
  await fs.mkdir('/work/sub', { recursive: true });
  for (const name of ['sub/file.txt', '.bashrc', 'exec.sh']) await fs.writeFile('/work/' + name, new TextEncoder().encode('x'));
  await fs.chmod('/work/exec.sh', 0o755);
  await fs.symlink('sub/file.txt', '/work/link.txt');
  let stdout = '', stderr = '';
  const result = await createFdCommand().execute({ command: 'fd', args, cwd: '/work', env: {}, fs,
    signal: new AbortController().signal, stdin: (async function*(){})(),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stdout, expected);
});

for (const name of ['.gitignore', '.ignore', '.fdignore']) {
  for (const directory of ['/work', '/work/sub', '/']) {
    test(`fd traverses with directory ${directory}/${name}`, async () => {
      const fs = new MemoryFileSystem();
      await fs.mkdir('/work/sub', { recursive: true });
      await fs.mkdir(`${directory}/${name}`);
      await fs.writeFile('/work/sub/keep.txt', new Uint8Array());
      const result = await runIgnoreSearch(fs);
      assert.deepEqual(result, { exitCode: 0, stdout: 'sub/keep.txt\n', stderr: '' });
    });
  }
  test(`fd tolerates invalid UTF-8 in ${name} and applies valid ignore rules`, async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir('/work');
    for (const file of ['keep.txt', 'skip.txt']) await fs.writeFile('/work/' + file, new Uint8Array());
    await fs.writeFile('/work/' + name, new Uint8Array([
      ...new TextEncoder().encode('# caf'), 0xe9, 10,
      0xff, 10, ...new TextEncoder().encode('skip.txt\n'),
    ]));
    assert.deepEqual(await runIgnoreSearch(fs), { exitCode: 0, stdout: 'keep.txt\n', stderr: '' });
  });
}

async function runIgnoreSearch(fs: MemoryFileSystem) {
  const { createFdCommand } = await import('./index.js');
  let stdout = '', stderr = '';
  const result = await createFdCommand().execute({ command: 'fd', args: ['-t', 'f'], cwd: '/work', env: {}, fs,
    signal: new AbortController().signal, stdin: (async function*(){})(),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  return { exitCode: result.exitCode, stdout, stderr };
}
