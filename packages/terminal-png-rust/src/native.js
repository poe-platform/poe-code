import {createRequire} from 'node:module';
export const native=createRequire(import.meta.url)('./terminal-png-rust.node');
export function encoded(value){return JSON.stringify(value,(_key,value)=>typeof value==='number'&&!Number.isFinite(value)?{nativeNonFinite:true}:value);}
