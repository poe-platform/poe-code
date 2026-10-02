import {createRequire} from "node:module";
import {cloneDefaultValue} from "toolcraft-schema-rust";
import {promptForField} from "./cli-prompts.js";
import {setNestedValue} from "./cli-dynamic-argv.js";
import {describeReceived,formatAvailableList} from "./cli-values.js";
import {callNative,protect} from "./host-errors.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){if(depth>=128)throw new RangeError("Maximum call stack size exceeded");depth++;try{return callNative(native.cliVariantsPolicy,operation,args,host);}finally{depth--;}}
const operations={
  undefined:()=>undefined,true:()=>true,false:()=>false,truthy:value=>!!value,
  initialize(params,fields,dynamicFields,resolvedFieldValues,providedDynamicFieldIds,providedFieldIds,shouldPrompt,errors,promptStreams){
    const fieldById=new Map(fields.map(field=>[field.id,field]));
    const dynamicFieldById=new Map(dynamicFields.map(field=>[field.id,field]));
    const activeBranches=new Map();
    return {params,resolvedFieldValues,providedDynamicFieldIds,providedFieldIds,shouldPrompt,errors,promptStreams,fieldById,dynamicFieldById,activeBranches,variant:undefined,selectedBranch:undefined,controlField:undefined,requiredField:undefined};
  },
  variant:(state,variant)=>{state.variant=variant;},
  parentActive:state=>state.activeBranches.get(state.variant.parent.id)===state.variant.parent.branchId,
  selected:state=>state.resolvedFieldValues.get(state.variant.controlFieldId),
  control:state=>state.fieldById.get(state.variant.controlFieldId),
  keepControl:(state,field)=>{state.controlField=field;},prompt:(state,field)=>promptForField(field,state.promptStreams),
  resolved:(state,field,value)=>state.resolvedFieldValues.set(field.id,value),
  provided:(state,field)=>state.providedFieldIds.add(field.id),
  nested:(state,field,value)=>setNestedValue(state.params,field.path,value),
  missingSelector:state=>state.errors.push({path:state.variant.controlDisplayPath,message:`Missing required parameter "${state.variant.controlDisplayPath}".`}),
  findBranch:(variant,selectedBranchId)=>variant.branches.find(branch=>branch.branchId===selectedBranchId),
  invalidSelector:(state,selectedBranchId)=>state.errors.push({path:state.variant.controlDisplayPath,message:`Invalid value for "${state.variant.controlDisplayPath}". Expected one of: ${state.variant.branches.map(branch=>branch.branchId).join(", ")}, got ${describeReceived(selectedBranchId)}.`}),
  keepBranch:(state,branch)=>{state.selectedBranch=branch;},
  invalidBranches(state){let invalid=false;for(const branch of state.variant.branches)if(invoke("invalidBranch",[state,branch]))invalid=true;return invalid;},
  invalidField:(state,branch)=>branch.fieldIds.find(fieldId=>state.providedFieldIds.has(fieldId)),
  invalidDynamic:(state,branch)=>branch.dynamicFieldIds.find(fieldId=>state.providedDynamicFieldIds.has(fieldId)),
  field:(state,id)=>state.fieldById.get(id),dynamic:(state,id)=>state.dynamicFieldById.get(id),
  available:(state,branch)=>[
    ...branch.fieldIds.map(fieldId=>state.fieldById.get(fieldId)).filter(field=>field!==undefined&&field.synthetic!==true).map(field=>field.displayPath),
    ...branch.dynamicFieldIds.map(fieldId=>state.dynamicFieldById.get(fieldId)).filter(field=>field!==undefined).map(field=>field.optionPathDisplay)
  ],
  unknown:(state,field)=>state.errors.push({path:field.displayPath,message:`Unknown parameter "${field.displayPath}" for ${state.variant.controlDisplayPath}="${state.selectedBranch.branchId}". ${formatAvailableList(invoke("available",[state,state.selectedBranch]))}`}),
  active:state=>state.activeBranches.set(state.variant.id,state.selectedBranch.branchId),
  defaults(state){
    for(const fieldId of state.selectedBranch.fieldIds)invoke("default",[state,state.fieldById.get(fieldId),false]);
    for(const fieldId of state.selectedBranch.dynamicFieldIds)invoke("default",[state,state.dynamicFieldById.get(fieldId),true]);
  },
  matches:(field,variant)=>field?.variantId===variant.id,
  existing:(state,field)=>invoke("getNested",[state.params,field.path]),
  clone:field=>cloneDefaultValue(field.defaultValue),
  dynamicDefault:(state,field)=>setNestedValue(state.params,field.path,cloneDefaultValue(field.defaultValue)),
  keepRequired:(state,field)=>{state.requiredField=field;},
  requiredError:(state,field)=>state.errors.push({path:field.displayPath,message:`Missing required parameter "${field.displayPath}" for ${state.variant.controlDisplayPath}="${state.selectedBranch.branchId}". ${formatAvailableList(invoke("available",[state,state.selectedBranch]))}`}),
  requiredDynamic(state){for(const fieldId of state.selectedBranch.requiredDynamicFieldIds)invoke("requiredDynamicField",[state,state.dynamicFieldById.get(fieldId)]);},
  reduce:(target,path)=>path.reduce((current,segment)=>invoke("nestedPart",[current,segment]),target),
  isObject:current=>typeof current==="object",isNull:current=>current===null,
  own:(current,segment)=>Object.prototype.hasOwnProperty.call(current,segment),property:(current,segment)=>current[segment],
  invalidOperation(){throw new TypeError("Invalid CLI variant operation");}
};
const host={operate:protect((name,args)=>name.startsWith("step:")?{kind:name.slice(5),value:args[0]}:operations[name](...args)),get:protect((value,key)=>value[key])};
export async function enforceVariantConstraints(params,fields,dynamicFields,variants,resolvedFieldValues,providedDynamicFieldIds,providedFieldIds,shouldPrompt,errors,promptStreams){
  const state=invoke("initialize",[params,fields,dynamicFields,resolvedFieldValues,providedDynamicFieldIds,providedFieldIds,shouldPrompt,errors,promptStreams]);
  // Host loops retain for-of iterator closing and await only where the reference does.
  for(const variant of variants){
    let step=invoke("variant",[state,variant]);
    if(step.kind==="control")step=invoke("controlResult",[state,await step.value]);
    if(step.kind==="skip")continue;
    for(const fieldId of state.selectedBranch.requiredFieldIds){
      const required=invoke("required",[state,fieldId]);
      if(required.kind==="prompt")invoke("requiredResult",[state,await required.value]);
    }
    invoke("requiredDynamic",[state]);
  }
}
export function getNestedValue(target,path){return invoke("getNested",[target,path]);}
