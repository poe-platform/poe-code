import {native} from './native.js';
import {graphSnapshot} from './yaml-snapshot.js';
import {setConfigEntry,merge,prune} from './object.js';
export const yamlFormat={
 parse(content){
  const result=native.configYamlParse(content,epoch=>new Date(epoch).toString());
  if(result.error){const error=new Error(result.error.message);error.line=result.error.line;error.column=result.error.column;throw error;}
  const dates=new Map(),symbols=new Map();let dateIndex=0,symbolIndex=0;
  for(let i=0;i<result.temporals.length;i++){
   const[path,epoch,description]=result.temporals[i];let value;
   if(epoch==='symbol'){const id=result.symbolIds[symbolIndex++];if(!symbols.has(id))symbols.set(id,Symbol(description));value=symbols.get(id);}
   else{const id=result.dateIds[dateIndex++];if(!dates.has(id))dates.set(id,new Date(epoch));value=dates.get(id);}
   let parent=result.value;for(let j=0;j<path.length-1;j++)parent=parent[path[j]];setConfigEntry(parent,path.at(-1),value);
  }
  return result.value;
 },
 serialize(value){if(value===undefined)throw new TypeError("Cannot read properties of undefined (reading 'endsWith')");return native.configYamlSerialize(graphSnapshot(value));},
 merge,prune,
};
