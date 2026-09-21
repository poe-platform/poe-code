import {createRequire} from 'node:module';
export const native=createRequire(import.meta.url)('./tiny-http-mcp-oauth-test-server-rust.node');
export function encoded(value){return JSON.stringify(value,(_key,value)=>typeof value==='number'&&!Number.isFinite(value)?{nativeNonFinite:String(value)}:value);}
export function unwrap(text){const result=JSON.parse(text);if(Object.hasOwn(result,'fault'))throw result.fault.name==='TypeError'?new TypeError(result.fault.message):new Error(result.fault.message);return result.value;}
export function urlInfo(value){try{const url=new URL(value);return {href:url.href,protocol:url.protocol,hostname:url.hostname,port:url.port,pathname:url.pathname,search:url.search,hash:url.hash};}catch{return {};}}
