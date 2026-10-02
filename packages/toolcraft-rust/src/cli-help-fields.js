import {createRequire} from "node:module";
import {formatOptionFlags} from "./cli-fields.js";
import {formatCLIName} from "./cli-policy.js";
import {callNative,protect} from "./host-errors.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){if(depth>=128)throw new RangeError("Maximum call stack size exceeded");depth++;try{return callNative(native.cliHelpFieldsPolicy,operation,args,host);}finally{depth--;}}
const operations={
  undefined:()=>undefined,true:()=>true,false:()=>false,truthy:value=>!!value,zero:value=>value===0,
  list:(...values)=>values,unwrap:schema=>invoke("unwrap",[schema]),
  positional:field=>invoke("positional",[field]),
  positionalText:(field,opening,closing)=>`${opening}${field.displayPath}${closing}`,
  negativeFieldFlag:field=>`--no-${field.optionFlag.slice(2)}`,optionFlags:formatOptionFlags,
  fieldValueFlags:(field,globals)=>`${formatOptionFlags(field,globals)} <${invoke("helpValue",[field.schema,{displayPath:field.displayPath,optionFlag:field.optionFlag}])}>`,
  arrayValue:(schema,field)=>`${invoke("helpValue",[schema,field])}...`,
  datetimePattern:pattern=>pattern.startsWith("^\\d{4}-\\d{2}-\\d{2}T"),
  splitSegments:value=>value.split("."),lastSegment:segments=>segments[segments.length-1],
  longPrefix:optionFlag=>optionFlag.startsWith("--"),stripPrefix:optionFlag=>optionFlag.slice(2),
  nameLower:name=>name.toLowerCase(),suffixLower:suffix=>suffix.toLowerCase(),
  nameEnds:(name,suffix)=>name.endsWith(suffix),
  hyphenSuffix:(lowerName,lowerSuffix)=>lowerName.endsWith(`-${lowerSuffix}`),
  underscoreSuffix:(lowerName,lowerSuffix)=>lowerName.endsWith(`_${lowerSuffix}`),
  findSuffix(candidates,suffixTokens){for(const [suffix,token]of suffixTokens){const selected=invoke("suffixChoice",[candidates,suffix,token]);if(selected.done)return selected.value;}},
  someSuffix:(candidates,suffix)=>candidates.some(candidate=>invoke("matchesSuffix",[candidate,suffix])),
  selected:value=>({done:true,value}),unselected:()=>({done:false}),
  metadataOnly:(_description,metadata)=>metadata.map(entry=>`(${entry})`).join(" "),
  descriptionMetadata:(description,metadata)=>`${description} ${metadata.map(entry=>`(${entry})`).join(" ")}`,
  normalize(value){let normalized="";for(const character of value.trim().toLowerCase())normalized=invoke("normalizeCharacter",[normalized,character]);return normalized;},
  appendCharacter:(normalized,character)=>normalized+character,
  smallEnum:field=>field.schema.values.length<=8,
  enumDescription:field=>field.schema.values.map(value=>String(value)).join(", "),
  shortEnumDescription:values=>values.length<=120,
  pushValues:(metadata,values)=>metadata.push(`values: ${values}`),
  pushRequired:metadata=>metadata.push("required"),
  pushDefault:(metadata,field)=>metadata.push(`default: ${invoke("resolved",[field.defaultValue])}`),
  isArray:value=>Array.isArray(value),isString:value=>typeof value==="string",
  resolvedArray:value=>value.map(item=>String(item)).join(", "),json:value=>JSON.stringify(value),
  fewEnum:schema=>schema.values.length<2,manyEnum:schema=>schema.values.length>3,
  enumTokens:schema=>schema.values.map(value=>String(value)),
  everyCompact:tokens=>tokens.every(token=>invoke("compactToken",[token])),joinCompact:tokens=>tokens.join("|"),
  tokenNonempty:token=>token.length>0,tokenFits:token=>token.length<=24,tokenTrim:token=>token.trim(),tokenIncludes:(token,value)=>token.includes(value),
  fieldFlags:(field,globals)=>invoke("fieldFlags",[field,globals]),
  parameterEnum:(field,globals,enumToken)=>`${formatOptionFlags(field,globals)} ${enumToken}`,
  includesNull:choices=>choices.includes("null"),pushNull:choices=>choices.push("null"),
  dynamicHelpValue:(valueSchema,field)=>invoke("helpValue",[valueSchema,{displayPath:field.optionPathDisplay,optionFlag:field.optionFlag}]),
  fieldOptionText:field=>`${field.optionFlag}`,fieldDisplayText:field=>`${field.optionPathDisplay}`,
  objectRows:(...args)=>invoke("objectRows",args),
  dynamicFlags:field=>`${field.optionFlag} <${invoke("dynamicType",[field])}>`,
  row:(flags,description)=>({flags,flagTokens:invoke("tokenize",[flags]),description}),
  eachDynamic(schema,casing,option,display,metadata,rows){for(const [key,rawChildSchema]of Object.entries(schema.shape))invoke("dynamicChild",[key,rawChildSchema,casing,option,display,metadata,rows]);},
  childOption:(optionPrefix,key,casing)=>`${optionPrefix}.${formatCLIName(key,casing)}`,
  childDisplay:(displayPrefix,key)=>`${displayPrefix}.${key}`,
  pushObjectRows:(rows,...args)=>rows.push(...invoke("objectRows",args)),
  pushArrayRows:(rows,...args)=>rows.push(...invoke("arrayRows",args)),
  pushRecordRow:(rows,...args)=>rows.push(invoke("recordRow",args)),
  pushScalarRow:(rows,...args)=>rows.push(invoke("scalarRow",args)),
  indexSuffix:value=>`${value}.<index>`,
  recordFlags:(childSchema,optionFlag,displayPath)=>`${optionFlag}.<key> <${invoke("dynamicType",[{...{id:displayPath,path:[],displayPath,optionPath:[],optionPathDisplay:`${displayPath}.<key>`,optionFlag:`${optionFlag}.<key>`,optional:false,hasDefault:false,defaultValue:undefined,requiredWhenActive:false,schema:childSchema}}])}>`,
  negativeFlag:optionFlag=>`--no-${optionFlag.slice(2)}`,
  scalarFlags:(childSchema,optionFlag,displayPath)=>`${optionFlag} <${invoke("helpValue",[childSchema,{displayPath,optionFlag}])}>`,
  zeroIndex:()=>0,increment:index=>index+1,more:(flags,index)=>index<flags.length,
  at:(flags,index)=>flags[index],nextAt:(flags,index)=>flags[index+1],
  close:(flags,index)=>flags.indexOf(">",index),minusOne:close=>close===-1,
  startsOption:(flags,index)=>flags.startsWith("--",index),slice:(flags,index,end)=>flags.slice(index,end),
  pushSlice:(tokens,flags,index,end,role)=>tokens.push({text:flags.slice(index,end),role}),
  pushSingle:(tokens,flags,index,role)=>tokens.push({text:flags[index],role}),
  pushTail:(tokens,flags,index,role)=>tokens.push({text:flags.slice(index),role}),
  pushClose:(tokens,flags,index,close,role)=>tokens.push({text:flags.slice(index,close+1),role}),
  pushPiece:(tokens,piece)=>tokens.push(invoke("pieceToken",[piece])),
  piecePipe:piece=>piece.includes("|"),piecePlus:piece=>piece.startsWith("+"),token:(text,role)=>({text,role}),
  invalidOperation(){throw new TypeError("Invalid CLI help-field operation");}
};
const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};
export function formatHelpFieldFlags(field,globalLongOptionFlags){return invoke("fieldFlags",[field,globalLongOptionFlags]);}
export function formatHelpFieldDescription(field){return invoke("fieldDescription",[field]);}
export function formatCommandParameterFieldFlags(field,globalLongOptionFlags){return invoke("parameterFlags",[field,globalLongOptionFlags]);}
export function formatDynamicHelpFields(field,casing){return invoke("dynamicFields",[field,casing]);}
export function describeDynamicFieldType(field){return invoke("dynamicType",[field]);}
export function formatCLIEnumChoices(schema){return invoke("enumChoices",[schema]);}
export function formatJsonHelpSchemaType(schema){return invoke("schemaType",[schema]);}
export function tokenizeHelpFlags(flags){return invoke("tokenize",[flags]);}
