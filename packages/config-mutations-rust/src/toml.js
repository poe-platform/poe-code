import {createRequire} from 'node:module';
import {Buffer} from 'node:buffer';
import {TomlDate} from './temporal.js';
import {setConfigEntry,merge,prune} from './object.js';
const native=createRequire(import.meta.url)('./config-mutations-rust.node');
const depthError='Could not stringify the object: maximum object depth exceeded';
function extendedTypeOf(value){if(typeof value==='object'){if(Array.isArray(value))return 'array';if(value instanceof Date)return 'date';}return typeof value;}
function arrayOfTables(array){for(let i=0;i<array.length;i++)if(extendedTypeOf(array[i])!=='object')return false;return array.length!==0;}
class Snapshot {
 constructor(){this.buffer=Buffer.allocUnsafe(1024);this.offset=0;}
 reserve(length){const end=this.offset+length;if(end>this.buffer.length){const buffer=Buffer.allocUnsafe(Math.max(end,this.buffer.length*2));this.buffer.copy(buffer,0,0,this.offset);this.buffer=buffer;}const start=this.offset;this.offset=end;return start;}
 tag(value){const offset=this.reserve(1);this.buffer[offset]=value;}
 count(value){const offset=this.reserve(4);this.buffer.writeUInt32LE(value,offset);return offset;}
 text(value){this.count(value.length);const offset=this.reserve(value.length*2);this.buffer.write(value,offset,value.length*2,'utf16le');}
 number(value){const offset=this.reserve(8);this.buffer.writeDoubleLE(value,offset);}
 finish(){return this.buffer.subarray(0,this.offset);}
}
function snapshot(value){
 const output=new Snapshot(),active=new WeakSet();
 function guard(depth){if(depth===0)throw new Error(depthError);}
 function enter(value){if(value&&typeof value==='object'){if(active.has(value))throw new Error(depthError);active.add(value);}}
 function leave(value){if(value&&typeof value==='object')active.delete(value);}
 function scalar(value,type,depth){
  guard(depth);if(type==='object')return inline(value,depth);if(type==='array')return array(value,depth);
  if(type==='date'){if(isNaN(value.getTime()))throw new TypeError('cannot serialize invalid date');output.tag(7);output.text(value.toISOString());}
  else if(type==='number'){output.tag(4);output.number(value);}
  else if(type==='bigint'){output.tag(6);output.text(value.toString());}
  else if(type==='undefined')output.tag(1);
  else if(type==='symbol'||type==='function'){output.tag(8);output.text(type);}
  else if(type==='boolean')output.tag(value?3:2);
  else {output.tag(5);output.text(value);}
 }
 function inline(value,depth){
  enter(value);try{const keys=Object.keys(value);output.tag(10);output.count(keys.length);
   for(const key of keys){const entry=value[key],type=extendedTypeOf(value[key]);output.text(key);scalar(entry,type,depth-1);}
  }finally{leave(value);}
 }
 function array(value,depth){
  enter(value);try{output.tag(9);output.count(value.length);
   for(let i=0;i<value.length;i++){if(value[i]===null||value[i]===undefined)throw new TypeError('arrays cannot contain null or undefined values');const entry=value[i],type=extendedTypeOf(value[i]);scalar(entry,type,depth-1);}
  }finally{leave(value);}
 }
 function tables(value,depth){
  guard(depth);enter(value);try{output.tag(9);output.count(value.length);for(let i=0;i<value.length;i++)table(value[i],depth);}finally{leave(value);}
 }
 function table(value,depth){
  guard(depth);enter(value);try{const keys=Object.keys(value);output.tag(10);const count=output.count(0);let properties=0;
   for(const key of keys){
    if(value[key]===null||value[key]===undefined)continue;
    const type=extendedTypeOf(value[key]);if(type==='symbol'||type==='function')throw new TypeError(`cannot serialize values of type '${type}'`);
    output.text(key);if(type==='array'&&arrayOfTables(value[key]))tables(value[key],depth-1);
    else if(type==='object')table(value[key],depth-1);
    else scalar(value[key],type,depth);
    properties++;
   }output.buffer.writeUInt32LE(properties,count);
  }finally{leave(value);}
 }
 table(value,1000);return output.finish();
}
export const tomlFormat={
 parse(content){
  const result=native.configTomlParse(content);
  if(result.error){const error=new Error(result.error.message);error.line=result.error.line;error.column=result.error.column;error.codeblock=result.error.codeblock;throw error;}
  for(const[path,epoch,date,time,offset]of result.temporals){let parent=result.value;for(let i=0;i<path.length-1;i++)parent=parent[path[i]];setConfigEntry(parent,path.at(-1),new TomlDate(epoch,date,time,offset));}
  return result.value;
 },
 serialize(value){if(extendedTypeOf(value)!=='object')throw new TypeError('stringify can only be called with an object');return native.configTomlSerialize(snapshot(value));},
 merge,prune,
};
