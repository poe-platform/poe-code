/** Explicit disposable-container inventory. Never imported by the SDK or shell. */
import {createHash}from'node:crypto';import {createReadStream}from'node:fs';import {readdir,readlink,lstat,readFile}from'node:fs/promises';
import {createByteArgvLauncher}from'./byte-argv-launcher.js';
import {createMediaBuildReceipt}from'./build-receipt.js';
import {verifyMediaExecutableAssets}from'./build-assets.js';
import {verifyMediaDeploymentAssets}from'./deployment-assets.js';
import {grammarRevision,nativeReference}from'./options.generated.js';
import {imageMagickGrammarRevision,imageMagickReference}from'./imagemagick.generated.js';
const imageDigest=process.env.REMOTE_MEDIA_IMAGE_DIGEST;if(!imageDigest?.startsWith('sha256:'))throw new Error('Container identity must come from the authenticated runtime owner');
const lock=JSON.parse(await readFile('/app/container-lock.json','utf8'));
await verifyMediaExecutableAssets({executablePaths:lock.executablePaths,expectedExecutableDigests:lock.executables,maxExecutableBytes:lock.maxExecutableBytes});
async function fileDigest(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
const files=[];async function walk(path){let stat;try{stat=await lstat(path);}catch(error){if(error.code==='ENOENT')return;throw error;}
 if(files.length>=100000)throw new Error('Native asset inventory exceeds file count bound');
 if(stat.isSymbolicLink()){files.push({path,type:'symlink',target:await readlink(path)});return;}
 if(stat.isDirectory()){for(const name of(await readdir(path)).sort())await walk(path+'/'+name);return;}
 if(stat.isFile())files.push({path,type:'file',sha256:await fileDigest(path)});
}
for(const path of ['/opt/ffmpeg','/opt/imagemagick','/opt/remote-execution','/app/native-process.js','/app/byte-argv-launcher.js','/usr/lib','/usr/local/bin/node','/usr/share/fonts','/etc/fonts'])await walk(path);
const launcher=await createByteArgvLauncher(lock.byteArgvLauncher);const queries={
 codecs:{executable:'/opt/ffmpeg/ffmpeg',args:['-codecs']},
 coders:{executable:'/opt/imagemagick/AppRun',args:['-list','coder']},
 delegates:{executable:'/opt/imagemagick/AppRun',args:['-list','delegate']},
 fonts:{executable:'/opt/imagemagick/AppRun',args:['-list','font']},
 policy:{executable:'/opt/imagemagick/AppRun',args:['-list','policy']},
 configure:{executable:'/opt/imagemagick/AppRun',args:['-list','configure']},
};
const records={};for(const [name,query]of Object.entries(queries)){
 const outputs={2:[],3:[]};let size=0;const run=launcher.launch({...query,args:query.args.map(s=>Array.from(new TextEncoder().encode(s))),cwd:'/scratch',env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/scratch',LC_ALL:'C'},inputChannels:[],outputChannels:[2,3],maxFrameBytes:65536},{async output(channel,bytes){size+=bytes.length;if(size>16777216)throw new Error('Native inventory exceeds bound');outputs[channel].push(bytes.slice());},async end(){}});
 const outcome=await run.exit;await run.settled;records[name]={query,outcome,stdout:Buffer.concat(outputs[2]).toString('utf8'),stderr:Buffer.concat(outputs[3]).toString('utf8')};
}
const inventoryInput={
 identity:{imageDigest,os:process.platform,architecture:process.arch==='x64'?'x86_64':process.arch,
  // The pinned container uses FFmpeg 9.0; the shipped frontend was derived from
  // 9.0.1. Keep observed native identity separate; never relabel it as matching JS.
  grammarRevision:'ffmpeg-9.0+imagemagick-7.1.2-31-unqualified',sourceRevision:'container-lock-v1',launcherRevision:launcher.argvProfile.revision,bridgeRevision:'unqualified',runtimeRequirements:[],runtimeEnvironment:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/scratch',LC_ALL:'C'},
  policyDifferences:['Container networking and devices explicitly denied.','All filesystem accesses are container-native; canonical live mediation is NOT qualified.','Configured delegates are inventoried; delegate execution and external dependencies are NOT qualified.','Fonts/profiles reflect packaged runtime assets; external host assets are absent.','Raw byte argv uses the pinned POSIX execve helper; canonical byte-path mapping is NOT qualified.']},
 frontendContract:{grammarRevision:[grammarRevision,imageMagickGrammarRevision].join('+'),sourceRevision:[nativeReference.id,imageMagickReference.id].join('+')},
 executablePaths:lock.executablePaths,
 expectedExecutableDigests:lock.executables,
 files,records,maxFiles:100000,maxRecordBytes:16777216,
};
const receipt=createMediaBuildReceipt(inventoryInput);
await verifyMediaDeploymentAssets({build:receipt.build,inventory:inventoryInput,maxAssetBytes:lock.maxExecutableBytes});
console.log(JSON.stringify(receipt,null,2));
