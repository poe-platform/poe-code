import {createRequire} from "node:module";
import {UserError} from "./index.js";
import {formatCLIName} from "./cli-policy.js";
import {callNative,protect} from "./host-errors.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){
  if(depth>=128)throw new RangeError("Maximum call stack size exceeded");
  depth++;
  try{return callNative(native.cliFieldsPolicy,operation,args,host);}
  finally{depth--;}
}
const operations={
  undefined:()=>undefined,true:()=>true,false:()=>false,truthy:value=>!!value,zero:value=>value===0,
  list:(...values)=>values,set:()=>new Set(),map:()=>new Map(),
  collected:()=>({dynamicFields:[],fields:[],variants:[]}),
  eachShape(schema,casing,flags,path,optional,context,collected){for(const [key,rawChildSchema] of Object.entries(schema.shape))invoke("child",[key,rawChildSchema,casing,flags,path,optional,context,collected]);},
  nextPath:(path,key)=>[...path,key],
  unwrap:schema=>invoke("unwrap",[schema]),collect:(...args)=>invoke("collect",args),
  appendCollected(collected,nested){collected.dynamicFields.push(...nested.dynamicFields);collected.fields.push(...nested.fields);collected.variants.push(...nested.variants);},
  display:path=>path.join("."),
  oneOfId:path=>`${path.join(".")}:oneOf`,unionId:path=>`${path.join(".")}:union`,
  branchKeys:childSchema=>Object.keys(childSchema.branches),
  discriminatorPath:(nextPath,childSchema)=>[...nextPath,childSchema.discriminator],
  flag:(path,casing)=>`--${path.map(segment=>formatCLIName(segment,casing)).join(".")}`,
  attribute:(path,casing)=>path.map(segment=>invoke("attributeSegment",[segment,casing])).join("."),
  formatName:formatCLIName,
  attributeWords(formatted){const words=formatted.split("-");return words.map((word,index)=>invoke("attributeWord",[word,index])).join("");},
  capitalize:word=>`${word[0]?.toUpperCase()??""}${word.slice(1)}`,
  commander:(...args)=>invoke("commander",args),
  globalHas:(globalLongOptionFlags,optionFlag)=>globalLongOptionFlags.has(optionFlag),
  fieldGlobalHas:(globalLongOptionFlags,field)=>globalLongOptionFlags.has(field.optionFlag),
  parameterAttribute:optionAttribute=>`param_${optionAttribute}`,
  aliases:childSchema=>[...(childSchema.cliAliases??[])].map(alias=>invoke("alias",[alias])),
  startsLong:alias=>alias.startsWith("--"),longAlias:alias=>`--${alias}`,
  variantId:variantContext=>variantContext?.id,variantBranch:variantContext=>variantContext?.branchId,
  enumSchema:values=>({kind:"enum",values}),
  emptySyntheticEnum(){throw new Error("Synthetic enum schema requires at least one value.");},
  appendControl:(collected,controlField)=>collected.fields.push(controlField),
  appendOneOfVariant:(collected,...args)=>collected.variants.push(invoke("oneOfVariant",args)),
  appendUnionVariant:(collected,...args)=>collected.variants.push(invoke("unionVariant",args)),
  variant:(id,controlDisplayPath,controlFieldId,optional,parent,branches)=>({id,controlDisplayPath,controlFieldId,optional,parent,branches}),
  eachOneOf(childSchema,casing,flags,path,variant,collected,branches){for(const [branchId,branchSchema] of Object.entries(childSchema.branches))invoke("branch",[branchId,branchSchema,casing,flags,path,variant,collected,branches]);},
  unionPath(path){const head=path.slice(0,-1);const tail=path[path.length-1]??"";return [...head,`${tail}Kind`];},
  unionDisplay(path){const head=path.slice(0,-1);const tail=path[path.length-1]??"";return [...head,`${tail}-kind`].join(".");},
  unionIds:(childSchema,casing,seen)=>childSchema.branches.map((branch,index)=>invoke("branchId",[branch,index,casing,seen])),
  fingerprint(branch,casing){const requiredKeys=Object.entries(branch.shape).filter(([,schema])=>invoke("requiredSchema",[schema])).map(([key])=>formatCLIName(key,casing)).sort();return requiredKeys.join("+");},
  seenHas:(seenFingerprints,fingerprint)=>seenFingerprints.has(fingerprint),seenAdd:(seenFingerprints,fingerprint)=>seenFingerprints.add(fingerprint),
  indexedFingerprint:(fingerprint,index)=>`${fingerprint} (branch ${index+1})`,
  eachUnion:(childSchema,casing,flags,path,variant,collected,branches,branchIds)=>childSchema.branches.forEach((branchSchema,index)=>{const branchId=branchIds[index]??"";invoke("branch",[branchId,branchSchema,casing,flags,path,variant,collected,branches]);}),
  context:(id,branchId)=>({id,branchId}),
  appendBranch:(branches,branchId,branch)=>branches.push({branchId,dynamicFieldIds:branch.dynamicFields.map(field=>field.id),fieldIds:branch.fields.map(field=>field.id),requiredDynamicFieldIds:branch.dynamicFields.filter(field=>field.requiredWhenActive).map(field=>field.id),requiredFieldIds:branch.fields.filter(field=>field.requiredWhenActive).map(field=>field.id)}),
  pushField:(collected,...args)=>collected.fields.push(invoke("field",args)),
  pushDynamic:(collected,...args)=>collected.dynamicFields.push(invoke("dynamic",args)),
  suffix:(value,suffix)=>`${value}${suffix}`,
  field:(id,path,displayPath,optionAttribute,commanderOptionAttribute,optionFlag,longAliases,shortFlag,schema,description,optional,hasDefault,defaultValue,requiredWhenActive,global,variantId,variantBranchId)=>({id,path,displayPath,optionAttribute,commanderOptionAttribute,optionFlag,longAliases,shortFlag,schema,description,optional,hasDefault,defaultValue,requiredWhenActive,global,variantId,variantBranchId}),
  dynamic:(id,path,displayPath,optionPathDisplay,optionFlag,description,optional,hasDefault,defaultValue,requiredWhenActive,schema,variantId,variantBranchId)=>({id,path,displayPath,optionPath:path,optionPathDisplay,optionFlag,description,optional,hasDefault,defaultValue,requiredWhenActive,schema,variantId,variantBranchId}),
  oneOfControl:(id,path,displayPath,optionAttribute,commanderOptionAttribute,optionFlag,longAliases,schema,description,optional,requiredWhenActive,variantId,variantBranchId)=>({id,path,displayPath,optionAttribute,commanderOptionAttribute,optionFlag,longAliases,shortFlag:undefined,schema,description,optional,hasDefault:false,defaultValue:undefined,requiredWhenActive,variantId,variantBranchId}),
  unionControl:(id,path,displayPath,optionAttribute,commanderOptionAttribute,optionFlag,longAliases,schema,description,optional,requiredWhenActive,variantId,variantBranchId)=>({id,path,displayPath,optionAttribute,commanderOptionAttribute,optionFlag,longAliases,shortFlag:undefined,schema,description,optional,hasDefault:false,defaultValue:undefined,requiredWhenActive,synthetic:true,variantId,variantBranchId}),
  byPath:fields=>new Map(fields.map(field=>[field.displayPath,field])),
  positionState:()=>({seen:false}),
  eachPositional:(positional,byPath,state)=>positional.forEach((name,index)=>invoke("positional",[name,index,positional,byPath,state])),
  getPath:(byPath,name)=>byPath.get(name),
  lastPosition:(index,positional)=>index===positional.length-1,
  seenVariadic:state=>{state.seen=true;},
  assignIndex:(field,index)=>{field.positionalIndex=index;},assignVariadic:(field,variadic)=>{field.variadicPosition=variadic;},
  missingPositional(name){throw new UserError(`Positional parameter "${name}" does not exist in params.`);},
  arrayNotLast(name){throw new UserError(`Positional array parameter "${name}" must be the last positional.`);},
  afterArray(name){throw new UserError(`Positional parameter "${name}" cannot appear after a positional array.`);},
  eachField(fields,flags,byFlag){for(const field of fields)invoke("validateField",[field,flags,byFlag]);},
  eachFlag(field,flags,byFlag){for(const flag of [field.optionFlag,...field.longAliases])invoke("validateFlag",[flag,field,flags,byFlag]);},
  getFlag:(fieldsByFlag,flag)=>fieldsByFlag.get(flag),setFlag:(fieldsByFlag,flag,field)=>fieldsByFlag.set(flag,field),
  reservedAlias(field,flag){throw new UserError(`Parameter "${field.displayPath}" uses reserved CLI flag "${flag}". Add a short flag or rename the parameter.`);},
  reservedField(field){throw new UserError(`Parameter "${field.displayPath}" uses reserved CLI flag "${field.optionFlag}". Add a short flag or rename the parameter.`);},
  conflictingFlag(existing,field,flag){throw new UserError(`Parameters "${existing.displayPath}" and "${field.displayPath}" use conflicting CLI flag "${flag}".`);},
  shortFlag:field=>`-${field.shortFlag}`,
  longFlags:field=>[field.optionFlag,...field.longAliases].join(", "),
  allFlags:field=>[`-${field.shortFlag}`,field.optionFlag,...field.longAliases].join(", "),
  invalidOperation(){throw new TypeError("Invalid CLI field operation");}
};
const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};
export function collectFields(schema,casing,globalLongOptionFlags,path=[],inheritedOptional=false,variantContext){return invoke("collect",[schema,casing,globalLongOptionFlags,path,inheritedOptional,variantContext]);}
export function assignPositionals(fields,positional){return invoke("assign",[fields,positional]);}
export function validateUniqueOptionFlags(fields,globalLongOptionFlags){return invoke("validate",[fields,globalLongOptionFlags]);}
export function formatOptionFlags(field,globalLongOptionFlags){return invoke("formatFlags",[field,globalLongOptionFlags]);}
