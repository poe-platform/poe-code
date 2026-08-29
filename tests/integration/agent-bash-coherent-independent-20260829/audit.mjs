import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const home=path.dirname(fileURLToPath(import.meta.url));
const output=fs.openSync(path.join(home,'AUDIT.json'),'wx');
const receipt={role:'independent-SOURCE-DATA-only',start:new Date().toISOString(),runtimeSlots:'ALL_UNRUN',productExecutions:0};
const hash=(kind,bytes)=>createHash(kind).update(bytes).digest('hex');
function archive(name,expected){const filename=path.join(home,name),stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8388608)throw Error('archive admission');const compressed=Buffer.from(fs.readFileSync(filename,'utf8').trim(),'base64');if(expected&&hash('sha256',compressed)!==expected)throw Error('archive integrity');const rows=JSON.parse(gunzipSync(compressed,{maxOutputLength:8388608}));for(const row of rows){const body=Buffer.from(row.body,'base64');if(body.length!==row.bytes||hash('sha256',body)!==row.sha256||hash('sha1',Buffer.concat([Buffer.from('blob '+body.length+'\0'),body]))!==row.oid)throw Error('blob integrity');}return rows;}
try{
 const docs=archive('m03-INPUTS.json.gz.base64','2a9e4d4c7dc395b9ea6f8dfd5dfac0143a86b09e93aa3129f3e239c91a071d2c');
 const sources=archive('m04-INPUTS.json.gz.base64','a100c8eb5648a6eee9a33f0d6b090cc48c922c04a17c2fd3e57ce336ca169289');
 const acceptance=archive('m07-INPUTS.json.gz.base64');
 const decode=oid=>JSON.parse(Buffer.from(docs.find(row=>row.oid===oid).body,'base64'));
 const composition=decode('184b174b55433d8ae862d95ff39e09e8635e560b');
 const inventory=decode('0b995d3cb3b461d479aa88d52b6d47ea043f722f');
 const byBlob=new Map(sources.map(row=>[row.oid,row]));
 for(const row of composition.shippingInputPaths){const source=byBlob.get(row.blob);if(!source||source.bytes!==row.bytes||source.sha256!==row.sha256||row.mode!=='100644')throw Error('selected source binding');}
 const baseRow=sources.find(row=>row.spec.endsWith('/SOURCE.json')),base=JSON.parse(Buffer.from(baseRow.body,'base64'));
 if(baseRow.sha256!==composition.base.manifestSha256||base.computedTree!==composition.base.tree)throw Error('base binding');
 const basePaths=new Map(base.inputs.map(row=>[row.path,row]));const differences=composition.shippingInputPaths.filter(row=>basePaths.get(row.path)?.blob!==row.blob).map(row=>({path:row.path,old:basePaths.get(row.path)?.blob??null,selected:row.blob}));
 if(JSON.stringify(differences.map(row=>row.path).sort())!==JSON.stringify(['src/shell/conditional.ts','src/shell/display.ts','src/shell/parser.ts','src/shell/runtime.ts']))throw Error('unexpected source overlay');
 const treeRows=[...decode('b440f05d2d58a9310fb11fc45136696b6deed73a'),...composition.reconstructedTrees];const trees=new Map();
 for(const row of treeRows){const body=Buffer.from(row.base64,'base64');if(hash('sha1',Buffer.concat([Buffer.from('tree '+body.length+'\0'),body]))!==row.oid)throw Error('tree hash');trees.set(row.oid,body);}
 function entries(oid){const body=trees.get(oid);if(!body)throw Error('missing tree witness');const result=[];for(let offset=0;offset<body.length;){const space=body.indexOf(32,offset),nul=body.indexOf(0,space);if(space<0||nul<0||nul+21>body.length)throw Error('tree framing');const mode=body.subarray(offset,space).toString(),name=body.subarray(space+1,nul).toString('utf8'),child=body.subarray(nul+1,nul+21).toString('hex');if(!name||name.includes('/')||name==='..')throw Error('tree name');result.push({mode,name,oid:child});offset=nul+21;}return result;}
 const rootEntries=entries(composition.computedTree),src=rootEntries.find(row=>row.name==='src');const actual=[];
 function walk(oid,prefix){for(const row of entries(oid)){if(row.mode==='40000')walk(row.oid,prefix+row.name+'/');else actual.push({path:prefix+row.name,mode:row.mode,blob:row.oid});}}
 walk(src.oid,'src/');const sort=rows=>rows.toSorted((left,right)=>Buffer.compare(Buffer.from(left.path),Buffer.from(right.path)));
 if(JSON.stringify(sort(actual))!==JSON.stringify(sort(inventory)))throw Error('src tree inventory');
 for(const row of composition.shippingInputPaths.filter(row=>!row.path.startsWith('src/'))){const entry=rootEntries.find(entry=>entry.name===row.path);if(entry?.oid!==row.blob||entry.mode!==row.mode)throw Error('root shipping binding');}
 const selectedPaths=new Map(composition.shippingInputPaths.map(row=>[row.path,row]));
 for(const row of acceptance.filter(row=>row.spec.startsWith('7a5c6200'))){const name=row.spec.slice(41);if(selectedPaths.get(name)?.blob!==row.oid)throw Error('Unit3 origin');}
 const n14=acceptance.find(row=>row.spec.startsWith('7196bace'));if(n14.oid!=='df6b2c0dfad8d7412f93f434d07a20b2b9375a86')throw Error('N14 source');
 const packageRow=byBlob.get(selectedPaths.get('package.json').blob),pkg=JSON.parse(Buffer.from(packageRow.body,'base64'));if(Object.keys(pkg.dependencies??{}).length||pkg.exports['./commands/node'].import!=='./dist/commands/node/index.js')throw Error('package boundary');
 receipt.ok=true;receipt.selectedTree=composition.computedTree;receipt.selectedInputs=composition.shippingInputPaths.length;receipt.selectedInputBytes=composition.shippingInputBytes;receipt.selectedSrcFiles=actual.length;receipt.typescript=actual.filter(row=>row.path.endsWith('.ts')).length;receipt.authenticatedTreeBodies=trees.size;receipt.baseTree=base.computedTree;receipt.baseInputCount=base.inputs.length;receipt.differences=differences;receipt.nodePathsUnchanged=composition.shippingInputPaths.filter(row=>row.path.startsWith('src/commands/node/')).every(row=>basePaths.get(row.path)?.blob===row.blob);receipt.nodePathCount=composition.shippingInputPaths.filter(row=>row.path.startsWith('src/commands/node/')).length;receipt.package={sha256:packageRow.sha256,nodeExport:pkg.exports['./commands/node'],runtimeDependencies:pkg.dependencies??{},files:pkg.files,members:1014,memberStatus:'PREDICTED_NOT_BUILT',packageSha256:null};receipt.pendingN14={source:'7196bace8ea2c141d5ed1020fef5bf721c321ace',runtime:n14.oid,sha256:n14.sha256,bytes:n14.bytes,accepted:false,selected:false};receipt.unit3RootAcceptanceBlob=acceptance.find(row=>row.spec==='2f3617e6a1c889af9ab21d995bdfe501e07b2aa5').sha256;receipt.nonshipping='opaque subtree identities, not full repository materialization';
}catch(error){receipt.error=error.message;process.exitCode=1;}
finally{receipt.end=new Date().toISOString();fs.writeFileSync(output,JSON.stringify(receipt,null,2)+'\n');fs.closeSync(output);}
