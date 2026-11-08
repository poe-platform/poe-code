import { expect,it,vi } from 'vitest';
import { createFileServer, encodeFileMetadata } from './files.js';
it('preserves exact retained link counts in remote metadata', () => {
 let observations = 0;
 const stat = { type: 'file' as const, size: 0n,
  get nlink() { return ++observations === 1 ? 9007199254740993n : 0; },
 };
 expect(JSON.parse(JSON.stringify(encodeFileMetadata(stat)))).toEqual({ type: 'file', size: '0', nlink: '9007199254740993' });
 expect(observations).toBe(1);
});
it.each([0, -1n, 9223372036854775808n])('refuses invalid exact remote link counts %s', nlink => {
 expect(() => encodeFileMetadata({ type: 'file', size: 0n, nlink } as import('@poe-code/safe-fs/contracts').ExactFileStat)).toThrow();
});
it('closes new file acquisition synchronously when server disposal starts',async()=>{
 const scope={tenantId:'t',sessionId:'s',epoch:'e',invocationId:'i'};
 const open=vi.fn(async()=>({async stat(){return {size:0n,type:'file' as const};},async read(){return new Uint8Array();},async close(){}}));
 const server=createFileServer({maxHandles:2,maxFrameBytes:1,open});
 const disposal=server.disposeAll();
 const attempt=server.open(scope,{namespaceId:'n',path:'/late'},new AbortController().signal);
 await expect(attempt).rejects.toMatchObject({status:410});
 await disposal;expect(open).not.toHaveBeenCalled();
 await expect(server.open(scope,{namespaceId:'n',path:'/later'},new AbortController().signal)).rejects.toMatchObject({status:410});
});
it('shares one disposal barrier and preserves a failed close without reopening authority',async()=>{
 const scope={tenantId:'t',sessionId:'s',epoch:'e',invocationId:'i'};
 const failure=new Error('close failed');const close=vi.fn(async()=>{throw failure;});
 const server=createFileServer({maxHandles:2,maxFrameBytes:1,async open(){return {async stat(){return {size:0n,type:'file' as const};},async read(){return new Uint8Array();},close};}});
 await server.open(scope,{namespaceId:'n',path:'/x'},new AbortController().signal);
 const first=server.disposeAll();const second=server.disposeAll();
 const results=await Promise.allSettled([first,second]);
 expect(first).toBe(second);expect(results).toEqual([{status:'rejected',reason:failure},{status:'rejected',reason:failure}]);expect(close).toHaveBeenCalledOnce();
 await expect(server.disposeAll()).rejects.toBe(failure);
});
it('serializes the exact stat observations it validated without rereading backend getters', () => {
 const observations = new Map<string, number>();
 const stat = { type: 'file', size: 9007199254740994n, allocatedBytes: 8192n,
  mode: 0o100640, uid: 1000, gid: 1001, atimeNs: -1n,
  mtimeNs: 1234567890000000001n, ctimeNs: 1234567890000000002n } as const;
 const carrier = Object.fromEntries(Object.entries(stat).map(([key, value]) => [key, value]));
 for (const [key, value] of Object.entries(stat)) {
  Object.defineProperty(carrier, key, { get() {
   const count = (observations.get(key) ?? 0) + 1; observations.set(key, count);
   return count === 1 ? value : typeof value === 'bigint' ? 9007199254740992 : key === 'type' ? 'block' : -1;
  } });
 }
 expect(encodeFileMetadata(carrier as unknown as Parameters<typeof encodeFileMetadata>[0])).toEqual({
  ...stat, size: '9007199254740994', allocatedBytes: '8192', atimeNs: '-1',
  mtimeNs: '1234567890000000001', ctimeNs: '1234567890000000002',
 });
 expect([...observations.values()]).toEqual(Array(9).fill(1));
});
it('refuses a freshness getter that changes the admitted version before validation', async () => {
 const identity = {}; let observations = 0;
 const guard = { identity, get version() { return ++observations === 1 ? 'current' : ''; }, assertCurrent: async () => {} };
 const server = createFileServer({ maxHandles: 1, maxFrameBytes: 1, open: async () => ({ identity,
  freshness: async () => guard, stat: async () => ({ type: 'file', size: 0n }), read: async () => new Uint8Array(), close: async () => {} }) });
 const scope = { tenantId: 't', sessionId: 's', epoch: 'e', invocationId: 'i' }; const signal = new AbortController().signal;
 try {
  const handle = await server.open(scope, { namespaceId: 'n', path: '/live' }, signal);
  await expect(server.freshness(scope, handle, signal)).rejects.toThrow('binding changed');
 } finally { await server.disposeAll(); }
});
it('refuses versioned transfer without an explicit retained object identity', async () => {
 const scope = { tenantId: 't', sessionId: 's', epoch: 'e', invocationId: 'i' };
 const signal = new AbortController().signal;
 const validate = vi.fn(async () => {});
 const read = vi.fn(async () => Uint8Array.of(0, 255));
 const server = createFileServer({ maxHandles: 1, maxFrameBytes: 2, async open() {
  return { freshness: async () => ({ identity: {}, version: 'yesterday', assertCurrent: validate }),
   stat: async () => ({ type: 'file', size: 2n }), read, close: async () => {} };
 } });
 const handle = await server.open(scope, { namespaceId: 'n', path: '/live' }, signal);
 try {
  await expect(server.freshness(scope, handle, signal)).rejects.toThrow('identity');
  expect(validate).not.toHaveBeenCalled();
  // An unversioned live read still uses the admitted canonical reader.
  const reader = server.stream(scope, handle, 0n, 2n, signal).getReader();
  try { expect((await reader.read()).value).toEqual(Uint8Array.of(0, 255)); }
  finally { await reader.cancel(); reader.releaseLock(); }
 } finally { await server.disposeAll(); }
});
it.each([false, true])('retires the original canonical retain when admission fails (disposing=%s)', async disposing => {
 const scope = { tenantId: 't', sessionId: 's', epoch: 'e', invocationId: 'i' };
 const signal = new AbortController().signal;
 const failure = new Error('identity unavailable');
 const close = vi.fn(async () => {}); const replacement = vi.fn(async () => {});
 const resource = { stat: async () => ({ type: 'file' as const, size: 0n }), read: async () => new Uint8Array(), close };
 Object.defineProperty(resource, 'identity', { get() { resource.close = replacement; throw failure; } });
 let release!: () => void;
 const gate = new Promise<void>(resolve => { release = resolve; });
 const server = createFileServer({ maxHandles: 1, maxFrameBytes: 1, async open() { await gate; return resource; } });
 const opening = server.open(scope, { namespaceId: 'n', path: '/live' }, signal);
 const rejection = expect(opening).rejects.toBe(failure);
 const retirement = disposing ? server.dispose(scope) : undefined;
 release(); await rejection; await retirement;
 expect(close).toHaveBeenCalledOnce(); expect(replacement).not.toHaveBeenCalled();
 await server.disposeAll(); expect(close).toHaveBeenCalledOnce();
});
it('keeps the acquired reader and freshness authority after its public resource is replaced', async () => {
 const identity = {}; let value = 1;
 const close = vi.fn(async () => {});
 const replacement = vi.fn(async () => Uint8Array.of(9));
 const resource = { identity, freshness: async () => ({ identity, version: '1', assertCurrent: async () => {} }),
  stat: async () => ({ type: 'file' as const, size: 1n }), read: async () => Uint8Array.of(value), close };
 const server = createFileServer({ maxHandles: 1, maxFrameBytes: 1, open: async () => resource });
 const scope = { tenantId: 't', sessionId: 's', epoch: 'e', invocationId: 'i' };
 const signal = new AbortController().signal;
 const handle = await server.open(scope, { namespaceId: 'n', path: '/live' }, signal);
 try {
  const foreign = {};
  Object.assign(resource, { identity: foreign, freshness: async () => ({ identity: foreign, version: '2', assertCurrent: async () => {} }),
   read: replacement, close: vi.fn(async () => {}) });
  expect((await server.freshness(scope, handle, signal))?.identity).toBe(identity);
  value = 2;
  const reader = server.stream(scope, handle, 0n, 1n, signal).getReader();
  try { expect((await reader.read()).value).toEqual(Uint8Array.of(2)); }
  finally { reader.releaseLock(); }
 } finally { await server.disposeAll(); }
 expect(close).toHaveBeenCalledOnce();
 expect(replacement).not.toHaveBeenCalled();
});
it('refuses freshness for a different canonical object even when its version validates', async () => {
 const validate = vi.fn(async () => {});
 const server = createFileServer({ maxHandles: 1, maxFrameBytes: 1, async open() {
  return { identity: {}, freshness: async () => ({ identity: {}, version: '1', assertCurrent: validate }),
   stat: async () => ({ type: 'file', size: 1n }), read: async () => Uint8Array.of(7), close: async () => {} };
 } });
 const scope = { tenantId: 't', sessionId: 's', epoch: 'e', invocationId: 'i' };
 const signal = new AbortController().signal;
 const handle = await server.open(scope, { namespaceId: 'n', path: '/live' }, signal);
 try {
  await expect(server.freshness(scope, handle, signal)).rejects.toThrow('identity');
  expect(validate).not.toHaveBeenCalled();
 } finally { await server.disposeAll(); }
});
it('binds freshness authority to its retained handle before reading canonical bytes', async () => {
 const read = vi.fn(async () => Uint8Array.of(7));
 const server = createFileServer({ maxHandles: 2, maxFrameBytes: 1, async open() {
  const identity = {};
  return { identity, freshness: async () => ({ identity, version: '1', assertCurrent: async () => {} }),
   stat: async () => ({ type: 'file', size: 1n }), read, close: async () => {} };
 } });
 const scope = { tenantId: 't', sessionId: 's', epoch: 'e', invocationId: 'i' };
 const signal = new AbortController().signal;
 const first = await server.open(scope, { namespaceId: 'n', path: '/first' }, signal);
 const second = await server.open(scope, { namespaceId: 'n', path: '/second' }, signal);
 const guard = await server.freshness(scope, first, signal);
 try {
  await expect(server.stat(scope, second, signal, guard)).rejects.toThrow('Freshness');
  expect(() => server.stream(scope, second, 0n, 1n, signal, guard)).toThrow('Freshness');
  expect(read).not.toHaveBeenCalled();
 } finally { await server.disposeAll(); }
});
it('refuses freshness rebinding during asynchronous initial validation', async () => {
 const identity = {}; const failure = new Error('original version stale'); let checks = 0;
 const guard = { identity, version: '1', async assertCurrent() {
  if (++checks > 1) throw failure;
  this.version = '2'; this.assertCurrent = async () => {};
 } };
 const server = createFileServer({ maxHandles: 1, maxFrameBytes: 1, async open() {
  return { identity, freshness: async () => guard, stat: async () => ({ type: 'file', size: 1n }), read: async () => Uint8Array.of(7), close: async () => {} };
 } });
 const scope = { tenantId: 't', sessionId: 's', epoch: 'e', invocationId: 'i' };
 const signal = new AbortController().signal;
 const handle = await server.open(scope, { namespaceId: 'n', path: '/live' }, signal);
 try {
  await expect(server.freshness(scope, handle, signal)).rejects.toThrow('binding changed');
 } finally { await server.disposeAll(); }
});
it.each(['identity', 'version'] as const)('rejects output guard %s rebinding during a read without exposing mixed-version bytes', async field => {
 const identity = {}; let version = '1';
 const guard = { identity, version, async assertCurrent() {
  if (this.version !== version) throw new Error('canonical version stale');
 } };
 const read = vi.fn(async () => {
  if (field === 'version') { version = '2'; guard.version = version; }
  else guard.identity = {};
  return Uint8Array.of(255);
 });
 const server = createFileServer({ maxHandles: 1, maxFrameBytes: 1, open: async () => ({ identity,
  freshness: async () => guard, stat: async () => ({ type: 'file', size: 1n }), read, close: async () => {},
 }) });
 const scope = { tenantId: 't', sessionId: 's', epoch: 'e', invocationId: 'i' }; const signal = new AbortController().signal;
 try {
  const handle = await server.open(scope, { namespaceId: 'n', path: '/live' }, signal);
  const admitted = await server.freshness(scope, handle, signal);
  const reader = server.stream(scope, handle, 0n, 1n, signal, admitted).getReader();
  try { await expect(reader.read()).rejects.toThrow('binding changed'); }
  finally { reader.releaseLock(); }
  // A failed guarded transfer does not freeze or revoke ordinary live reads.
  const live = server.stream(scope, handle, 0n, 1n, signal).getReader();
  try { expect((await live.read()).value).toEqual(Uint8Array.of(255)); }
  finally { live.releaseLock(); }
 } finally { await server.disposeAll(); }
});
it('refuses delayed metadata from a rebound guard and preserves the canonical validator failure', async () => {
 const identity = {}; const denied = Object.assign(new Error('canonical access revoked'), { code: 'EACCES', syscall: 'read', path: '/live' });
 let failure: Error | undefined; let release!: () => void; let entered!: () => void;
 const started = new Promise<void>(resolve => { entered = resolve; });
 const delay = new Promise<void>(resolve => { release = resolve; });
 const guard = { identity, version: '1', async assertCurrent() { if (failure) throw failure; } };
 const server = createFileServer({ maxHandles: 1, maxFrameBytes: 1, open: async () => ({ identity,
  freshness: async () => guard, async stat() { entered(); await delay; return { type: 'file', size: 1n }; },
  read: async () => Uint8Array.of(7), close: async () => {},
 }) });
 const scope = { tenantId: 't', sessionId: 's', epoch: 'e', invocationId: 'i' }; const signal = new AbortController().signal;
 try {
  const handle = await server.open(scope, { namespaceId: 'n', path: '/live' }, signal);
  const admitted = await server.freshness(scope, handle, signal);
  const metadata = server.stat(scope, handle, signal, admitted);
  const rejected = expect(metadata).rejects.toThrow('binding changed');
  await started; guard.version = '2'; release(); await rejected;
  const current = await server.freshness(scope, handle, signal);
  failure = denied;
  const reader = server.stream(scope, handle, 0n, 1n, signal, current).getReader();
  try { await expect(reader.read()).rejects.toBe(denied); }
  finally { reader.releaseLock(); }
 } finally { release(); await server.disposeAll(); }
});
it('rejects guarded bytes changed during a native read and releases range admission', async () => {
 let version = '1'; let mutate = true;
 const identity = {};
 const server = createFileServer({ maxHandles: 1, maxFrameBytes: 2, async open() {
  return { identity, async freshness() { const observed = version; return { identity, version: observed, async assertCurrent() { if (version !== observed) throw new Error('changed during read'); } }; },
   stat: async () => ({ type: 'file', size: 2n }), async read() { if (mutate) version = '2'; return Uint8Array.of(0, 255); }, close: async () => {},
  };
 } });
 const scope = { tenantId: 't', sessionId: 's', epoch: 'e', invocationId: 'i' }; const signal = new AbortController().signal;
 const handle = await server.open(scope, { namespaceId: 'n', path: 'a' }, signal);
 const guard = await server.freshness(scope, handle, signal);
 const reader = server.stream(scope, handle, 0n, 2n, signal, guard).getReader();
 await expect(reader.read()).rejects.toThrow('changed during read'); reader.releaseLock();
 mutate = false;
 const next = server.stream(scope, handle, 0n, 2n, signal, await server.freshness(scope, handle, signal)).getReader();
 expect((await next.read()).value).toEqual(Uint8Array.of(0, 255)); await next.cancel(); await server.disposeAll();
});
it('retains canonical acquisition and range bounds after caller configuration changes', async () => {
 const read = vi.fn(async (_position: bigint, count: number) => new Uint8Array(count));
 const open = vi.fn(async () => ({ stat: async () => ({ type: 'file' as const, size: 2n }), read, close: async () => {} }));
 const options = { maxHandles: 1, maxFrameBytes: 1, open };
 const server = createFileServer(options);
 options.maxHandles = 2; options.maxFrameBytes = 2;
 options.open = vi.fn(async () => { throw new Error('scratch authority'); });
 const scope = { tenantId: 't', sessionId: 's', epoch: 'e', invocationId: 'i' };
 const signal = new AbortController().signal;
 const handle = await server.open(scope, { namespaceId: 'n', path: '/live' }, signal);
 const reader = server.stream(scope, handle, 0n, 2n, signal).getReader();
 try {
  expect((await reader.read()).value).toHaveLength(1);
  await expect(server.open(scope, { namespaceId: 'n', path: '/other' }, signal)).rejects.toMatchObject({ status: 429 });
  expect(read).toHaveBeenCalledWith(0n, 1, expect.any(AbortSignal));
 } finally { await reader.cancel(); await server.disposeAll(); }
});
it.each(['dispose', 'disposeAll'] as const)('%s drains delayed closes before reporting another retained close failure', async operation => {
 const failure = new Error('first close failed'); let release!: () => void; let calls = 0;
 const server = createFileServer({ maxHandles: 2, maxFrameBytes: 1, open: async () => {
  const index = calls++;
  return { stat: async () => ({ type: 'file', size: 0n }), read: async () => new Uint8Array(),
   close: async () => { if (!index) throw failure; await new Promise<void>(resolve => { release = resolve; }); },
  };
 } });
 const scope = { tenantId: 't', sessionId: 's', epoch: 'e', invocationId: 'i' };
 const signal = new AbortController().signal;
 await server.open(scope, { namespaceId: 'n', path: '/one' }, signal);
 await server.open(scope, { namespaceId: 'n', path: '/two' }, signal);
 let settled = false;
 const disposal = (operation === 'dispose' ? server.dispose(scope) : server.disposeAll()).finally(() => { settled = true; });
 const rejected = expect(disposal).rejects.toBe(failure);
 for (let turn = 0; turn < 10; turn++) await Promise.resolve();
 try { expect(settled).toBe(false); }
 finally { release(); await rejected; }
});
it('consumes retained ownership on a failed close and frees admission without reopening it', async () => {
 const failure = new Error('close failed');
 const close = vi.fn(async () => { throw failure; });
 const server = createFileServer({ maxHandles: 1, maxFrameBytes: 1, open: async () => ({
  stat: async () => ({ type: 'file', size: 0n }), read: async () => new Uint8Array(), close,
 }) });
 const scope = { tenantId: 't', sessionId: 's', epoch: 'e', invocationId: 'i' };
 const signal = new AbortController().signal;
 const first = await server.open(scope, { namespaceId: 'n', path: '/old' }, signal);
 await expect(server.close(scope, first)).rejects.toBe(failure);
 await expect(server.stat(scope, first)).rejects.toMatchObject({ status: 404 });
 const second = await server.open(scope, { namespaceId: 'n', path: '/new' }, signal);
 await expect(server.close(scope, second)).rejects.toBe(failure);
 expect(close).toHaveBeenCalledTimes(2);
});
it('serializes exact native stat values across JSON without losing sparse offsets or nanoseconds', async () => {
 const server=createFileServer({maxHandles:1,maxFrameBytes:8,async open(){return {
  async stat(){return {type:'file' as const,size:9007199254740994n,allocatedBytes:8192n,atimeNs:-1n,mtimeNs:1234567890000000001n,ctimeNs:1234567890000000002n};},
  async read(){return new Uint8Array();},async close(){},
 };}});
 const scope={tenantId:'t',sessionId:'s',epoch:'e',invocationId:'i'};
 const handle=await server.open(scope,{namespaceId:'n',path:'/x'},new AbortController().signal);
 try{expect(JSON.parse(JSON.stringify(await server.stat(scope,handle)))).toEqual({
  type:'file',size:'9007199254740994',allocatedBytes:'8192',atimeNs:'-1',mtimeNs:'1234567890000000001',ctimeNs:'1234567890000000002',
 });}finally{await server.close(scope,handle);}
});
it.each(['size', 'allocatedBytes', 'atimeNs', 'mtimeNs', 'ctimeNs'] as const)('rejects numeric native %s before wire serialization', async field => {
 const server=createFileServer({maxHandles:1,maxFrameBytes:8,async open(){return {
  async stat(){return {type:'file' as const,size:0n,[field]:9007199254740992} as unknown as import('@poe-code/safe-fs/contracts').ExactFileStat;},
  async read(){return new Uint8Array();},async close(){},
 };}});
 const scope={tenantId:'t',sessionId:'s',epoch:'e',invocationId:'i'};
 const handle=await server.open(scope,{namespaceId:'n',path:'/x'},new AbortController().signal);
 try{await expect(server.stat(scope,handle)).rejects.toThrow();}finally{await server.close(scope,handle);}
});
it('owns a delivered Buffer range before the backend reuses it for the next read', async () => {
  const producer = Buffer.alloc(1);
  const server = createFileServer({ maxHandles: 1, maxFrameBytes: 1, async open() { return { async stat() { return { type: 'file' as const, size: 2n }; }, async read(position) { producer[0] = Number(position) + 7; return producer; }, async close() {} }; } });
  const scope = { tenantId: 't', sessionId: 's', epoch: 'e', invocationId: 'i' };
  const handle = await server.open(scope, { namespaceId: 'n', path: '/file' }, new AbortController().signal);
  const reader = server.stream(scope, handle, 0n, 2n, new AbortController().signal).getReader();
  try {
    const first = await reader.read(); const second = await reader.read();
    expect(first.value).toEqual(new Uint8Array([7])); expect(second.value).toEqual(new Uint8Array([8]));
  } finally { await reader.cancel(); await server.close(scope, handle); }
});
it('retains the opened object through unlink/replacement, streams ranges and awaits close after admitted reads',async()=>{
 let started!:()=>void;const acquisition=new Promise<void>(r=>{started=r;});
 let original=new Uint8Array([0,255,128,7]);let pending:((v:Uint8Array)=>void)|undefined;const close=vi.fn(async()=>{});
 const server=createFileServer({maxHandles:2,maxFrameBytes:2,async open(){const object=original;return {async stat(){return {size:BigInt(object.length),type:'file' as const};},async read(position,max){if(position===1n)return new Promise<Uint8Array>(r=>{pending=r;started();});return object.slice(Number(position),Number(position)+max);},close};}});
 const scope={tenantId:'t',sessionId:'s',epoch:'e',invocationId:'i'};const handle=await server.open(scope,{namespaceId:'work',path:'/x'},new AbortController().signal);original=new Uint8Array([9]);
 expect((await server.stat(scope,handle)).size).toBe('4');
 expect(()=>server.stream({...scope,tenantId:'foreign'},handle,1n,3n,new AbortController().signal)).toThrow();
 const read=server.stream(scope,handle,1n,3n,new AbortController().signal).getReader();const first=read.read();const rejected=expect(first).rejects.toThrow();await acquisition;
 let closed=false;const disposal=server.close(scope,handle).then(()=>{closed=true;});await Promise.resolve();expect(closed).toBe(false);
 pending!(new Uint8Array([255,128]));await rejected;await disposal;expect(close).toHaveBeenCalledTimes(1);expect(closed).toBe(true);
});
it('checks range bounds and handle capacity before acquisition and never rounds offsets',async()=>{
 const open=vi.fn(async()=>({async stat(){return{size:9223372036854775807n,type:'file' as const};},async read(position:bigint){expect(position).toBe(9007199254740993n);return new Uint8Array([255]);},async close(){}}));
 const server=createFileServer({maxHandles:1,maxFrameBytes:8,open});const scope={tenantId:'t',sessionId:'s',epoch:'e',invocationId:'i'};const handle=await server.open(scope,{namespaceId:'n',path:'/x'},new AbortController().signal);
 await expect(server.open(scope,{namespaceId:'n',path:'/y'},new AbortController().signal)).rejects.toThrow();expect(open).toHaveBeenCalledTimes(1);
 const reader=server.stream(scope,handle,9007199254740993n,9007199254740994n,new AbortController().signal).getReader();expect((await reader.read()).value).toEqual(new Uint8Array([255]));expect((await reader.read()).done).toBe(true);
 expect(()=>server.stream(scope,handle,-1n,1n,new AbortController().signal)).toThrow();await server.close(scope,handle);
});

it('registers cleanup before a late acquisition and releases it once',async()=>{
 let acquired!:(v:import('./files.js').RetainedReadFile)=>void;const pending=new Promise<import('./files.js').RetainedReadFile>(r=>{acquired=r;});const close=vi.fn(async()=>{});
 const server=createFileServer({maxHandles:1,maxFrameBytes:8,async open(){return pending;}});const scope={tenantId:'t',sessionId:'s',epoch:'e',invocationId:'i'};
 const open=server.open(scope,{namespaceId:'n',path:'/x'},new AbortController().signal);const rejected=expect(open).rejects.toThrow();const disposal=server.dispose(scope);
 acquired({async stat(){return {size:0n,type:'file'};},async read(){return new Uint8Array();},close});await rejected;await disposal;expect(close).toHaveBeenCalledTimes(1);
});
it('drains every admitted scope when its server session owner closes',async()=>{
 let acquired!:(v:import('./files.js').RetainedReadFile)=>void;const pending=new Promise<import('./files.js').RetainedReadFile>(r=>{acquired=r;});const close=vi.fn(async()=>{});
 const server=createFileServer({maxHandles:1,maxFrameBytes:8,async open(){return pending;}});const opening=server.open({tenantId:'t',sessionId:'s',epoch:'e',invocationId:'i'},{namespaceId:'n',path:'/x'},new AbortController().signal);const rejected=expect(opening).rejects.toThrow();
 const disposal=server.disposeAll();acquired({async stat(){return {size:0n,type:'file'};},async read(){return new Uint8Array();},close});await rejected;await disposal;expect(close).toHaveBeenCalledTimes(1);
});

it('propagates canonical EOF after a short live read without synthesizing a content-change error', async () => {
 const scope={tenantId:'t',sessionId:'s',epoch:'e',invocationId:'i'};
 const read=vi.fn(async (position:bigint)=>position===0n?Uint8Array.of(7):new Uint8Array());
 const server=createFileServer({maxHandles:1,maxFrameBytes:8,async open(){return {stat:async()=>({type:'file',size:8n}),read,close:async()=>{}};}});
 const handle=await server.open(scope,{namespaceId:'n',path:'/live'},new AbortController().signal);
 const reader=server.stream(scope,handle,0n,8n,new AbortController().signal).getReader();
 try { expect((await reader.read()).value).toEqual(Uint8Array.of(7));expect((await reader.read()).done).toBe(true); }
 finally {await reader.cancel();await server.close(scope,handle);}
});
it('publishes one retirement barrier before canonical abort listeners reenter close', async () => {
 const scope = { tenantId: 't', sessionId: 's', epoch: 'e', invocationId: 'i' };
 const close = vi.fn(async () => {});
 let reentered: Promise<void> | undefined;
 const server = createFileServer({ maxHandles: 1, maxFrameBytes: 1,
  async open(_scope, _input, signal) {
   signal.addEventListener('abort', () => { reentered = server.close(scope, handle); }, { once: true });
   return { stat: async () => ({ type: 'file' as const, size: 0n }), read: async () => new Uint8Array(), close };
  },
 });
 const handle = await server.open(scope, { namespaceId: 'n', path: '/live' }, new AbortController().signal);
 await server.close(scope, handle);
 await reentered;
 expect(close).toHaveBeenCalledOnce();
 await server.disposeAll();
});
