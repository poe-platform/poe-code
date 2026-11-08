import path from 'node:path';
const token=/(^|[^A-Za-z0-9_])node[(]17408[)]([^A-Za-z0-9_]|$)/;
const deny=/(^|[^A-Za-z0-9_])(deny|denied|denial)([^A-Za-z0-9_]|$)/i;
export function select(row){
 if(!row||typeof row!=='object')return {matched:false,reason:'SHAPE'};
 const message=typeof row.eventMessage==='string'?row.eventMessage:'';
 const processName=typeof row.process==='string'?row.process:typeof row.processImagePath==='string'?path.posix.basename(row.processImagePath):'';
 if(!['kernel','sandboxd'].includes(processName)&&row.subsystem!=='com.apple.sandbox.reporting')return {matched:false,reason:'REPORTER'};
 if(!token.test(message))return {matched:false,reason:'TOKEN'};
 if(!deny.test(message))return {matched:false,reason:'DENIAL'};
 if(typeof row.timestamp!=='string'||!/(?:Z|[+-][0-9]{2}:?[0-9]{2})$/.test(row.timestamp))return {matched:false,reason:'TIMESTAMP_AMBIGUOUS'};
 const time=Date.parse(row.timestamp.replace(' ','T'));
 if(!Number.isFinite(time)||time<Date.parse('2026-08-29T05:06:21Z')||time>Date.parse('2026-08-29T05:06:28Z'))return {matched:false,reason:'TIME'};
 const match=message.match(/\bdeny(?:[(]([0-9]+)[)])?\s+([a-z][a-z0-9-]*)(?:\s+([^\r\n]+))?/i);
 const operation=match?.[2]??null;const target=match?.[3]?.trim();
 const loaderOperation=operation!==null&&/^(?:file-read-data|file-read-metadata|file-map-executable|mach-lookup|sysctl-read|process-exec)$/.test(operation);
 const loaderPath=target&&(['/usr/lib/','/System/Library/','/System/Volumes/Preboot/Cryptexes/OS/'].some(prefix=>target.startsWith(prefix))||target==='/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node')?target:null;
 return {matched:true,fields:{timestamp:row.timestamp,process:processName,pid:17408,denialOperation:operation,deniedPath:loaderOperation&&loaderPath?loaderPath:(target?'[target withheld: not established loader path]':null),result:match?.[1]===undefined?'denial-record':{denyCode:Number(match[1])}},qualified:loaderOperation?'LOADER_OPERATION':'DENIAL_OPERATION_UNCLASSIFIED'};
}
