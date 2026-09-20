import {EventEmitter}from'node:events';import {PassThrough}from'node:stream';import {spawn}from'node:child_process';import {randomBytes}from'node:crypto';import {existsSync,readFileSync,readdirSync}from'node:fs';import {tmpdir}from'node:os';import {afterEach,expect,it,vi}from'vitest';
import {createDockerRunner as own}from'../dist/docker-runner.js';import {createDockerRunner as sdk}from'../../process-runner/dist/docker/docker-runner.js';
vi.mock('node:child_process',()=>({spawn:vi.fn(),execSync:vi.fn()}));vi.mock('node:crypto',()=>({randomBytes:vi.fn()}));
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();});
function child(){return Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn(),unref:vi.fn()});}
it('settles once, cleans environment files and listeners, and cancels escalation timers',async()=>{
 for(const create of [sdk,own]){
  vi.useFakeTimers();vi.mocked(randomBytes).mockReturnValue(Buffer.from('abcdef','hex'));const process=child();vi.mocked(spawn).mockImplementation(()=>process as never);const controller=new AbortController(),remove=vi.spyOn(controller.signal,'removeEventListener');
  const handle=create({image:'node',engine:'docker',context:'colima'}).exec({command:'cmd😀/é',stdin:'pipe',env:{TOKEN:'opaque'},signal:controller.signal});
  const argv=vi.mocked(spawn).mock.calls.at(-1)![1] as string[],file=argv[argv.indexOf('--env-file')+1]!;expect(readFileSync(file,'utf8')).toBe('TOKEN=opaque\n');expect(argv).toContain('poe-run-cmd----abcdef');expect(argv.join('\0')).not.toContain('opaque');
  controller.abort();await vi.advanceTimersByTimeAsync(10_000);expect(process.kill).toHaveBeenCalledOnce();process.emit('close',0);process.emit('error',new Error('late failure'));await expect(handle.result).resolves.toEqual({exitCode:1});expect(existsSync(file)).toBe(false);expect(remove).toHaveBeenCalledOnce();await vi.advanceTimersByTimeAsync(5_000);expect(process.kill).toHaveBeenCalledOnce();vi.clearAllMocks();vi.useRealTimers();
 }
});
it('contains control transport failures and preserves stream identity with podman',async()=>{
 for(const create of [sdk,own]){vi.mocked(randomBytes).mockReturnValue(Buffer.from('abcdef','hex'));const process=child();vi.mocked(spawn).mockReturnValueOnce(process as never).mockImplementation(()=>{throw new Error('control transport failed');});const handle=create({image:'node',engine:'podman',context:'ignored'}).exec({command:'node'});expect(handle.stdout).toBe(process.stdout);expect(handle.stderr).toBe(process.stderr);expect(()=>handle.kill('SIGINT')).not.toThrow();expect(vi.mocked(spawn).mock.calls.at(-1)).toEqual(['podman',['kill','--signal=SIGINT','poe-run-node-abcdef'],{stdio:'ignore'}]);process.emit('error',new Error('spawn failed'));process.emit('close',0);await expect(handle.result).resolves.toEqual({exitCode:1});vi.clearAllMocks();}
});
it('cleans own environment files on argument validation and synchronous spawn failures',()=>{
 vi.mocked(randomBytes).mockReturnValue(Buffer.from('abcdef','hex'));vi.mocked(spawn).mockImplementation(()=>{throw new Error('spawn failed');});expect(()=>own({image:'node',engine:'docker',context:''}).exec({command:'node',env:{TOKEN:'opaque'}})).toThrow('spawn failed');expect(readdirSync(tmpdir())).toEqual([]);
 expect(()=>own({image:'node',engine:'docker',context:'',ports:[{host:0,container:80}]}).exec({command:'node',env:{TOKEN:'opaque'}})).toThrow('port must be an integer');
 expect(readdirSync(tmpdir())).toEqual([]);
});
