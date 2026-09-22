import assert from 'node:assert/strict';
import test from 'node:test';
import { createCommandArguments, type CommandContext } from 'safe-bash-contracts/command';
import { FsError } from 'safe-bash-contracts/errors';
import { createUnrtfCommand, unrtf } from './index.js';
function fixture(args:string[], files:Record<string,string> = {}) {
  const carrier = createCommandArguments(args), stdout:number[] = [], stderr:number[] = [];
  const opened:string[] = [], cleanups:(() => void | Promise<void>)[] = [];
  const context = {command:'unrtf',args:carrier.args,argumentValues:carrier,cwd:'/vfs',env:{},signal:new AbortController().signal,
    stdin:(async function* () { yield new TextEncoder().encode('{\\rtf1 <A>\\par B}'); })(),
    stdout:{async write(bytes:Uint8Array) { stdout.push(...bytes); }}, stderr:{async write(bytes:Uint8Array) { stderr.push(...bytes); }},
    registerCleanup(callback:() => void | Promise<void>) { cleanups.push(callback); },
    fs:{readStream(path:string, options:{signal:AbortSignal}) { assert.ok(options.signal); opened.push(path); return (async function* () { if (!(path in files)) throw new FsError('ENOENT',{path}); yield new TextEncoder().encode(files[path]); })(); }},
  } as unknown as CommandContext;
  return {context,opened,cleanups,stdout,stderr};
}
test('CLI and SDK use the same strict text and HTML byte pipeline', async () => {
  for (const format of ['text','html'] as const) {
    const cli = fixture(['--'+format]), sdk = fixture([]);
    assert.equal((await createUnrtfCommand().execute(cli.context)).exitCode,0);
    assert.equal((await unrtf(sdk.context,{format})).exitCode,0);
    assert.deepEqual(cli.stdout,sdk.stdout);
    assert.ok(cli.cleanups.length);
    await Promise.all(cli.cleanups.map(callback => callback()));
  }
});
test('one literal VFS operand retries appended .rtf; dash remains a filename', async () => {
  const cli = fixture(['--text','-'], {'/vfs/-.rtf':'{\\rtf1 literal}'});
  assert.equal((await createUnrtfCommand().execute(cli.context)).exitCode,0);
  assert.deepEqual(cli.opened,['/vfs/-','/vfs/-.rtf']);
  assert.equal(new TextDecoder().decode(Uint8Array.from(cli.stdout)),'literal');
});
test('missing VFS input fails without emitting an HTML document in CLI and SDK', async () => {
  for (const cli of [true,false]) {
    const f = fixture(cli ? ['missing'] : []);
    const result = cli
      ? await createUnrtfCommand().execute(f.context)
      : await unrtf(f.context,{file:'missing'});
    assert.equal(result.exitCode,1);
    assert.deepEqual(f.opened,['/vfs/missing','/vfs/missing.rtf']);
    assert.deepEqual(f.stdout,[]);
    assert.equal(new TextDecoder().decode(Uint8Array.from(f.stderr)),
      "unrtf: ENOENT: ENOENT: no such file or directory '/vfs/missing.rtf'\n");
    await Promise.all(f.cleanups.map(callback => callback()));
  }
});
test('unadmitted profiles/options and multiple files fail before I/O', async () => {
  for (const args of [['--latex'],['-P','/ambient'],['a','b']]) {
    const f = fixture(args);
    assert.equal((await createUnrtfCommand().execute(f.context)).exitCode,1);
    assert.deepEqual(f.opened,[]); assert.deepEqual(f.stdout,[]); assert.ok(f.stderr.length);
  }
});
test('option terminator admits a literal option-shaped VFS path with SDK parity', async () => {
  const files = {'/vfs/--text':'{\\rtf1 literal}'};
  const cli = fixture(['--text','--','--text'],files), sdk = fixture([],files);
  assert.equal((await createUnrtfCommand().execute(cli.context)).exitCode,0);
  assert.equal((await unrtf(sdk.context,{format:'text',file:'--text'})).exitCode,0);
  assert.deepEqual(cli.opened,['/vfs/--text']);
  assert.deepEqual(cli.stdout,sdk.stdout);
});
test('invocation cleanup is registered before reading output capabilities', async () => {
  const f = fixture(['--text']);
  const destination = f.context.stdout;
  Object.defineProperty(f.context,'stdout',{get() {
    assert.ok(f.cleanups.length,'invocation cleanup must already be registered');
    return destination;
  }});
  assert.equal((await createUnrtfCommand().execute(f.context)).exitCode,0);
});
test('invalid SDK formats and NUL operands fail before input access', async () => {
  for (const options of [{format:'latex' as 'text'}, {file:'bad\0path'}]) {
    const f = fixture([]);
    assert.equal((await unrtf(f.context,options)).exitCode,1);
    assert.deepEqual(f.opened,[]);
    assert.deepEqual(f.stdout,[]);
  }
});
test('output backpressure is awaited before the invocation completes', async () => {
  const f = fixture(['--text']);
  let started!:() => void, finish!:() => void;
  const writing = new Promise<void>(resolve => { started = resolve; });
  const released = new Promise<void>(resolve => { finish = resolve; });
  let settled = false;
  Object.assign(f.context,{stdout:{async write(bytes:Uint8Array) {
    started(); await released;
    f.stdout.push(...bytes);
  }}});
  const running = Promise.resolve(createUnrtfCommand().execute(f.context)).then(result => { settled = true; return result; });
  await writing;
  assert.equal(settled,false);
  finish();
  assert.equal((await running).exitCode,0);
  assert.equal(new TextDecoder().decode(Uint8Array.from(f.stdout)),'<A>\nB');
});
test('external invocation cleanup cancels a pending pull and requests source return', async () => {
  const f = fixture(['--text']);
  let start!:() => void, returned = false;
  const started = new Promise<void>(resolve => { start = resolve; });
  Object.assign(f.context,{stdin:{[Symbol.asyncIterator]() { return {next() { start(); return new Promise<IteratorResult<Uint8Array>>(() => {}); },async return() { returned = true; return {done:true,value:undefined}; }}; }}});
  const running = Promise.resolve(createUnrtfCommand().execute(f.context));
  const rejected = assert.rejects(running);
  await started;
  await f.cleanups[0]!();
  await rejected;
  assert.equal(returned,true);
});

test('cancellation during output closes the parser and permits a clean next invocation', async () => {
  const f = fixture(['--text']);
  const controller = new AbortController(), reason = new Error('output cancelled');
  let closed = false;
  Object.assign(f.context,{signal:controller.signal,
    stdin:(async function* () { try { yield new TextEncoder().encode('{\\rtf1 ABC}'); } finally { closed = true; } })(),
    stdout:{async write() { controller.abort(reason); }} });
  await assert.rejects(Promise.resolve(createUnrtfCommand().execute(f.context)), error => error === reason);
  assert.equal(closed,true);
  await Promise.all(f.cleanups.map(callback => callback()));
  const next = fixture(['--text']);
  assert.equal((await createUnrtfCommand().execute(next.context)).exitCode,0);
  assert.equal(new TextDecoder().decode(Uint8Array.from(next.stdout)),'<A>\nB');
});

test('output quotas report failure with an admitted prefix and close input', async () => {
  const f = fixture(['--text']);
  let closed = false;
  Object.assign(f.context,{stdin:(async function* () {
    try { yield new TextEncoder().encode('{\\rtf1 ABCDE}'); } finally { closed = true; }
  })()});
  assert.equal((await createUnrtfCommand({limits:{outputBytes:3}}).execute(f.context)).exitCode,1);
  assert.equal(new TextDecoder().decode(Uint8Array.from(f.stdout)),'ABC');
  assert.match(new TextDecoder().decode(Uint8Array.from(f.stderr)),/E_LIMIT.*outputBytes/);
  assert.equal(closed,true);
  await Promise.all(f.cleanups.map(callback => callback()));
});

test('a mid-stream VFS error never retries a second document', async () => {
  const f = fixture(['--text','input']);
  let closed = false;
  Object.assign(f.context,{fs:{readStream(path:string) {
    f.opened.push(path);
    return (async function* () {
      try { yield new TextEncoder().encode('{\\rtf1 PREFIX'); throw new FsError('ENOENT',{path}); }
      finally { closed = true; }
    })();
  }}});
  assert.equal((await createUnrtfCommand().execute(f.context)).exitCode,1);
  assert.deepEqual(f.opened,['/vfs/input']);
  assert.equal(new TextDecoder().decode(Uint8Array.from(f.stdout)),'PREFIX');
  assert.equal(closed,true);
});

test('stdin conversion needs neither environment credentials nor filesystem authority', async () => {
  const f = fixture(['--text']);
  for (const name of ['env','fs']) Object.defineProperty(f.context,name,{get() {
    throw new Error(name + ' capability denied');
  }});
  assert.equal((await createUnrtfCommand().execute(f.context)).exitCode,0);
  assert.equal(new TextDecoder().decode(Uint8Array.from(f.stdout)),'<A>\nB');
});
