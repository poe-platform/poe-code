import {expect,it,vi}from'vitest';
import{createNativeDriver}from'./native-driver.js';
import type{SessionAuthority}from'./media-server.js';
it('binds native session admission to the backend whose build and features were selected',async()=>{
 const close=vi.fn(async()=>{});
 const selected={features:[{name:'live-files',evidence:['selected qualification']}],inspectBuild:vi.fn(),admitSession:vi.fn(async()=>({async prepare(){throw new Error('unused');},close}))};
 const replacement={...selected,admitSession:vi.fn(async()=>({async prepare(){throw new Error('unused');},async close(){}}))};
 const config={backend:selected};const driver=createNativeDriver(config);
 config.backend=replacement;selected.admitSession=replacement.admitSession;
 const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal:new AbortController().signal});
 await authority.close();
 expect(replacement.admitSession).not.toHaveBeenCalled();expect(close).toHaveBeenCalledOnce();
});
it('retains backend capability qualification before operator metadata is changed',()=>{
 const feature={name:'live-files',evidence:['selected qualification']};
 const driver=createNativeDriver({backend:{features:[feature],inspectBuild:vi.fn(),admitSession:vi.fn()}});
 feature.name='byte-argv';feature.evidence[0]='replacement qualification';
 expect(driver.features).toContainEqual({name:'live-files',evidence:['selected qualification']});
 expect(driver.features.some(value=>value.name==='byte-argv')).toBe(false);
});
it.each(['relative', '/work\0other', '/work/\ud800'])('retires an unrepresentable installed cwd %j before launch admission', async cwd => {
 const close=vi.fn(async()=>{});const launch=vi.fn();
 const driver=createNativeDriver({launcher:{launch},backend:{features:[],inspectBuild:vi.fn(),async admitSession(){return{async close(){},async prepare(){return{cwd,env:{},close};}};}}});
 const signal=new AbortController().signal;
 const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal});
 await expect(authority.prepare({jobId:'j',tool:{}as never,build:{runtimeEnvironment:{}}as never,request:{args:[],env:{},stdin:{kind:'stream'},descriptors:[],limits:{maxFrameBytes:64}}as never,hooks:{}as never,signal})).rejects.toThrow('cwd');
 expect(close).toHaveBeenCalledOnce();expect(launch).not.toHaveBeenCalled();await authority.close();
});
it('admits installed descriptor slots rather than a backend iterator', async()=>{
 const stdio:('pipe'|'ignore'|number)[]=['pipe','pipe','pipe',77];
 stdio[Symbol.iterator]=function*(){yield 'pipe';yield 'pipe';yield 'pipe';yield 88;};
 const launch=vi.fn(()=>({exit:Promise.resolve({kind:'spawnError' as const,code:'ENOENT',stage:'spawn' as const,message:'fixture'}),settled:Promise.resolve(),async write(){},async end(){},signal(){}}));
 const driver=createNativeDriver({launcher:{launch},backend:{features:[],inspectBuild:vi.fn(),async admitSession(){return{async close(){},async prepare(){return{cwd:'/work',env:{},stdio,async close(){}};}};}}});
 const signal=new AbortController().signal;
 const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal});
 const prepared=await authority.prepare({jobId:'j',tool:{}as never,build:{runtimeEnvironment:{}}as never,request:{args:[],env:{},stdin:{kind:'stream'},descriptors:[{fd:3,openDescriptionId:'o',rights:['read','seek'],seekable:true}],limits:{maxFrameBytes:64}}as never,hooks:{}as never,signal});
 prepared.start({async output(){},async end(){}});
 expect(launch.mock.calls[0]?.[0]).toMatchObject({stdio:['pipe','pipe','pipe',77]});
 await prepared.close();await authority.close();
});
it.each([false,true])('refuses missing installed descriptor slots (inherited: %s)', async inherited=>{
 const stdio=new Array<string|number>(4);stdio[0]='pipe';stdio[1]='pipe';stdio[2]='pipe';
 if(inherited)Object.setPrototypeOf(stdio,Object.assign(Object.create(Array.prototype),{3:77}));
 const close=vi.fn(async()=>{});const launch=vi.fn();
 const driver=createNativeDriver({launcher:{launch},backend:{features:[],inspectBuild:vi.fn(),async admitSession(){return{async close(){},async prepare(){return{cwd:'/work',env:{},stdio:stdio as never,close};}};}}});
 const signal=new AbortController().signal;
 const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal});
 await expect(authority.prepare({jobId:'j',tool:{}as never,build:{runtimeEnvironment:{}}as never,request:{args:[],env:{},stdin:{kind:'stream'},descriptors:[{fd:3,openDescriptionId:'o',rights:['read','seek'],seekable:true}],limits:{maxFrameBytes:64}}as never,hooks:{}as never,signal})).rejects.toThrow('descriptor');
 expect(close).toHaveBeenCalledOnce();expect(launch).not.toHaveBeenCalled();await authority.close();
});
it('retires the acquired native namespace when authority inspection fails',async()=>{
 const failure=new Error('authority inspection failed');const close=vi.fn(async()=>{});const replacement=vi.fn(async()=>{});
 const namespace={close,prepare:vi.fn()};
 Object.defineProperty(namespace,'grants',{get(){namespace.close=replacement;throw failure;}});
 const driver=createNativeDriver({backend:{features:[],inspectBuild:vi.fn(),async admitSession(){return namespace;}}});
 await expect(driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal:new AbortController().signal})).rejects.toBe(failure);
 expect(close).toHaveBeenCalledOnce();expect(replacement).not.toHaveBeenCalled();
});
it('retains native namespace cleanup and its receiver across preparation',async()=>{
 const replacement=vi.fn(async()=>{});const close=vi.fn(async function(this:unknown){expect(this).toBe(namespace);});
 const namespace={close,async prepare(){namespace.close=replacement;return{cwd:'/work',env:{},async close(){}};}};
 const driver=createNativeDriver({backend:{features:[],inspectBuild:vi.fn(),async admitSession(){return namespace;}}});
 const signal=new AbortController().signal;
 const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal});
 const prepared=await authority.prepare({jobId:'j',tool:{executable:'/tools/tool'}as never,build:{runtimeEnvironment:{}}as never,request:{args:[],env:{},stdin:{kind:'stream'},descriptors:[],limits:{maxFrameBytes:64}}as never,hooks:{}as never,signal});
 await prepared.close();await authority.close();
 expect(close).toHaveBeenCalledOnce();expect(replacement).not.toHaveBeenCalled();
});
it.each([
 {kind:'exited' as const,exitCode:0},
 {kind:'signaled' as const,signal:'SIGTERM'},
 {kind:'unknown' as const,reason:'Exit receipt lost'},
 {kind:'spawnError' as const,code:'ENOENT',stage:'spawn' as const,message:'Missing executable'},
])('qualifies group cleanup independently from native outcome: %j', async outcome=>{
 const close=vi.fn(async()=>{});
 const process={exit:Promise.resolve(outcome),settled:Promise.resolve(),async write(){},async end(){},signal(){}};
 const driver=createNativeDriver({launcher:{launch:()=>process},backend:{features:[],inspectBuild:vi.fn(),async admitSession(){return{async close(){},async prepare(){return{cwd:'/work',env:{},close};}};}}});
 const signal=new AbortController().signal;
 const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal});
 const prepared=await authority.prepare({jobId:'j',tool:{executable:'/tools/tool'}as never,build:{runtimeEnvironment:{}}as never,request:{args:[],env:{},stdin:{kind:'stream'},descriptors:[],limits:{maxFrameBytes:64}}as never,hooks:{}as never,signal});
 const running=prepared.start({async output(){},async end(){}});
 if(outcome.kind==='spawnError')await prepared.close();
 else await expect(prepared.close()).rejects.toMatchObject({code:'termination-unconfirmed'});
 expect(await running.exit).toEqual(outcome);
 expect(close).toHaveBeenCalledOnce();
 if(outcome.kind==='spawnError')await authority.close();
 else await expect(authority.close()).rejects.toBeInstanceOf(AggregateError);
});
it.each([{VALUE:'bad\0value'}, {'BAD=KEY':'value'}, {'':'value'}, {VALUE:'\ud800'}])('refuses unrepresentable caller environment before namespace effects: %j', async env => {
 const prepare=vi.fn(async()=>({cwd:'/work',env:{},async close(){}}));
 const launcher={launch:vi.fn()};const signal=new AbortController().signal;
 const driver=createNativeDriver({launcher,backend:{features:[],inspectBuild:vi.fn(),async admitSession(){return{prepare,async close(){}};}}});
 const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal});
 await expect(authority.prepare({jobId:'j',tool:{executable:'/tools/tool'}as never,build:{runtimeEnvironment:{}}as never,request:{args:[],env,stdin:{kind:'stream'},descriptors:[],limits:{maxFrameBytes:64}}as never,hooks:{}as never,signal})).rejects.toThrow();
 expect(prepare).not.toHaveBeenCalled();expect(launcher.launch).not.toHaveBeenCalled();
 await authority.close();
});
it('refuses invalid pinned runtime environment before namespace effects', async()=>{
 const prepare=vi.fn();const signal=new AbortController().signal;
 const driver=createNativeDriver({backend:{features:[],inspectBuild:vi.fn(),async admitSession(){return{prepare,async close(){}};}}});
 const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal});
 await expect(authority.prepare({jobId:'j',tool:{}as never,build:{runtimeEnvironment:{PATH:'bad\0path'}}as never,request:{args:[],env:{},limits:{maxArgvBytes:64}}as never,hooks:{}as never,signal})).rejects.toThrow('unrepresentable');
 expect(prepare).not.toHaveBeenCalled();await authority.close();
});
it.each(['cwd', 'env', 'stdio'] as const)('uses the acquired native cleanup when %s admission replaces its method', async field => {
 const failure = new Error('installed admission failed');
 const close = vi.fn(async () => {}); const replacement = vi.fn(async () => {});
 const installed = { cwd: '/work', env: {}, stdio: ['pipe', 'pipe', 'pipe'], close };
 Object.defineProperty(installed, field, { get() { installed.close = replacement; throw failure; } });
 const driver = createNativeDriver({ launcher: { launch: vi.fn() }, backend: {
  features: [], inspectBuild: vi.fn(), async admitSession() { return { async close() {}, async prepare() { return installed as never; } }; },
 } });
 const signal = new AbortController().signal;
 const authority = await driver.admitSession({ principal: { tenantId: 't', principalId: 'p', expiresAt: 999999 }, request: {} as never, signal });
 try {
  await expect(authority.prepare({ jobId: 'j', tool: {} as never, build: { runtimeEnvironment: {} } as never,
   request: { args: [], env: {}, stdin: { kind: 'stream' }, descriptors: [], limits: { maxFrameBytes: 64 } } as never,
   hooks: {} as never, signal })).rejects.toBe(failure);
 } finally { await authority.close(); }
 expect(close).toHaveBeenCalledOnce(); expect(replacement).not.toHaveBeenCalled();
});
it.each(['cwd','env','stdio'] as const)('retires acquired native resources when installed %s inspection throws',async field=>{
 const failure=new Error('installed profile inspection failed');const close=vi.fn(async()=>{});
 const installed={cwd:'/work',env:{},stdio:['pipe','pipe','pipe'],close};
 Object.defineProperty(installed,field,{get(){throw failure;}});
 const driver=createNativeDriver({launcher:{launch:vi.fn()},backend:{features:[],inspectBuild:vi.fn(),async admitSession(){return{async close(){},async prepare(){return installed as never;}};}}});
 const signal=new AbortController().signal;
 const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal});
 await expect(authority.prepare({jobId:'j',tool:{}as never,build:{runtimeEnvironment:{}}as never,request:{args:[],env:{},stdin:{kind:'stream'},descriptors:[],limits:{maxFrameBytes:64}}as never,hooks:{}as never,signal})).rejects.toBe(failure);
 await authority.close();expect(close).toHaveBeenCalledOnce();
});
it('preserves acquisition validation and retirement failures for the session owner',async()=>{
 const validation=new Error('installed profile inspection failed');const retirement=new Error('native lease retirement failed');
 const close=vi.fn(async()=>{throw retirement;});
 const driver=createNativeDriver({backend:{features:[],inspectBuild:vi.fn(),async admitSession(){return{async close(){},async prepare(){return{get cwd():string{throw validation;},env:{},close};}};}}});
 const signal=new AbortController().signal;
 const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal});
 await expect(authority.prepare({jobId:'j',tool:{}as never,build:{runtimeEnvironment:{}}as never,request:{args:[],env:{},stdin:{kind:'stream'},descriptors:[],limits:{maxFrameBytes:64}}as never,hooks:{}as never,signal})).rejects.toMatchObject({errors:[validation,retirement]});
 await expect(authority.close()).rejects.toMatchObject({errors:[retirement]});expect(close).toHaveBeenCalledOnce();
});
it.each([-1,1.5,2147483648,'pipe', 'ignore'])('refuses invalid installed seekable lease %s before returning a prepared invocation',async lease=>{
 const close=vi.fn(async()=>{});const launcher={launch:vi.fn()};
 const driver=createNativeDriver({launcher,backend:{features:[],inspectBuild:vi.fn(),async admitSession(){return{async close(){},async prepare(){return{cwd:'/work',env:{},stdio:['pipe','pipe','pipe',lease] as never,close};}};}}});
 const signal=new AbortController().signal;
 const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal});
 await expect(authority.prepare({jobId:'j',tool:{}as never,build:{runtimeEnvironment:{}}as never,request:{args:[],env:{},stdin:{kind:'stream'},descriptors:[{fd:3,openDescriptionId:'o',rights:['read','seek'],seekable:true}],limits:{maxFrameBytes:64}}as never,hooks:{}as never,signal})).rejects.toThrow('native');
 expect(close).toHaveBeenCalledOnce();expect(launcher.launch).not.toHaveBeenCalled();await authority.close();
});
it('prepares and launches the exact octets admitted from accessor-backed argv',async()=>{
 let reads=0;const token=[65];Object.defineProperty(token,0,{get:()=>++reads===1?65:255});
 const launch=vi.fn(()=>({exit:Promise.resolve({kind:'exited' as const,exitCode:0}),settled:Promise.resolve(),async write(){},async end(){},signal(){},async terminateGroup(){}}));
 const prepare=vi.fn(async(_input:Parameters<SessionAuthority['prepare']>[0])=>({cwd:'/work',env:{},async close(){}}));const signal=new AbortController().signal;
 const driver=createNativeDriver({launcher:{launch},backend:{features:[],inspectBuild:vi.fn(),async admitSession(){return{prepare,async close(){}};}}});
 const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal});
 const invocation=await authority.prepare({jobId:'j',tool:{executable:'/tool'}as never,build:{runtimeEnvironment:{}}as never,request:{args:[token],env:{},stdin:{kind:'stream'},descriptors:[],limits:{maxArgvBytes:64,maxFrameBytes:64}}as never,hooks:{}as never,signal});
 invocation.start({async output(){},async end(){}});
 expect(prepare.mock.calls[0][0].request.args).toEqual([[65]]);
 expect(launch).toHaveBeenCalledWith(expect.objectContaining({args:[[65]]}),expect.anything());
 expect(reads).toBe(1);await invocation.close();await authority.close();
});
it('advertises the lossless UTF-8 launcher profile without inheriting byte argv claims',()=>{
 const driver=createNativeDriver({backend:{features:[{name:'byte-argv',evidence:['backend-only']},{name:'live-files',evidence:['qualified mount']}],inspectBuild:vi.fn(),admitSession:vi.fn()}});
 expect(driver.features).toContainEqual({name:'utf8-argv',evidence:['nativeArgumentText: fatal UTF-8 decoding with BOM preservation; Node spawn shell:false']});
 expect(driver.features.some(feature=>feature.name==='byte-argv')).toBe(false);
 expect(driver.features.filter(feature=>feature.name==='live-files')).toEqual([{name:'live-files',evidence:['qualified mount']}]);
});
it('rejects oversized argv before cloning or installing assets',async()=>{
 const prepare=vi.fn();const launcher={launch:vi.fn()};const signal=new AbortController().signal;
 const driver=createNativeDriver({launcher,backend:{features:[],inspectBuild:vi.fn(),async admitSession(){return{prepare,async close(){}};}}});
 const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal});
 const arg=[97];Object.defineProperty(arg,0,{get(){throw new Error('Unadmitted argv cloned');}});
 await expect(authority.prepare({jobId:'j',tool:{}as never,build:{}as never,request:{args:[arg,[98,99]],limits:{maxArgvBytes:4}}as never,hooks:{}as never,signal})).rejects.toThrow('Native argv byte bound');
 expect(prepare).not.toHaveBeenCalled();expect(launcher.launch).not.toHaveBeenCalled();await authority.close();
});
it('rejects an oversized installed descriptor table before copying it and retires the preparation',async()=>{
 const stdio=new Array(1025);
 Object.defineProperty(stdio,0,{get(){throw new Error('Unadmitted installed descriptor accessed');}});
 const close=vi.fn(async()=>{});const launcher={launch:vi.fn()};const signal=new AbortController().signal;
 const driver=createNativeDriver({launcher,backend:{features:[],inspectBuild:vi.fn(),async admitSession(){return{async close(){},async prepare(){return{cwd:'/work',env:{},stdio,close};}};}}});
 const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal});
 await expect(authority.prepare({jobId:'j',tool:{}as never,build:{runtimeEnvironment:{}}as never,request:{args:[],env:{},stdin:{kind:'stream'},descriptors:[],limits:{maxFrameBytes:64}}as never,hooks:{}as never,signal})).rejects.toThrow('Invalid installed native descriptors');
 expect(close).toHaveBeenCalledOnce();expect(launcher.launch).not.toHaveBeenCalled();await authority.close();
});
it('pins installed cwd, runtime env and descriptor leases through launch',async()=>{
 const installed={cwd:'/isolated/work',env:{HOME:'/runtime'},stdio:['pipe','pipe','pipe',17] as ('pipe'|number)[],async close(){}};
 const launcher={launch:vi.fn(()=>({exit:Promise.resolve({kind:'exited' as const,exitCode:0}),settled:Promise.resolve(),async write(){},async end(){},signal(){},async terminateGroup(){}}))};
 const signal=new AbortController().signal;
 const driver=createNativeDriver({launcher,backend:{features:[],inspectBuild:vi.fn(),async admitSession(){return{async close(){},async prepare(){return installed;}};}}});
 const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal});
 const prepared=await authority.prepare({jobId:'j',tool:{executable:'/assets/tool'}as never,build:{runtimeEnvironment:{HOME:'/runtime'}}as never,request:{args:[],env:{HOME:'/runtime'},stdin:{kind:'stream'},descriptors:[{fd:3,handleId:'h',openDescriptionId:'o',grantId:'g',rights:['read','seek'],seekable:true}],limits:{maxFrameBytes:64}}as never,hooks:{}as never,signal});
 installed.cwd='/server';installed.env.HOME='/secret';installed.stdio[3]=23;
 prepared.start({async output(){},async end(){}});
 expect(launcher.launch).toHaveBeenCalledWith(expect.objectContaining({cwd:'/isolated/work',env:{HOME:'/runtime'},stdio:['pipe','pipe','pipe',17]}),expect.anything());
 await prepared.close();
});
it('preserves falsey cancellation and reports failed late retirement to the session owner',async()=>{
 const controller=new AbortController();let release!:()=>void;
 const ready=new Promise<void>(resolve=>{release=resolve;});const cleanup=new Error('late cleanup');
 const close=vi.fn(async()=>{throw cleanup;});const sessionClose=vi.fn(async()=>{});
 const driver=createNativeDriver({launcher:{launch:vi.fn()},backend:{features:[],inspectBuild:vi.fn(),async admitSession(){return{close:sessionClose,async prepare(){await ready;return{cwd:'/work',env:{},close};}};}}});
 const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal:controller.signal});
 const pending=authority.prepare({jobId:'j',tool:{}as never,build:{runtimeEnvironment:{}}as never,request:{args:[],limits:{maxArgvBytes:64,maxFrameBytes:64}}as never,hooks:{}as never,signal:controller.signal});
 controller.abort(false);const rejected=expect(pending).rejects.toBe(false);release();await rejected;
 await expect(authority.close()).rejects.toMatchObject({errors:[cleanup]});
 expect(close).toHaveBeenCalledOnce();expect(sessionClose).toHaveBeenCalledOnce();
});
it('drains late acquisitions before closing session storage and refuses new preparation',async()=>{
 let release!:()=>void;const ready=new Promise<void>(resolve=>{release=resolve;});
 const events:string[]=[];const close=vi.fn(async()=>{events.push('invocation');});
 const launcher={launch:vi.fn()};const signal=new AbortController().signal;
 const driver=createNativeDriver({launcher,backend:{features:[],inspectBuild:vi.fn(),async admitSession(){return{async close(){events.push('session');},async prepare(){await ready;return{cwd:'/work',env:{},close};}};}}});
 const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal});
 const input={jobId:'j',tool:{}as never,build:{runtimeEnvironment:{}}as never,request:{args:[],limits:{maxArgvBytes:64,maxFrameBytes:64}}as never,hooks:{}as never,signal};
 const preparing=authority.prepare(input);const rejected=expect(preparing).rejects.toThrow('retiring');
 const retiring=authority.close();await Promise.resolve();expect(events).toEqual([]);
 expect(()=>authority.prepare(input)).toThrow('retiring');
 release();await rejected;await retiring;
 expect(events).toEqual(['invocation','session']);expect(launcher.launch).not.toHaveBeenCalled();
 expect(authority.close()).toBe(retiring);
});
it('snapshots admitted execution tokens before asynchronous namespace preparation',async()=>{
 const close=vi.fn(async()=>{});
 const launcher={launch:vi.fn(()=>({exit:Promise.resolve({kind:'exited' as const,exitCode:0}),settled:Promise.resolve(),async write(){},async end(){},signal(){},async terminateGroup(){}}))};
 let release!:()=>void;const ready=new Promise<void>(resolve=>{release=resolve;});
 const backend={features:[],inspectBuild:vi.fn(),async admitSession(){return{async close(){},async prepare(){await ready;return{cwd:'/isolated/work',env:{},close};}};}};
 const driver=createNativeDriver({backend,launcher});const signal=new AbortController().signal;
 const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal});
 const tool={id:'tool',executable:'/assets/tool',buildDigest:'d',requiredFeatures:[]};
 const request={args:[[],[97,32,98]],env:{VALUE:'original'},stdin:{kind:'stream'},descriptors:[],limits:{maxFrameBytes:64,maxArgvBytes:64}};
 const pending=authority.prepare({jobId:'j',tool,build:{runtimeEnvironment:{}}as never,request:request as never,hooks:{}as never,signal});
 request.args[1][0]=120;request.args.push([99]);request.env.VALUE='changed';request.limits.maxFrameBytes=1;request.limits.maxArgvBytes=1;tool.executable='/different';release();
 const prepared=await pending;prepared.start({async output(){},async end(){}});
 expect(launcher.launch).toHaveBeenCalledWith(expect.objectContaining({executable:'/assets/tool',args:[[],[97,32,98]],env:{VALUE:'original'},maxFrameBytes:64,maxArgvBytes:64}),expect.anything());
 await prepared.close();
});
it('refuses pipe or ignored slots in place of required installed native descriptors',async()=>{
 const close=vi.fn(async()=>{});const launcher={launch:vi.fn()};const signal=new AbortController().signal;
 const driver=createNativeDriver({launcher,backend:{features:[],inspectBuild:vi.fn(),async admitSession(){return{async close(){},async prepare(){return{cwd:'/work',env:{},stdio:['pipe','pipe','pipe','ignore'] as const,close};}};}}});
 const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal});
 for(const request of [
  {stdin:{kind:'handle',handleId:'lease',grantId:'grant',position:'0',seekable:true},descriptors:[]},
  {stdin:{kind:'stream'},descriptors:[{fd:3,handleId:'lease',openDescriptionId:'opened',grantId:'grant',rights:['read','seek'],seekable:true}]},
 ])await expect(authority.prepare({jobId:'j',tool:{}as never,build:{runtimeEnvironment:{}}as never,request:{...request,args:[],env:{},limits:{maxFrameBytes:64}}as never,hooks:{}as never,signal})).rejects.toThrow('native handles');
 expect(close).toHaveBeenCalledTimes(2);expect(launcher.launch).not.toHaveBeenCalled();
});
it('keeps installed nonseekable duplicate descriptors on their native open description',async()=>{
 const close=vi.fn(async()=>{});const launcher={launch:vi.fn(()=>({exit:Promise.resolve({kind:'exited' as const,exitCode:0}),settled:Promise.resolve(),async write(){},async end(){},signal(){},async terminateGroup(){}}))};
 const descriptors=[3,4].map(fd=>({fd,handleId:'lease',openDescriptionId:'shared',grantId:'grant',rights:['read','write'],seekable:false}));
 for(const stdio of [undefined,['pipe','pipe','pipe',17,17] as const]){
  const driver=createNativeDriver({launcher,backend:{features:[],inspectBuild:vi.fn(),async admitSession(){return{async close(){},async prepare(){return{cwd:'/work',env:{},stdio,close};}};}}});
  const signal=new AbortController().signal;
  const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal});
  const preparing=authority.prepare({jobId:'j',tool:{executable:'/tool'}as never,build:{runtimeEnvironment:{}}as never,request:{args:[],env:{},stdin:{kind:'stream'},descriptors,limits:{maxFrameBytes:64}}as never,hooks:{}as never,signal});
  if(!stdio){await expect(preparing).rejects.toThrow('Duplicate native');expect(launcher.launch).not.toHaveBeenCalled();continue;}
  const prepared=await preparing;prepared.start({async output(){},async end(){}});
  expect(launcher.launch).toHaveBeenCalledWith(expect.objectContaining({stdio,inputChannels:[1],outputChannels:[2,3]}),expect.anything());
  await prepared.close();
 }
});
it('retires local pipes before waiting for native settlement when group termination fails',async()=>{
 const cause=new Error('termination unconfirmed');let release!:()=>void;
 const settled=new Promise<void>(resolve=>{release=resolve;});const closeOutput=vi.fn();const closeInput=vi.fn();const close=vi.fn(async()=>{});
 const launcher={launch:vi.fn(()=>({exit:Promise.resolve({kind:'exited' as const,exitCode:7}),settled,async write(){},async end(){},signal(){},closeInput,closeOutput,async terminateGroup(){throw cause;}}))};
 const driver=createNativeDriver({launcher,backend:{features:[],inspectBuild:vi.fn(),async admitSession(){return{async close(){},async prepare(){return{cwd:'/work',env:{},close};}};}}});
 const signal=new AbortController().signal;
 const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal});
 const prepared=await authority.prepare({jobId:'j',tool:{executable:'/tool'}as never,build:{runtimeEnvironment:{}}as never,request:{args:[],env:{},stdin:{kind:'stream'},descriptors:[],limits:{maxFrameBytes:64}}as never,hooks:{}as never,signal});
 prepared.start({async output(){},async end(){}});
 const rejected=expect(prepared.close()).rejects.toBe(cause);
 await new Promise<void>(resolve=>setImmediate(resolve));
 const outputs=closeOutput.mock.calls.map(call=>call[0]);const inputs=closeInput.mock.calls.map(call=>call[0]);
 release();await rejected;
 expect(outputs).toEqual([2,3]);expect(inputs).toEqual([1]);expect(close).toHaveBeenCalledOnce();
});
it('drains a late preparation after cancellation and preserves a falsey abort reason',async()=>{
 const controller=new AbortController();let release!:()=>void;const ready=new Promise<void>(resolve=>{release=resolve;});
 const close=vi.fn(async()=>{});const launcher={launch:vi.fn()};
 const driver=createNativeDriver({launcher,backend:{features:[],inspectBuild:vi.fn(),async admitSession(){return{async close(){},async prepare(){await ready;return{cwd:'/work',env:{},close};}};}}});
 const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal:controller.signal});
 const pending=authority.prepare({jobId:'j',tool:{}as never,build:{runtimeEnvironment:{}}as never,request:{args:[],env:{},stdin:{kind:'stream'},descriptors:[],limits:{maxFrameBytes:64}}as never,hooks:{}as never,signal:controller.signal});
 controller.abort(false);const rejected=expect(pending).rejects.toBe(false);release();await rejected;
 expect(close).toHaveBeenCalledOnce();expect(launcher.launch).not.toHaveBeenCalled();
});
it('retains I/O settlement failures when filesystem retirement also fails',async()=>{
 const ioFailure=new Error('output delivery failed');const cleanupFailure=new Error('filesystem close failed');
 const close=vi.fn(async()=>{throw cleanupFailure;});
 const launcher={launch:vi.fn(()=>({exit:Promise.resolve({kind:'exited' as const,exitCode:0}),settled:Promise.reject(ioFailure),async write(){},async end(){},signal(){},async terminateGroup(){}}))};
 const driver=createNativeDriver({launcher,backend:{features:[],inspectBuild:vi.fn(),async admitSession(){return{async close(){},async prepare(){return{cwd:'/work',env:{},close};}};}}});
 const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal:new AbortController().signal});
 const prepared=await authority.prepare({jobId:'j',tool:{executable:'/tool'}as never,build:{runtimeEnvironment:{}}as never,request:{args:[],env:{},stdin:{kind:'stream'},descriptors:[],limits:{maxFrameBytes:64}}as never,hooks:{}as never,signal:new AbortController().signal});
 prepared.start({async output(){},async end(){}});
 await expect(prepared.close()).rejects.toMatchObject({errors:[ioFailure,cleanupFailure]});expect(close).toHaveBeenCalledOnce();
});
it('waits for native output retirement before releasing prepared filesystem ownership',async()=>{
 let release!:()=>void;const settled=new Promise<void>(resolve=>{release=resolve;});const close=vi.fn(async()=>{});const terminateGroup=vi.fn(async()=>{});
 const launcher={launch:vi.fn(()=>({exit:Promise.resolve({kind:'exited' as const,exitCode:42}),settled,async write(){},async end(){},signal(){},terminateGroup}))};
 const driver=createNativeDriver({launcher,backend:{features:[],inspectBuild:vi.fn(),async admitSession(){return{async close(){},async prepare(){return{cwd:'/work',env:{},close};}};}}});
 const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal:new AbortController().signal});
 const prepared=await authority.prepare({jobId:'j',tool:{executable:'/tool'}as never,build:{runtimeEnvironment:{}}as never,request:{args:[],env:{},stdin:{kind:'stream'},descriptors:[],limits:{maxFrameBytes:64}}as never,hooks:{}as never,signal:new AbortController().signal});
 prepared.start({async output(){},async end(){}});let closed=false;const closing=prepared.close().then(()=>{closed=true;});await new Promise<void>(resolve=>setImmediate(resolve));expect(closed).toBe(false);expect(close).not.toHaveBeenCalled();expect(terminateGroup).toHaveBeenCalledOnce();release();await closing;expect(close).toHaveBeenCalledOnce();
});
it('admits raw byte argv only with the build-bound verified launcher revision',async()=>{
 const prepare=vi.fn(async()=>({cwd:'/work',env:{},async close(){}}));const signal=new AbortController().signal;
 const launch=vi.fn(()=>({exit:Promise.resolve({kind:'exited' as const,exitCode:0}),settled:Promise.resolve(),async write(){},async end(){},signal(){},async terminateGroup(){}}));
 const launcher={launch,argvProfile:{kind:'bytes' as const,revision:'posix-execve-v1:pinned',evidence:['disposable fixture only']}};
 const driver=createNativeDriver({launcher,backend:{features:[{name:'byte-argv',evidence:['backend claim only']}],inspectBuild:vi.fn(),async admitSession(){return{async close(){},prepare};}}});
 expect(driver.features.find(feature=>feature.name==='byte-argv')?.evidence).toEqual(launcher.argvProfile.evidence);
 expect(driver.features.some(feature=>feature.name==='utf8-argv')).toBe(false);
 const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal});
 const input={jobId:'j',tool:{executable:'/tools/tool'}as never,build:{runtimeEnvironment:{},launcherRevision:launcher.argvProfile.revision}as never,request:{args:[[],[255,192,175]],env:{},stdin:{kind:'stream'},descriptors:[],limits:{maxFrameBytes:64,maxArgvBytes:64}}as never,hooks:{}as never,signal};
 await expect(authority.prepare({...input,build:{runtimeEnvironment:{},launcherRevision:'different'}as never})).rejects.toThrow('launcher');
 expect(prepare).not.toHaveBeenCalled();
 const invocation=await authority.prepare(input);invocation.start({async output(){},async end(){}});
 expect(launch).toHaveBeenCalledWith(expect.objectContaining({args:[[],[255,192,175]]}),expect.anything());
 await invocation.close();await authority.close();
});

it('refuses an unbound byte launcher during build inspection before session acquisition',async()=>{
 const admitSession=vi.fn();const inspectBuild=vi.fn(async()=>({launcherRevision:'other'}));
 const driver=createNativeDriver({launcher:{argvProfile:{kind:'bytes',revision:'pinned',evidence:['fixture']},launch:vi.fn()},backend:{features:[],inspectBuild:inspectBuild as never,admitSession}});
 await expect(driver.inspectBuild('build')).rejects.toThrow('launcher');
 expect(admitSession).not.toHaveBeenCalled();
});

it('retains the admitted launcher profile once instead of widening it through accessor rereads',()=>{
 let reads=0;
 const launcher={launch:vi.fn(),get argvProfile(){reads++;return reads===1?{kind:'bytes' as const,revision:'pinned',evidence:['fixture']}:undefined;}};
 const driver=createNativeDriver({launcher,backend:{features:[],inspectBuild:vi.fn(),admitSession:vi.fn()}});
 expect(driver.features.some(feature=>feature.name==='byte-argv')).toBe(true);expect(reads).toBe(1);
});
it('derives advertised allocation limits from the launcher and retains their authority during preparation',async()=>{
 const prepare=vi.fn(async()=>({cwd:'/work',env:{},async close(){}}));const signal=new AbortController().signal;
 const driver=createNativeDriver({launcher:{argvProfile:{kind:'bytes',revision:'pinned',evidence:['fixture'],maxArgvBytes:8,maxDescriptors:6},launch:vi.fn()},backend:{limits:{maxArgvBytes:64,maxHandles:8},features:[],inspectBuild:vi.fn(),async admitSession(){return{async close(){},prepare};}}});
 expect(driver.limits).toMatchObject({maxArgvBytes:8,maxHandles:3});
 const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal});
 driver.limits!.maxArgvBytes=64;
 await expect(authority.prepare({jobId:'j',tool:{executable:'/tool'}as never,build:{runtimeEnvironment:{},launcherRevision:'pinned'}as never,request:{args:[new Array(8).fill(65)],env:{},stdin:{kind:'stream'},descriptors:[],limits:{maxArgvBytes:64,maxFrameBytes:64}}as never,hooks:{}as never,signal})).rejects.toThrow('argv');
 expect(prepare).not.toHaveBeenCalled();await authority.close();
});

it('requires qualified isolation preparation and passes literal argv into the process launcher once',async()=>{
 const close=vi.fn(async()=>{});const launcher={launch:vi.fn(()=>({exit:Promise.resolve({kind:'exited' as const,exitCode:0}),settled:Promise.resolve(),async write(){},async end(){},signal:vi.fn(),async terminateGroup(){}}))};
 const backend={features:[{name:'live-files',evidence:['fixture-only']}],inspectBuild:vi.fn(),admitSession:vi.fn(async()=>({close,prepare:vi.fn(async()=>({cwd:'/isolated/work',env:{APP:'value'},close}))}))};
 const driver=createNativeDriver({backend,launcher});const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{} as never,signal:new AbortController().signal});
 const request={args:[[],[36,40,105,100,41]],env:{APP:'value'},descriptors:[],stdin:{kind:'stream'},limits:{maxFrameBytes:64}};
 const prepared=await authority.prepare({jobId:'j',tool:{id:'tool',executable:'/assets/tool',buildDigest:'d',requiredFeatures:['live-files']},build:{runtimeEnvironment:{APP:'value'}} as never,request:request as never,hooks:{} as never,signal:new AbortController().signal});
 prepared.start({async output(){},async end(){}});expect(launcher.launch).toHaveBeenCalledWith(expect.objectContaining({executable:'/assets/tool',args:request.args,cwd:'/isolated/work',env:{APP:'value'}}),expect.anything());
 expect(()=>prepared.start({async output(){},async end(){}})).toThrow();await prepared.close();expect(close).toHaveBeenCalledTimes(1);
});
it('retains authority methods and receiver identity when the backend returns a class instance',async()=>{
 class Namespace{closed=false;async close(){this.closed=true;}async prepare(){return{cwd:'/work',env:{},async close(){}};}}
 const namespace=new Namespace();const driver=createNativeDriver({backend:{features:[],inspectBuild:vi.fn(),async admitSession(){return namespace;}}});
 const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal:new AbortController().signal});await authority.close();expect(namespace.closed).toBe(true);
});

it('refuses undeclared runtime variables and conflicting caller values and closes preparation',async()=>{
 for(const [runtime,env] of [[{}, {SECRET:'host'}],[{KEY:'fixed'},{KEY:'fixed'}]]){
  const close=vi.fn(async()=>{});const driver=createNativeDriver({backend:{features:[],inspectBuild:vi.fn(),async admitSession(){return{async close(){},async prepare(){return{cwd:'/work',env,close};}};}}});
  const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal:new AbortController().signal});
  await expect(authority.prepare({jobId:'j',tool:{}as never,build:{runtimeEnvironment:runtime}as never,request:{args:[],limits:{maxArgvBytes:64,maxFrameBytes:64},env:{KEY:'different'},descriptors:[],stdin:{kind:'stream'}}as never,hooks:{}as never,signal:new AbortController().signal})).rejects.toThrow('environment');
  expect(close).toHaveBeenCalledTimes(Object.keys(runtime).length?0:1);
 }
});

it.each([[255], [0], [192, 175]])('rejects unrepresentable argv %j before namespace preparation', async (...octets) => {
 const prepare=vi.fn(async()=>({cwd:'/work',env:{},async close(){}}));
 const launcher={launch:vi.fn()};const signal=new AbortController().signal;
 const driver=createNativeDriver({launcher,backend:{features:[],inspectBuild:vi.fn(),async admitSession(){return{async close(){},prepare};}}});
 const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal});
 await expect(authority.prepare({jobId:'j',tool:{executable:'/assets/tool'}as never,build:{runtimeEnvironment:{}}as never,request:{args:[octets],env:{},stdin:{kind:'stream'},descriptors:[],limits:{maxFrameBytes:64}}as never,hooks:{}as never,signal})).rejects.toThrow('argv');
 expect(prepare).not.toHaveBeenCalled();expect(launcher.launch).not.toHaveBeenCalled();
 await authority.close();
});

it('checks the media frontend contract before namespace preparation', async()=>{
 const prepare=vi.fn(async()=>({cwd:'/work',env:{},async close(){}}));const signal=new AbortController().signal;
 const driver=createNativeDriver({launcher:{launch:vi.fn()},backend:{features:[],inspectBuild:vi.fn(),async admitSession(){return{async close(){},prepare};}}});
 const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal});
 for(const frontendContract of [undefined,{grammarRevision:'other',sourceRevision:'native-s'}]){
  await expect(authority.prepare({jobId:'j',tool:{executable:'/assets/tool',requiresFrontendContract:true}as never,build:{runtimeEnvironment:{},grammarRevision:'native-g',sourceRevision:'native-s'}as never,request:{args:[],frontendContract,env:{},stdin:{kind:'stream'},descriptors:[],limits:{maxFrameBytes:64}}as never,hooks:{}as never,signal})).rejects.toThrow('frontend');
 }
 expect(prepare).not.toHaveBeenCalled();await authority.close();
});

it('refuses an explicitly mismatched generic frontend before native preparation',async()=>{
 const prepare=vi.fn();const signal=new AbortController().signal;
 const driver=createNativeDriver({backend:{features:[],inspectBuild:vi.fn(),async admitSession(){return{prepare,async close(){}};}}});
 const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal});
 await expect(authority.prepare({jobId:'j',tool:{}as never,build:{grammarRevision:'native-g',sourceRevision:'native-s',runtimeEnvironment:{}}as never,request:{args:[],limits:{maxArgvBytes:64},frontendContract:{grammarRevision:'other',sourceRevision:'native-s'}}as never,hooks:{}as never,signal})).rejects.toThrow('frontend contract');
 expect(prepare).not.toHaveBeenCalled();await authority.close();
});

it('refuses caller conflicts with fixed runtime environment before installing assets',async()=>{
 const prepare=vi.fn();const signal=new AbortController().signal;
 const driver=createNativeDriver({backend:{features:[],inspectBuild:vi.fn(),async admitSession(){return{prepare,async close(){}};}}});
 const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal});
 await expect(authority.prepare({jobId:'j',tool:{}as never,build:{runtimeEnvironment:{HOME:'/runtime'}}as never,request:{args:[],limits:{maxArgvBytes:64},env:{HOME:'/other'}}as never,hooks:{}as never,signal})).rejects.toThrow('environment conflict');
 expect(prepare).not.toHaveBeenCalled();await authority.close();
});

it('retires prepared and running invocations before closing their session namespace', async()=>{
 const events:string[]=[];const signal=new AbortController().signal;
 const launcher={launch:vi.fn(()=>({exit:Promise.resolve({kind:'exited' as const,exitCode:0}),settled:Promise.resolve(),async write(){},async end(){},signal(){},async terminateGroup(){events.push('group');}}))};
 const driver=createNativeDriver({launcher,backend:{features:[],inspectBuild:vi.fn(),async admitSession(){return{async close(){events.push('namespace');},async prepare(){return{cwd:'/work',env:{},async close(){events.push('invocation');}};}};}}});
 const authority=await driver.admitSession({principal:{tenantId:'t',principalId:'p',expiresAt:999999},request:{}as never,signal});
 const input={jobId:'j',tool:{executable:'/assets/tool'}as never,build:{runtimeEnvironment:{}}as never,request:{args:[],env:{},stdin:{kind:'stream'},descriptors:[],limits:{maxFrameBytes:64}}as never,hooks:{}as never,signal};
 const running=await authority.prepare(input);running.start({async output(){},async end(){}});
 const unstarted=await authority.prepare({...input,jobId:'unstarted'});
 await authority.close();
 expect(events.slice(0,-1).sort()).toEqual(['group','invocation','invocation']);
 expect(events.at(-1)).toBe('namespace');
 expect(()=>unstarted.start({async output(){},async end(){}})).toThrow('closed');
 await running.close();await unstarted.close();expect(events.filter(event=>event==='invocation')).toHaveLength(2);
});
