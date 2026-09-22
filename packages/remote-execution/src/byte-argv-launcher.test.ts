import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {expect,it,vi} from 'vitest';
import {createByteArgvLauncher} from './byte-argv-launcher.js';

const helper=new Uint8Array([1,2,3]);
const digest=createHash('sha256').update(helper).digest('hex');
const options={helperExecutable:'/trusted/execve',helperDigest:digest,maxHelperBytes:64};
const assets={async *open(){yield helper;}};
const spec={executable:'/tools/tool',args:[[],[255,192,175],[36,40,105,100,41]],cwd:'/work',env:{VALUE:'literal'},inputChannels:[1],outputChannels:[2,3,4],maxFrameBytes:64,maxArgvBytes:64};
function child(){return Object.assign(new EventEmitter(),{pid:123,stdio:Array.from({length:6},()=>new PassThrough())});}
function finish(c:ReturnType<typeof child>,code=23){for(const index of [1,2,3,5])c.stdio[index]!.end();c.emit('exit',code,null);c.emit('close',code,null);}

it('preserves raw tokens and tool streams while using separate bounded execve channels',async()=>{
 const c=child();const spawn=vi.fn(()=>c);const outputs:Record<number,number[]>={};
 const launcher=await createByteArgvLauncher(options,{...assets,spawn:spawn as never});
 expect(spawn).not.toHaveBeenCalled();
 const request:Buffer[]=[];c.stdio[4]!.on('data',chunk=>request.push(chunk));
 const run=launcher.launch(spec,{async output(channel,bytes){outputs[channel]=Array.from(bytes);},async end(){}});
 c.stdio[1]!.write(new Uint8Array([0,255]));c.stdio[2]!.write(new Uint8Array([7]));c.stdio[3]!.write(new Uint8Array([128]));
 finish(c);expect(await run.exit).toEqual({kind:'exited',exitCode:23});await run.settled;
 const body=Buffer.concat(request);expect(body.subarray(0,4).toString()).toBe('RMA1');
 expect(body.readUInt32BE(4)).toBe(3);expect(body.readUInt32BE(8)).toBe(11);
 let offset=12;const tokens:number[][]=[];
 while(offset<body.length){const size=body.readUInt32BE(offset);offset+=4;tokens.push(Array.from(body.subarray(offset,offset+size)));offset+=size;}
 expect(tokens).toEqual(spec.args);
 expect(outputs).toEqual({2:[0,255],3:[7],4:[128]});
 expect(spawn).toHaveBeenCalledWith('/trusted/execve',['/tools/tool','4','5'],expect.objectContaining({shell:false,detached:true,cwd:'/work',env:{VALUE:'literal'},stdio:['pipe','pipe','pipe','pipe','pipe','pipe']}));
 expect(launcher.argvProfile).toMatchObject({kind:'bytes',revision:'posix-execve-v1:'+digest});
});

it('records execve errno independently from helper exit and never sends diagnostics to stderr',async()=>{
 const c=child();const output=vi.fn(async()=>{});
 const launcher=await createByteArgvLauncher(options,{...assets,spawn:(()=>c) as never});
 const run=launcher.launch(spec,{output,async end(){}});
 const record=Buffer.from([82,77,69,49,0,0,0,2]);c.stdio[5]!.write(record.subarray(0,3));c.stdio[5]!.write(record.subarray(3));
 finish(c,127);expect(await run.exit).toMatchObject({kind:'spawnError',stage:'spawn',code:'ENOENT'});await run.settled;
 expect(output).not.toHaveBeenCalled();
});

it.each([new Uint8Array([1]),new Uint8Array(9),new Uint8Array([82,77,69,49,0,0,0,0])])('refuses malformed exec diagnostics as unknown native outcome (%j)',async record=>{
 const c=child();const launcher=await createByteArgvLauncher(options,{...assets,spawn:(()=>c) as never});
 const run=launcher.launch(spec,{async output(){},async end(){}});c.stdio[5]!.write(record);finish(c,0);
 expect(await run.exit).toMatchObject({kind:'unknown'});await expect(run.settled).rejects.toThrow('launch diagnostic');
});

it('checks pinned helper bytes before returning a launcher or invoking native processes',async()=>{
 const spawn=vi.fn();
 await expect(createByteArgvLauncher({...options,helperDigest:'a'.repeat(64)},{...assets,spawn:spawn as never})).rejects.toThrow('digest');
 await expect(createByteArgvLauncher({...options,maxHelperBytes:2},{...assets,spawn:spawn as never})).rejects.toThrow('bound');
 expect(spawn).not.toHaveBeenCalled();
});

it('rejects argv size, NUL and descriptor exhaustion before spawning',async()=>{
 const spawn=vi.fn();const launcher=await createByteArgvLauncher(options,{...assets,spawn:spawn as never});
 for(const input of [{...spec,args:[[0]]},{...spec,maxArgvBytes:1},{...spec,stdio:Array.from({length:1023},()=> 'pipe' as const)}])expect(()=>launcher.launch(input,{async output(){},async end(){}})).toThrow();
 expect(spawn).not.toHaveBeenCalled();
});
