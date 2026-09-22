/** Node-only build capture. An inventory receipt is evidence of bytes/configuration,
 * not evidence that the native bridge or frontend compatibility is qualified. */
import {createHash} from 'node:crypto';
import type {Build, FrontendContract, Outcome} from '@poe-code/remote-execution/wire';
import {validateWire} from '@poe-code/remote-execution/protocol';
export interface MediaAssetDigest {
  path:string; type:'file'|'symlink'; sha256?:string; target?:string;
}
export interface MediaInventoryRecord {
  query:{executable:string;args:readonly string[]};outcome:Outcome;stdout:string;stderr:string;
}
export interface MediaBuildReceiptInput {
  identity:Omit<Build,'digest'|'executables'|'librariesDigest'|'inventoryDigest'|'assetsDigest'|'policyDigest'|'configDigest'|'inventory'>;
  /** Observed/qualified native contract goes in identity. This is the requested JS
   * contract, kept separate so mismatched inventories remain useful diagnostics. */
  frontendContract:FrontendContract;
  executablePaths:Readonly<Record<string,string>>;
  expectedExecutableDigests:Readonly<Record<string,string>>;
  files:readonly MediaAssetDigest[];
  records:Readonly<Record<'codecs'|'coders'|'delegates'|'fonts'|'policy'|'configure',MediaInventoryRecord>>;
  maxFiles:number;
  /** Combined UTF-8 budget for asset records and native query records. */
  maxRecordBytes:number;
}
function canonical(value:unknown):string {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value && typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}';
  return JSON.stringify(value);
}
function digest(value:unknown):string {return createHash('sha256').update(canonical(value)).digest('hex');}
function validDigest(value:unknown):value is string {return typeof value==='string' && value.length===64 && Array.from(value).every(c=>'0123456789abcdef'.includes(c));}
function losslessText(value:unknown):value is string {
  if(typeof value!=='string')return false;
  for(let i=0;i<value.length;i++){
    const code=value.charCodeAt(i);
    if(code>=0xd800&&code<=0xdbff){const next=value.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))return false;}
    else if(code>=0xdc00&&code<=0xdfff)return false;
  }
  return true;
}
export function createMediaBuildReceipt(input:MediaBuildReceiptInput) {
  for(const bound of [input.maxFiles,input.maxRecordBytes])if(!Number.isSafeInteger(bound)||bound<1)throw new TypeError('Invalid inventory bound');
  const suppliedFiles=input.files;
  if(!Array.isArray(suppliedFiles))throw new TypeError('Invalid inventory asset slots');
  const fileCount=suppliedFiles.length;
  if(fileCount>input.maxFiles)throw new TypeError('Inventory file count bound');
  // Admit all own slots before inspecting records. Neither inherited entries nor
  // a custom iterator can substitute a different set of assets for validation.
  for(let index=0;index<fileCount;index++)if(!Object.hasOwn(suppliedFiles,index))throw new TypeError('Invalid inventory asset slots');
  const admittedFiles:MediaAssetDigest[]=Array.from({length:fileCount},(_,index)=>({...suppliedFiles[index]}));
  const queryNames=['codecs','coders','delegates','fonts','policy','configure'] as const;
  const suppliedRecords=input.records;
  if(!suppliedRecords||Object.keys(suppliedRecords).length!==queryNames.length||queryNames.some(name=>!Object.hasOwn(suppliedRecords,name)))throw new TypeError('Inventory query set must be complete and exact');
  const admittedRecords=Object.fromEntries(queryNames.map(name=>{
    const record={...suppliedRecords[name]};
    const query={...record.query};
    const suppliedArgs=query.args;
    if(!Array.isArray(suppliedArgs)||suppliedArgs.length>input.maxRecordBytes)throw new TypeError('Inventory query argv bound');
    const count=suppliedArgs.length;
    for(let index=0;index<count;index++)if(!Object.hasOwn(suppliedArgs,index))throw new TypeError('Invalid inventory query argv');
    query.args=Array.from({length:count},(_,index)=>suppliedArgs[index]);
    return [name,{...record,query,outcome:{...record.outcome}}];
  })) as MediaBuildReceiptInput['records'];
  if(!input.identity.imageDigest.startsWith('sha256:')||!validDigest(input.identity.imageDigest.slice(7)))throw new TypeError('Container digest must be pinned');
  const paths=new Set<string>();let recordBytes=0;
  for(const file of admittedFiles){
    // Bound primitive text before splitting paths, serializing or cloning records.
    if(typeof file.path!=='string'||file.path.length+(file.target?.length??0)+(file.sha256?.length??0)>input.maxRecordBytes-recordBytes)throw new TypeError('Inventory asset record byte bound');
    if(!losslessText(file.path)||!file.path.startsWith('/')||file.path.includes('\0')||file.path.slice(1).split('/').some(part=>!part||part==='.'||part==='..')||
      (file.type==='file' ? !validDigest(file.sha256)||Object.hasOwn(file,'target') : file.type==='symlink' ? !losslessText(file.target)||!file.target||file.target.includes('\0')||Object.hasOwn(file,'sha256') : true)||
      Object.keys(file).some(key=>!['path','type','sha256','target'].includes(key)))throw new TypeError('Invalid asset identity');
    recordBytes+=Buffer.byteLength(canonical(file));if(recordBytes>input.maxRecordBytes)throw new TypeError('Inventory asset record byte bound');
    if(paths.has(file.path))throw new TypeError('Duplicate asset path');paths.add(file.path);
  }
  // Check text lengths before encoding or cloning the inventory. UTF-8 can only
  // increase these lower bounds, and the exact encoded count is then checked.
  for(const record of Object.values(admittedRecords)){
    if(!Array.isArray(record.query.args)||record.query.args.length>input.maxRecordBytes)throw new TypeError('Inventory query argv bound');
    if(record.stdout.length+record.stderr.length>input.maxRecordBytes-recordBytes)throw new TypeError('Inventory record byte bound');
    if(!losslessText(record.stdout)||!losslessText(record.stderr)||!losslessText(record.query.executable)||!record.query.executable.startsWith('/')||record.query.executable.includes('\0')||!Array.isArray(record.query.args))throw new TypeError('Invalid inventory query record');
    let textBytes=record.stdout.length+record.stderr.length+record.query.executable.length;
    for(const arg of record.query.args){if(!losslessText(arg)||arg.includes('\0'))throw new TypeError('Invalid inventory query argv');textBytes+=arg.length;if(textBytes>input.maxRecordBytes-recordBytes)throw new TypeError('Inventory record byte bound');}
    validateWire('Outcome',record.outcome);
    recordBytes+=Buffer.byteLength(canonical(record));if(recordBytes>input.maxRecordBytes)throw new TypeError('Inventory record byte bound');
  }
  const files=admittedFiles.sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));
  const executables:Record<string,string>={};
  for(const [name,path] of Object.entries(input.executablePaths)){
    const file=files.find(file=>file.path===path && file.type==='file');const expected=input.expectedExecutableDigests[name];
    if(!validDigest(expected)||file?.sha256!==expected)throw new TypeError('Executable digest mismatch: '+name);
    Object.defineProperty(executables,name,{value:expected,enumerable:true});
  }
  if(!Object.keys(executables).length)throw new TypeError('No pinned executables');
  const pinnedPaths=new Set(Object.values(input.executablePaths));
  for(const record of Object.values(admittedRecords))if(!pinnedPaths.has(record.query.executable))throw new TypeError('Inventory query executable is not pinned');
  const records=structuredClone(admittedRecords);
  const configFiles=files.filter(file=>file.path.endsWith('.xml')||file.path.startsWith('/etc/fonts/'));
  const libraries=files.filter(file=>file.path.includes('.so')||file.path.endsWith('.dylib'));
  const inventory={...Object.fromEntries(['codecs','coders','delegates','fonts'].map(name=>[name,records[name as keyof typeof records].stdout.split('\n').filter(Boolean)])) as Pick<Build['inventory'],'codecs'|'coders'|'delegates'|'fonts'>,profiles:files.filter(file=>['.icc','.icm'].includes(file.path.slice(-4).toLowerCase())).map(file=>file.path)};
  const policyDifferences=[...input.identity.policyDifferences];
  if(input.identity.grammarRevision!==input.frontendContract.grammarRevision||input.identity.sourceRevision!==input.frontendContract.sourceRevision)policyDifferences.push('JS frontend/native contract mismatch; this inventory cannot qualify the shipped frontend.');
  for(const [name,record] of Object.entries(records))if(record.outcome.kind!=='exited'||record.outcome.exitCode!==0)policyDifferences.push('Native inventory query failed: '+name);
  const identity={...structuredClone(input.identity),executables,librariesDigest:digest(libraries),inventoryDigest:digest(records),assetsDigest:digest(files),policyDigest:digest({policy:records.policy,files:configFiles}),configDigest:digest({configure:records.configure,files:configFiles}),inventory,policyDifferences};
  const build:Build={digest:digest(identity),...identity};
  validateWire('Build',build);
  return {build,frontendContract:{...input.frontendContract},fileDigests:files,inventoryRecords:records,qualification:[] as string[]};
}
