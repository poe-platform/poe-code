import test from 'node:test';
import assert from 'node:assert/strict';
import {Volume,createFsFromVolume} from 'memfs';
import {loadConfiguredServices,saveConfiguredService,unconfigureService} from '../dist/index.js';
test('service normalization keeps foreign iteration, map and trim hooks',async()=>{
 const fs=createFsFromVolume(Volume.fromJSON({},'/')).promises;
 let iterations=0,maps=0,trims=0;
 const files={*[Symbol.iterator](){iterations++;yield '';yield ' a ';yield ' a ';yield '\ud800';yield 2;}};
 const urls=[' one '];urls.map=function(callback){maps++;return Array.prototype.map.call(this,callback);};
 const trim=String.prototype.trim;
 String.prototype.trim=function(){trims++;return trim.call(this);};
 try{
  await saveConfiguredService({fs,filePath:'/config.json',service:'__proto__',metadata:{provider:'poe',apiShape:'openai-responses',files,model:' m ',shapeBaseUrl:urls}});
 }finally{String.prototype.trim=trim;}
 assert.equal(iterations,1);assert.equal(maps,1);assert.ok(trims>=2);
 const loaded=await loadConfiguredServices({fs,filePath:'/config.json',readOnly:true});
 assert.ok(Object.hasOwn(loaded,'__proto__'));
 assert.deepEqual(loaded.__proto__,{provider:'poe',apiShape:'openai-responses',files:[' a ','\ud800'],model:'m',shapeBaseUrl:['one']});
});
test('layer removal restores the first committed layer if second layer fails',async()=>{
 const contents=JSON.stringify({configured_services:{codex:{provider:'poe',apiShape:'openai-responses',files:['a']}}});
 const volume=Volume.fromJSON({'/global.json':contents,'/project.json':contents},'/'),fs=createFsFromVolume(volume).promises;
 const rename=fs.rename.bind(fs);fs.rename=async(from,to)=>{if(to==='/project.json')throw Error('injected rename failure');return rename(from,to);};
 await assert.rejects(unconfigureService({fs,filePath:'/global.json',projectFilePath:'/project.json',service:'codex'}),/injected rename failure/);
 assert.equal((await loadConfiguredServices({fs,filePath:'/global.json',projectFilePath:'/project.json',readOnly:true})).codex.provider,'poe');
 assert.deepEqual(JSON.parse(await fs.readFile('/global.json','utf8')),JSON.parse(contents));
 assert.ok(!Object.keys(volume.toJSON()).some(file=>file.endsWith('.tmp')));
});
