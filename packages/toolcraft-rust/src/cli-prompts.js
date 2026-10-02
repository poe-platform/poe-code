import {createRequire} from "node:module";
import {select,confirm,promptText,isCancel} from "toolcraft-design-rust";
import {cloneDefaultValue} from "toolcraft-schema-rust";
import {UserError} from "./index.js";
import {parseArrayValue,parseJsonText,parseScalarValue} from "./cli-values.js";
import {callNative,protect} from "./host-errors.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){if(depth>=128)throw new RangeError("Maximum call stack size exceeded");depth++;try{return callNative(native.cliPromptsPolicy,operation,args,host);}finally{depth--;}}
const operations={
  undefined:()=>undefined,null:()=>null,truthy:value=>!!value,isString:value=>typeof value==="string",isArray:value=>Array.isArray(value),
  arrayValue:value=>value.map(item=>String(item)).join(", "),json: value=>JSON.stringify(value),
  label:field=>`<${field.displayPath}>`,string:value=>String(value),
  ownsLabel:(schema,key)=>Object.prototype.hasOwnProperty.call(schema.labels,key),labelValue:(schema,key)=>schema.labels[key],
  copy:options=>({...options}),input:(options,streams)=>({...options,input:streams.input}),output:(options,streams)=>({...options,output:streams.output}),
  cancelled(){throw new UserError("Operation cancelled.");},
  load:schema=>schema.loadOptions(),
  enumOptions:schema=>schema.values.map(value=>({label:invoke("enumLabel",[schema,value]),value})),
  select:(state,options)=>select(invoke("selectionOptions",[state.field,options,state.streams])),
  confirm:state=>confirm(invoke("booleanOptions",[state.field,state.streams])),
  text:state=>promptText(invoke("textOptions",[state.field,state.streams])),
  initialBoolean:field=>Boolean(field.defaultValue),
  selectionOptions:(message,options,initialValue)=>({message,options,initialValue}),
  promptOptions:(message,initialValue)=>({message,initialValue}),
  isCancel,
  missing(field){throw new UserError(`Missing required parameter "${field.displayPath}".`);},
  blank:entered=>entered.trim().length===0,clone:field=>cloneDefaultValue(field.defaultValue),
  array:(entered,field)=>parseArrayValue(entered,field.schema,field.displayPath),
  jsonValue:(entered,field)=>parseJsonText(entered,field.displayPath),
  scalar:(entered,field)=>parseScalarValue(entered,field.schema,field.displayPath),
  invalidOperation(){throw new TypeError("Invalid CLI prompting operation");}
};
const host={
  operate:protect((name,args)=>name.startsWith("step:")?{kind:name.slice(5),value:args[0]}:operations[name](...args)),
  get:protect((value,key)=>value[key])
};
export async function promptForField(field,streams={}){
  const state={field,streams};
  let step=invoke("start",[state]);
  while(step.kind!=="return")step=invoke(step.kind,[state,await step.value]);
  return step.value;
}
export function formatResolvedValue(value){return invoke("format",[value]);}
export function fieldPromptLabel(field){return invoke("label",[field]);}
export function enumOptionLabel(schema,value){return invoke("enumLabel",[schema,value]);}
export function withPromptStreams(options,streams){return invoke("streams",[options,streams]);}
export function throwPromptCancellation(){return invoke("cancel",[]);}
