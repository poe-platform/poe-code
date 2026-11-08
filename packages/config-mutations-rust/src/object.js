// Host property operations retain Date, array holes and unvisited replacement
// identities. These values cannot safely travel through owned JSON.
export function isConfigObject(value){return typeof value==='object'&&value!==null&&!Array.isArray(value)&&!(value instanceof Date);}
export function setConfigEntry(target,key,value){Object.defineProperty(target,key,{configurable:true,enumerable:true,writable:true,value});}
export function hasConfigEntry(target,key){return Object.prototype.hasOwnProperty.call(target,key);}
function cloneValue(value){if(Array.isArray(value))return value.map(cloneValue);if(isConfigObject(value))return cloneConfigObject(value);return value;}
export function cloneConfigObject(value){const result={};for(const[key,entry]of Object.entries(value))setConfigEntry(result,key,cloneValue(entry));return result;}
export function merge(base,patch){const result=cloneConfigObject(base);for(const[key,value]of Object.entries(patch)){if(value===undefined)continue;const existing=hasConfigEntry(result,key)?result[key]:undefined;setConfigEntry(result,key,isConfigObject(existing)&&isConfigObject(value)?merge(existing,value):value);}return result;}
export function prune(obj,shape){let changed=false;const result=cloneConfigObject(obj);for(const[key,pattern]of Object.entries(shape)){
 if(!hasConfigEntry(result,key))continue;const current=result[key];
 if(isConfigObject(pattern)){
  if(Object.keys(pattern).length===0){delete result[key];changed=true;continue;}
  if(isConfigObject(current)){const child=prune(current,pattern);changed ||= child.changed;if(Object.keys(child.result).length===0)delete result[key];else setConfigEntry(result,key,child.result);}continue;
 }
 delete result[key];changed=true;
}return {changed,result};}

export function mergeWithPruneByPrefix(base,patch,pruneByPrefix){
 const result=cloneConfigObject(base),prefixMap=pruneByPrefix??{};
 for(const[key,value]of Object.entries(patch)){
  if(value===undefined)continue;
  const current=result[key],prefix=prefixMap[key];
  if(isConfigObject(current)&&isConfigObject(value)){
   if(prefix){const pruned={};for(const[name,entry]of Object.entries(current))if(!name.startsWith(prefix))setConfigEntry(pruned,name,entry);const merged=cloneConfigObject(pruned);for(const[name,entry]of Object.entries(value))if(entry!==undefined)setConfigEntry(merged,name,entry);setConfigEntry(result,key,merged);}
   else setConfigEntry(result,key,mergeWithPruneByPrefix(current,value,prefixMap));
  }else setConfigEntry(result,key,value);
 }
 return result;
}
