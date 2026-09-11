import type {ExecutionMeter} from "./execution-budget.js";
import type {TypeValue,RuntimeValues} from "./runtime-values.js";

/** Native %T diagnostics use owned module/qualname metadata, not metaclass
 * attribute hooks. Main-module and builtin types omit the module prefix. */
export function runtimeQualifiedTypeName(type:TypeValue,values:RuntimeValues,meter:ExecutionMeter):string {
  meter.checkpoint();
  const module=type.value.namespace.items.lookup(values.string("__module__"))?.value;
  const name=type.value.names.get("__qualname__",values,meter).value;
  let prefix="",suffix="";
  if(module?.kind==="str")for(const point of module.value){meter.checkpoint(1,point>0xffff?4:2);prefix+=String.fromCodePoint(point);}
  for(const point of name){meter.checkpoint(1,point>0xffff?4:2);suffix+=String.fromCodePoint(point);}
  if(module?.kind!=="str"||prefix==="__main__"||prefix==="builtins")return suffix;
  meter.checkpoint(0,2*(prefix.length+suffix.length+1));return `${prefix}.${suffix}`;
}
