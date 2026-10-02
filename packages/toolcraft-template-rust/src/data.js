import {Buffer} from 'node:buffer';
import {types} from 'node:util';
const ownDescriptors=Object.getOwnPropertyDescriptors,prototype=Object.getPrototypeOf,symbols=Object.getOwnPropertySymbols;
const objectPrototype=Object.prototype,arrayPrototype=Array.prototype,arrayIterator=Array.prototype[Symbol.iterator],objectToString=Object.prototype.toString,objectValueOf=Object.prototype.valueOf,arrayToString=Array.prototype.toString;
const intrinsicString=String,functionToString=Function.prototype.toString;
function nativeFunction(value){return typeof value==='function'&&!types.isProxy(value)&&functionToString.call(value).includes('[native code]');}
const standard=nativeFunction(intrinsicString)&&nativeFunction(objectToString)&&nativeFunction(objectValueOf)&&nativeFunction(arrayToString)&&nativeFunction(arrayIterator);
class Snapshot{
 constructor(){this.buffer=Buffer.allocUnsafe(1024);this.offset=0;}
 reserve(length){const end=this.offset+length;if(end>this.buffer.length){const buffer=Buffer.allocUnsafe(Math.max(end,this.buffer.length*2));this.buffer.copy(buffer,0,0,this.offset);this.buffer=buffer;}const start=this.offset;this.offset=end;return start;}
 tag(value){const offset=this.reserve(1);this.buffer[offset]=value;}
 count(value){const offset=this.reserve(4);this.buffer.writeUInt32LE(value,offset);}
 number(value){const offset=this.reserve(8);this.buffer.writeDoubleLE(value,offset);}
 text(value){this.count(value.length);const length=value.length*2,offset=this.reserve(length);this.buffer.write(value,offset,length,'utf16le');}
}
function plainOptions(options){
 if(types.isProxy(options)||prototype(options)!==objectPrototype)return false;
 const descriptors=ownDescriptors(options);for(const descriptor of Object.values(descriptors))if(!Object.hasOwn(descriptor,'value'))return false;
 const partials=descriptors.partials?.value;if(partials===undefined)return true;
 if(partials===null||types.isProxy(partials)||![null,objectPrototype].includes(prototype(partials)))return false;
 for(const descriptor of Object.values(ownDescriptors(partials)))if(!Object.hasOwn(descriptor,'value')||typeof descriptor.value!=='string')return false;
 return true;
}
export function dataSnapshot(root,options){
 if(!standard||String!==intrinsicString||objectPrototype.toString!==objectToString||objectPrototype.valueOf!==objectValueOf||arrayPrototype.toString!==arrayToString||arrayPrototype[Symbol.iterator]!==arrayIterator||symbols(objectPrototype).length||!plainOptions(options))return null;
 const nodes=[{tag:0}],values=[undefined],sources=new WeakMap(),pending=[];
 function add(value){
  if(value===undefined)return 0;
  if(value!==null&&typeof value==='object'){
   if(sources.has(value))return sources.get(value);
   const id=nodes.length;nodes.push({value});values.push(value);sources.set(value,id);pending.push(id);return id;
  }
  const type=typeof value;if(type==='function'||type==='symbol')return null;
  const id=nodes.length;nodes.push({tag:value===null?1:type==='boolean'?value?3:2:type==='number'?4:type==='string'?5:type==='bigint'?6:null,value});values.push(value);return id;
 }
 const rootId=add(root);if(rootId===null)return null;
 while(pending.length){
  if(nodes.length>16384)return null;
  const id=pending.pop(),node=nodes[id],value=node.value;if(types.isProxy(value)||symbols(value).length)return null;
  const array=Array.isArray(value),parent=prototype(value);
  if(array?parent!==arrayPrototype:parent!==null&&parent!==objectPrototype)return null;
  const descriptors=ownDescriptors(value),names=Object.keys(descriptors);
  if(!array&&names.length>128||array&&value.length>2048)return null;
  node.tag=array?8:7;node.properties=[];const indexes=new Map();
  for(const name of names){const descriptor=descriptors[name];if(!Object.hasOwn(descriptor,'value'))return null;const target=add(descriptor.value);if(target===null)return null;node.properties.push([name,target]);indexes.set(name,target);}
  if(array){node.items=[];for(let i=0;i<descriptors.length.value;i++)node.items.push(indexes.get(String(i))??0);}
 }
 const output=new Snapshot();output.count(rootId);output.count(nodes.length);
 for(const node of nodes){output.tag(node.tag);
  if(node.tag===4)output.number(node.value);else if(node.tag===5)output.text(node.value);else if(node.tag===6)output.text(String(node.value));
  else if(node.tag===7||node.tag===8){output.count(node.properties.length);for(const[name,id]of node.properties){output.text(name);output.count(id);}if(node.tag===8){output.count(node.items.length);for(const id of node.items)output.count(id);}}
 }
 return {buffer:output.buffer.subarray(0,output.offset),values};
}
