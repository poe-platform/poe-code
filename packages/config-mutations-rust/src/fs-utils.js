import {native} from './native.js';
export function isNotFound(error){return typeof error==='object'&&error!==null&&Object.prototype.hasOwnProperty.call(error,'code')&&error.code==='ENOENT';}
export async function readFileIfExists(fs,target){try{return await fs.readFile(target,'utf8');}catch(error){if(isNotFound(error))return null;throw error;}}
export async function pathExists(fs,target){try{await fs.stat(target);return true;}catch(error){if(isNotFound(error))return false;throw error;}}
export function createTimestamp(){return native.configSafeTimestamp(new Date().toISOString());}
