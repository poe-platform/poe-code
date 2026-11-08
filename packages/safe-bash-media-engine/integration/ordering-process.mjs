import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,readdir,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);const input=JSON.parse(Buffer.concat(chunks));
const cwd='/scratch/fixture';
await mkdir(cwd,{recursive:true});
for(const [path,value] of Object.entries(input.files)){await mkdir(cwd+'/'+path.split('/').slice(0,-1).join('/'),{recursive:true});await writeFile(cwd+'/'+path,Buffer.from(value.bytes_base64,'base64'));}
await mkdir(cwd+'/home',{recursive:true});await mkdir(cwd+'/tmp',{recursive:true});
const env={PATH:'/usr/bin:/bin',LC_ALL:'C',LANG:'C',TZ:'UTC',MAGICK_THREAD_LIMIT:'1',HOME:cwd+'/home',TMPDIR:cwd+'/tmp',MAGICK_TEMPORARY_PATH:cwd+'/tmp'};
const sha=b=>createHash('sha256').update(b).digest('hex');
async function snapshot(){const out={};async function walk(dir){for(const name of (await readdir(cwd+dir)).sort()){const path=dir+'/'+name;const stat=await lstat(cwd+path);if(stat.isDirectory())await walk(path);else if(stat.isFile()){const b=await readFile(cwd+path);out[path.slice(1)]={size:b.length,sha256:sha(b),bytes_base64:b.toString('base64')};}}}await walk('');return out;}
async function run(argv){return await new Promise(resolve=>{const streams=[[],[]];let error=null,timed_out=false;const child=spawn(argv[0],argv.slice(1),{cwd,env,stdio:['pipe','pipe','pipe'],detached:true});child.stdout.on('data',b=>streams[0].push(b));child.stderr.on('data',b=>streams[1].push(b));child.once('error',e=>error={code:e.code,errno:e.errno,message:e.message});const timeout=setTimeout(()=>{timed_out=true;try{process.kill(-child.pid,'SIGKILL');}catch{/* The process group may already have exited. */}},15000);child.once('close',(exit_code,signal)=>{clearTimeout(timeout);resolve({argv,cwd,environment:env,stdin_base64:'',native_process_started:!error,spawn_error:error,status:{exit_code,signal,timed_out},stdout_base64:Buffer.concat(streams[0]).toString('base64'),stderr_base64:Buffer.concat(streams[1]).toString('base64')});});child.stdin.end();});}
const before=await snapshot();const observed=await run(input.argv);const after=await snapshot();
const effects={};for(const name of new Set([...Object.keys(before),...Object.keys(after)])){effects[name]=!after[name]?'deleted':!before[name]?'created':before[name].sha256===after[name].sha256?'preserved':after[name].size===0?'truncated':'modified';}
const result={...observed,executable_sha256:sha(await readFile(input.argv[0])),files_before:before,files_after:after,effects};
if(after['first.mkv']?.size>30){result.stream_probe=await run(['/opt/ffmpeg/ffprobe','-v','error','-show_entries','stream=codec_type','-of','json','first.mkv']);result.decoded_rgb=await run(['/opt/ffmpeg/ffmpeg','-v','error','-i','first.mkv','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);}
console.log(JSON.stringify(result));
