import {test}from'node:test';import assert from'node:assert/strict';import {access,readFile,stat}from'node:fs/promises';
import {createByteArgvLauncher}from'./byte-argv-launcher.js';
const lock=JSON.parse(await readFile('/app/container-lock.json','utf8'));
const launcher=await createByteArgvLauncher(lock.byteArgvLauncher);const bytes=s=>Array.from(new TextEncoder().encode(s));
const spec=(executable,args,extra={})=>({executable,args:args.map(bytes),cwd:'/scratch',env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/scratch',LC_ALL:'C'},inputChannels:[1],outputChannels:[2,3],maxFrameBytes:4096,...extra});
async function execute(input){const chunks=new Map([[2,[]],[3,[]],[4,[]]]);const ended=[];
 const run=launcher.launch(input,{async output(channel,chunk){chunks.get(channel).push(chunk.slice());},async end(channel){ended.push(channel);}});try{await run.end(1);}catch{/* Preserve observed spawn/exit; input failure is not an exit code. */}const outcome=await run.exit;await run.settled;return{outcome,chunks,ended};}
test('pinned FFmpeg streams native PCM without protocol logs in stdout',async()=>{
 const result=await execute(spec('/opt/ffmpeg/ffmpeg',['-f','lavfi','-i','sine=frequency=440:sample_rate=8000:duration=0.01','-f','s16le','pipe:1']));assert.deepEqual(result.outcome,{kind:'exited',exitCode:0});assert.equal(Buffer.concat(result.chunks.get(2)).length,160);assert.ok(Buffer.concat(result.chunks.get(3)).length>0);
});
test('one pinned FFmpeg invocation streams two ordered outputs through independent descriptors',async()=>{
 const result=await execute(spec('/opt/ffmpeg/ffmpeg',['-f','lavfi','-i','sine=frequency=440:sample_rate=8000:duration=0.01',
  '-map','0:a','-f','s16le','pipe:1','-map','0:a','-f','s16le','pipe:3'],{outputChannels:[2,3,4]}));
 assert.deepEqual(result.outcome,{kind:'exited',exitCode:0});
 const stdout=Buffer.concat(result.chunks.get(2));const descriptor=Buffer.concat(result.chunks.get(4));
 assert.equal(stdout.length,160);assert.deepEqual(descriptor,stdout);
 assert.ok(Buffer.concat(result.chunks.get(3)).length>0);assert.deepEqual(result.ended.sort(),[2,3,4]);
});
test('ImageMagick retains an earlier multi-output write before a later native error',async()=>{
 const result=await execute(spec('/opt/imagemagick/AppRun',['xc:red','-write','/scratch/early.png','-invalid-poe-option','/scratch/late.png']));assert.equal(result.outcome.kind,'exited');assert.notEqual(result.outcome.exitCode,0);await access('/scratch/early.png');assert.ok(Buffer.concat(result.chunks.get(3)).length>0);
});
test('pinned FFmpeg writes the original non-UTF8 output filename through execve',async()=>{
 const output=Buffer.concat([Buffer.from('/scratch/raw-'),Buffer.from([255]),Buffer.from('.wav')]);
 const input=spec('/opt/ffmpeg/ffmpeg',['-f','lavfi','-i','sine=frequency=440:sample_rate=8000:duration=0.01','-f','wav']);
 input.args.push(Array.from(output));
 const result=await execute(input);assert.deepEqual(result.outcome,{kind:'exited',exitCode:0});assert.ok((await stat(output)).size>160);
});
