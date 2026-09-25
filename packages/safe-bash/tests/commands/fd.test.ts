import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem, Shell, agentCommands } from '../../src/index.js';

test('fd searches names, directories and extensions in the virtual filesystem', async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/work/src', { recursive: true });
  await fs.writeFile('/work/src/Test.ts', new TextEncoder().encode('hello'));
  await fs.writeFile('/work/src/test.js', new Uint8Array());
  const shell = new Shell({ fs, cwd: '/work' }).use(agentCommands());
  try {
    const result = await shell.exec('fd test -e ts');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, 'src/Test.ts\n');
    assert.equal((await shell.exec('fd -t d')).stdout, 'src/\n');
    assert.equal((await shell.exec('fd -q missing')).exitCode, 1);
  } finally { await shell.dispose(); }
});

test('fd filters depth, size, executable/empty types, times, limits and formats', async()=>{
  const fs=new MemoryFileSystem(); const bytes=new TextEncoder();
  await fs.mkdir('/work/deep/empty',{recursive:true});
  await fs.writeFile('/work/big.txt',new Uint8Array(1000));
  await fs.writeFile('/work/deep/run.sh',bytes.encode('run'));
  await fs.chmod('/work/deep/run.sh',0o755);
  await fs.writeFile('/work/deep/zero.txt',new Uint8Array());
  const shell=new Shell({fs,cwd:'/work'}).use(agentCommands());
  try {
    for (const [command,expected] of [
      ['fd --exact-depth 2 -t f','deep/run.sh\ndeep/zero.txt\n'],
      ['fd -S +1k','big.txt\n'],['fd -S 1kb','big.txt\n'],
      ['fd -tx','deep/run.sh\n'],['fd -te -tf','deep/zero.txt\n'],['fd -te -td','deep/empty/\n'],
      ['fd -a -e sh','/work/deep/run.sh\n'],['fd -1 -tf','big.txt\n'],
      ["fd -e sh --format '{/.}|{//}|{.}|{/}|{}'",'run|deep|deep/run|run.sh|deep/run.sh\n'],
      ["fd -tf --changed-within 1day --changed-before '2100-01-01'",'big.txt\ndeep/run.sh\ndeep/zero.txt\n'],
      ['fd -e sh -0','./deep/run.sh\0'],
    ]) { const result=await shell.exec(command!); assert.equal(result.exitCode,0,result.stderr); assert.equal(result.stdout,expected,command); }
    const details=await shell.exec('fd -l -e sh'); assert.equal(details.exitCode,0,details.stderr); assert.match(details.stdout,/rwxr-xr-x.*run.sh/u);
    assert.notEqual((await shell.exec('fd -S 1.5k')).exitCode,0);
  } finally {await shell.dispose();}
});

test('fd reads gitignore and fdignore precedence without host access',async()=>{
  const fs=new MemoryFileSystem(); await fs.mkdir('/work/.git',{recursive:true});
  for(const [name,text] of Object.entries({'.gitignore':'*.txt\n','.fdignore':'!keep.txt\n','keep.txt':'','skip.txt':''})) await fs.writeFile('/work/'+name,new TextEncoder().encode(text));
  const shell=new Shell({fs,cwd:'/work'}).use(agentCommands());
  try { assert.equal((await shell.exec('fd -tf')).stdout,'keep.txt\n'); assert.equal((await shell.exec('fd --no-ignore-vcs -tf')).stdout,'keep.txt\nskip.txt\n'); }
  finally {await shell.dispose();}
});

test('fd NUL and execution paths keep explicit search-root spelling',async()=>{
  const fs=new MemoryFileSystem();await fs.mkdir('/work/src',{recursive:true});await fs.writeFile('/work/src/file.ts',new Uint8Array());
  const shell=new Shell({fs,cwd:'/work'}).use(agentCommands());
  try {
    assert.equal((await shell.exec("fd -0 '' src")).stdout,'src/file.ts\0');
    assert.equal((await shell.exec("fd -0 '' ./src")).stdout,'./src/file.ts\0');
    assert.equal((await shell.exec("fd '' src -x printf '%s\\n' '{}' ';'")).stdout,'src/file.ts\n');
  } finally {await shell.dispose();}
});

test('fd exclusion globs are relative to each explicit search root',async()=>{
  const fs=new MemoryFileSystem();await fs.mkdir('/work/src/nested',{recursive:true});await fs.writeFile('/work/src/nested/file.ts',new Uint8Array());await fs.writeFile('/work/src/keep.ts',new Uint8Array());
  const shell=new Shell({fs,cwd:'/work'}).use(agentCommands());
  try {assert.equal((await shell.exec("fd -tf -E nested/file.ts '' src")).stdout,'src/keep.ts\n');}
  finally {await shell.dispose();}
});
