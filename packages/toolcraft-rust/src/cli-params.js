import {createRequire} from "node:module";
import {cloneDefaultValue,validate as validateSchema} from "toolcraft-schema-rust";
import {select,isCancel} from "toolcraft-design-rust";
import {UserError} from "./index.js";
import {parseDynamicValues,setNestedValue} from "./cli-dynamic-argv.js";
import {parseFieldInputValue,parseOptionFieldValue} from "./cli-consume.js";
import {parseScalarValue,formatMissingParameterMessage} from "./cli-values.js";
import {formatFieldValidationIssue} from "./cli-dynamic-values.js";
import {unwrapOptional} from "./cli-argv.js";
import {loadPresetValues} from "./cli-presets.js";
import {enforceVariantConstraints} from "./cli-variants.js";
import {promptForField,fieldPromptLabel,withPromptStreams,throwPromptCancellation} from "./cli-prompts.js";
import {callNative,protect} from "./host-errors.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
const NULL_OPTION_VALUE=Symbol("toolcraft.cli.null");
let depth=0;
function invoke(operation,args){if(depth>=128)throw new RangeError("Maximum call stack size exceeded");depth++;try{return callNative(native.cliParamsPolicy,operation,args,host);}finally{depth--;}}
const operations={
  undefined:()=>undefined,true:()=>true,false:()=>false,truthy:value=>!!value,isArray:value=>Array.isArray(value),isString:value=>typeof value==="string",nonempty:value=>value.length>0,
  initialize(fields,dynamicFields,positionalValues,optionValues,rawArgv,casing,shouldPrompt,missingParameterContext,promptStreams,parameterDefaults){
    const params={},errors=[];
    const dynamicResults=parseDynamicValues(dynamicFields,rawArgv,casing,errors);
    const positionalTokens=[...positionalValues,...dynamicResults.positionals];
    const explicitRoots=new Set();
    return {fields,dynamicFields,optionValues,shouldPrompt,missingParameterContext,promptStreams,parameterDefaults,params,errors,dynamicResults,positionalTokens,explicitRoots};
  },
  explicitLoops(state){for(const field of state.fields)invoke("explicitField",[state,field]);for(const field of state.dynamicFields)invoke("explicitDynamic",[state,field]);},
  root:field=>field.path[0],singlePath:field=>field.path.length===1,syntheticRoot:field=>field.path[0].slice(0,-"Kind".length),
  explicitOption:(state,field)=>state.optionValues[field.commanderOptionAttribute],
  explicitPosition:(state,field)=>state.positionalTokens[field.positionalIndex],
  addRoot:(state,field)=>state.explicitRoots.add(invoke("fieldRoot",[field])),
  hasDynamic:(state,field)=>state.dynamicResults.values.has(field.id),addDynamicRoot:(state,field)=>state.explicitRoots.add(field.path[0]),
  defaults(state){state.defaultRoots=new Set(Object.keys(state.parameterDefaults).filter(key=>!state.explicitRoots.has(key)));for(const key of state.defaultRoots)state.params[key]=cloneDefaultValue(state.parameterDefaults[key]);},
  positionalFields:state=>state.fields.filter(field=>field.positionalIndex!==undefined),
  variadic:fields=>fields.some(field=>field.variadicPosition===true),tooMany:(state,fields)=>state.positionalTokens.length>fields.length,
  extraArguments(state,fields){throw new UserError(`Unexpected arguments: ${state.positionalTokens.slice(fields.length).map(token=>JSON.stringify(token)).join(", ")}.`);},
  presets:(state,path)=>loadPresetValues(state.fields,state.dynamicFields,path),emptyPresets:()=>({fields:{},dynamic:new Map()}),
  tracking:state=>{state.providedFieldIds=new Set();state.resolvedFieldValues=new Map();},
  defaultRoot:(state,field)=>state.defaultRoots.has(invoke("fieldRoot",[field])),
  reset:state=>{state.value=undefined;state.source=undefined;},
  value:(state,value)=>{state.value=value;},source:(state,source)=>{state.source=source;},
  position:(state,field)=>state.positionalTokens[field.positionalIndex],positions:(state,field)=>state.positionalTokens.slice(field.positionalIndex),
  unwrap:unwrapOptional,
  nonscalar(field){throw new UserError(`Array parameter "${field.displayPath}" must use scalar items.`);},
  positionalItems:(value,schema,field)=>value.map(item=>parseScalarValue(String(item),schema,field.displayPath)),
  positionalValue:(value,field)=>parseFieldInputValue(value,field.schema,field.displayPath),
  ownOption:(state,field,key)=>Object.prototype.hasOwnProperty.call(state.optionValues,field[key]),
  option:(state,field,key)=>state.optionValues[field[key]],normalize:value=>value===NULL_OPTION_VALUE?null:value,
  ownPreset:(state,field)=>Object.prototype.hasOwnProperty.call(state.presetValues.fields,field.optionAttribute),
  preset:(state,field)=>state.presetValues.fields[field.optionAttribute],
  parseOption:(state,field)=>parseOptionFieldValue(field,state.value,state.errors),
  resolveMissing:(state,field)=>field.schema.cli.resolveMissing({...state.missingParameterContext,params:{...state.params}}),
  choices:resolution=>resolution?.choices??[],single:values=>values.length===1,many:values=>values.length>1,
  choice:choices=>choices[0]?.value,
  select:(state,field,resolution,choices)=>select(withPromptStreams({message:invoke("choiceLabel",[resolution,field]),options:choices.map(choice=>({label:choice.label,value:choice.value}))},state.promptStreams)),
  resolutionMessage:resolution=>resolution?.message,label:fieldPromptLabel,isCancel,cancel:throwPromptCancellation,
  validate:(state,field)=>validateSchema(field.schema,state.value),
  missingIssues:(state,field,validation)=>state.errors.push(...validation.issues.map(issue=>({path:field.displayPath,message:issue.message}))),
  prompt:(state,field)=>promptForField(field,state.promptStreams),
  clone:field=>cloneDefaultValue(field.defaultValue),
  missing:(state,field)=>state.errors.push({path:field.displayPath,message:formatMissingParameterMessage(field)}),
  jsonIssues:(state,field,validation)=>state.errors.push(...validation.issues.map(issue=>formatFieldValidationIssue(issue,field.displayPath))),
  resolved:(state,field)=>state.resolvedFieldValues.set(field.id,state.value),provided:(state,field)=>state.providedFieldIds.add(field.id),
  nested:(state,field,value)=>setNestedValue(state.params,field.path,value),
  dynamicDefaultRoot:(state,field)=>state.defaultRoots.has(field.path[0]),
  dynamicValue:(state,field)=>state.dynamicResults.values.get(field.id),
  hasPresetDynamic:(state,field)=>state.presetValues.dynamic.has(field.id),
  presetDynamic:(state,field)=>state.presetValues.dynamic.get(field.id),
  providedDynamic:(state,field)=>state.dynamicResults.providedFieldIds.add(field.id),
  missingDynamic:(state,field)=>state.errors.push({path:field.displayPath,message:`Missing required parameter "${field.displayPath}".`}),
  variants:(state,variants)=>enforceVariantConstraints(state.params,state.fields,state.dynamicFields,variants.filter(variant=>!state.defaultRoots.has(invoke("fieldRoot",[state.fields.find(field=>field.id===variant.controlFieldId)]))),state.resolvedFieldValues,state.dynamicResults.providedFieldIds,state.providedFieldIds,state.shouldPrompt,state.errors,state.promptStreams),
  empty:errors=>errors.length===0,
  singleError(errors){throw new UserError(errors[0]?.message??"Invalid parameters.");},
  multipleErrors(errors){const rendered=errors.slice(0,10).map(error=>`  - ${error.path}: ${error.message}`);const remaining=errors.length-rendered.length;if(remaining>0)rendered.push(`  … and ${remaining} more`);throw new UserError(`${errors.length} parameter errors:\n${rendered.join("\n")}`);},
  invalidOperation(){throw new TypeError("Invalid CLI parameter operation");}
};
const host={operate:protect((name,args)=>name.startsWith("step:")?{kind:name.slice(5),value:args[0]}:operations[name](...args)),get:protect((value,key)=>value[key])};
export async function resolveParams(fields,dynamicFields,variants,positionalValues,optionValues,rawArgv,casing,presetPath,shouldPrompt,missingParameterContext,promptStreams,parameterDefaults={}){
  const state=invoke("initialize",[fields,dynamicFields,positionalValues,optionValues,rawArgv,casing,shouldPrompt,missingParameterContext,promptStreams,parameterDefaults]);
  const preset=invoke("presets",[state,presetPath]);
  state.presetValues=preset.kind==="await"?await preset.value:preset.value;
  invoke("tracking",[state]);
  for(const field of fields){let step=invoke("field",[state,field]);while(step.kind!=="done")step=invoke(step.kind,[state,field,await step.value]);}
  for(const field of dynamicFields)invoke("dynamic",[state,field]);
  await invoke("variants",[state,variants]);
  return invoke("finish",[state]);
}
export function throwValidationErrors(errors){return invoke("validationErrors",[errors]);}
