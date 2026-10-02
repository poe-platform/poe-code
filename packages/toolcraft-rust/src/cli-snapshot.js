import {createRequire} from "node:module";
import path from "node:path";
import {mergeApprovalsRoot} from "./approval-wiring.js";
import {resolveCLIControls,getGlobalLongOptionFlags,createGlobalSnapshotOptions} from "./cli-policy.js";
import {collectFields,assignPositionals,validateUniqueOptionFlags} from "./cli-fields.js";
import {formatHelpFieldFlags,formatJsonHelpSchemaType,formatCLIEnumChoices,formatDynamicHelpFields,describeDynamicFieldType} from "./cli-help-fields.js";
import {callNative,protect} from "./host-errors.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){
  if(depth>=128)throw new RangeError("Maximum call stack size exceeded");
  depth++;
  try{return callNative(native.cliSnapshotPolicy,operation,args,host);}
  finally{depth--;}
}
const operations={
  true:()=>true,false:()=>false,truthy:value=>!!value,list:(...values)=>values,empty:()=>({}),
  argv:options=>[...(options.argv??["node","toolcraft"])],
  isArray:roots=>Array.isArray(roots),entrypoint:argv=>argv[1],
  isString:entrypoint=>typeof entrypoint==="string",zero:value=>value===0,positive:value=>value>0,
  parse:entrypoint=>path.parse(entrypoint),
  normalized:(name,roots)=>({kind:"group",name,aliases:[],secrets:{},children:roots}),
  merge:mergeApprovalsRoot,controls:resolveCLIControls,globals:getGlobalLongOptionFlags,globalOptions:createGlobalSnapshotOptions,
  snapshot:(globalOptions,root)=>({schemaVersion:1,globalOptions,root}),
  groupChildren:(group,casing,globals,pathSegments)=>group.children
    .filter(child=>invoke("visible",[child,"cli"]))
    .map(child=>invoke("node",[child,casing,globals,[...pathSegments,child.name],group.default===child])),
  visibleChildren:(group,scope)=>group.children.filter(child=>invoke("visible",[child,scope])),
  scope:(node,scope)=>node.scope.includes(scope),
  defaultIncludes:(node,scope)=>node.default.scope.includes(scope),
  defaultVisible:(node,scope)=>Boolean(invoke("defaultScope",[node,scope])),
  aliases:node=>[...node.aliases],groupAliases:group=>[...group.aliases],description:value=>({description:value}),
  group:(name,path,aliases,isDefault,description,children)=>({kind:"group",name,path,aliases,hidden:false,default:isDefault,...description,children}),
  command:(name,path,aliases,hidden,isDefault,description,options)=>({kind:"command",name,path,aliases,hidden,default:isDefault,...description,options}),
  collect:collectFields,assign:assignPositionals,validate:validateUniqueOptionFlags,
  options:(fields,collected,globals,casing)=>[
    ...fields.map(field=>invoke("field",[field,globals])),
    ...collected.dynamicFields.flatMap(field=>invoke("dynamic",[field,casing]))
  ],
  fieldFlags:(field,globals)=>formatHelpFieldFlags(field,globals).split(", "),
  schemaType:formatJsonHelpSchemaType,choices:schema=>({choices:formatCLIEnumChoices(schema)}),
  default:value=>({default:value}),positional:()=>({positional:true}),global:()=>({global:true}),
  field:(name,flags,type,choices,required,description,defaultValue,positional,global)=>({name,flags,type,...choices,required,hidden:false,...description,...defaultValue,...positional,...global}),
  dynamic:(field,casing)=>formatDynamicHelpFields(field,casing).map(row=>invoke("dynamicRow",[field,row])),
  dynamicFlags:row=>[row.flags],dynamicType:describeDynamicFieldType,
  dynamicRow:(name,flags,type,required,description,defaultValue)=>({name,flags,type,required,hidden:false,...description,...defaultValue,dynamic:true}),
  invalidOperation(){throw new TypeError("Invalid CLI snapshot operation");}
};
const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};
export async function createCLICommandTreeSnapshot(roots,options={}){
  return invoke("snapshot",[roots,options]);
}
