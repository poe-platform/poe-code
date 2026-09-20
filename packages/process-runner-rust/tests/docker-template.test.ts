import {beforeEach,expect,it,vi}from'vitest';
import{fs}from'memfs';import{Readable}from'node:stream';import{createHash}from'node:crypto';
import{buildDockerRuntimeTemplate}from'../dist/docker-template.js';
vi.mock('../dist/docker-engine.js',()=>({detectEngine:()=> 'docker'}));
vi.mock('../dist/docker-context.js',()=>({detectContext:()=> 'colima',buildContextArgs:(engine:string,context:string)=>engine==='docker'?['--context',context]:[]}));
beforeEach(()=>{fs.mkdirSync('/repo',{recursive:true});fs.writeFileSync('/repo/Dockerfile','FROM scratch');fs.writeFileSync('/repo/main',Buffer.from([0,255]));});
function fixture(inspect=0,build=0){const exec=vi.fn((spec:any)=>({pid:null,stdin:null,stdout:Readable.from(['']),stderr:Readable.from([spec.args.includes('build')?'bad build':'']),kill(){},result:Promise.resolve({exitCode:spec.args.includes('inspect')?inspect:build})}));const get=vi.fn(async()=>undefined as any),put=vi.fn(async()=>{});return{runner:{exec},state:{templates:{get,put}}};}
it('hashes exact ordered bytes and builds a canonical context with locale-sorted arguments',async()=>{
 const{runner,state}=fixture();const result=await buildDockerRuntimeTemplate({cwd:'/repo',runtime:{type:'docker',dockerfile:'Dockerfile',build_args:{Z:'last',A:'1'}},runner,state}as any);
 const hash=createHash('sha256').update('FROM scratch').update('\0docker\0Dockerfile\0FROM scratch\0main\0').update(Buffer.from([0,255])).update('\0A=1\0Z=last\0').digest('hex');
 expect(result).toEqual({backend:'docker',hash,image:'poe-code/local:'+hash,cached:false});expect(runner.exec).toHaveBeenCalledWith({command:'docker',args:['--context','colima','build','--tag',result.image,'-f','/repo/Dockerfile','--build-arg','A=1','--build-arg','Z=last','/repo'],stdout:'pipe',stderr:'pipe'});expect(state.templates.put).toHaveBeenCalledWith('docker',expect.objectContaining({hash,image:result.image,dockerfile_path:'/repo/Dockerfile',runtime_type:'docker',built_at:expect.any(String)}));
});
it('accepts an inspected cached image, forces rebuild and ignores missing images',async()=>{
 for(const [force,code,cached]of[[false,0,true],[true,0,false],[false,1,false]]as const){const{runner,state}=fixture(code);state.templates.get.mockResolvedValue({image:'cached'});const result=await buildDockerRuntimeTemplate({cwd:'/repo',runtime:{type:'docker',dockerfile:'Dockerfile'},runner,state,force}as any);expect(result.cached).toBe(cached);expect(state.templates.get).toHaveBeenCalledTimes(force?0:1);expect(state.templates.put).toHaveBeenCalledTimes(cached?0:1);expect(runner.exec.mock.calls.some(([spec])=>spec.args.includes('inspect'))).toBe(!force);}
});
it('refuses canonical paths outside cwd and does not start a build',async()=>{
 const{runner}=fixture();fs.writeFileSync('/outside','FROM scratch');fs.symlinkSync('/outside','/repo/linked');await expect(buildDockerRuntimeTemplate({cwd:'/repo',runtime:{type:'docker',dockerfile:'linked'},runner}as any)).rejects.toThrow('runtime.dockerfile must remain inside runtime cwd /repo.');expect(runner.exec).not.toHaveBeenCalled();
});
it('filters ignored files from cache hashes and separates engine cache keys',async()=>{
 const{runner}=fixture();fs.writeFileSync('/repo/.dockerignore','ignored');fs.writeFileSync('/repo/ignored','first');const input={cwd:'/repo',runtime:{type:'docker',dockerfile:'Dockerfile'},runner}as any;const a=await buildDockerRuntimeTemplate(input);fs.writeFileSync('/repo/ignored','second');expect((await buildDockerRuntimeTemplate(input)).hash).toBe(a.hash);input.runtime.engine='podman';expect((await buildDockerRuntimeTemplate(input)).hash).not.toBe(a.hash);
});
it('keeps a failed build out of the template cache',async()=>{
 const{runner,state}=fixture(0,7);await expect(buildDockerRuntimeTemplate({cwd:'/repo',runtime:{type:'docker',dockerfile:'Dockerfile'},runner,state}as any)).rejects.toThrow('bad build');expect(state.templates.put).not.toHaveBeenCalled();
});
