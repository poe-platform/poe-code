import type {ExecutionMeter} from "./execution-budget.js";
import type {TypeValue,RuntimeValues} from "./runtime-values.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import {CodePointString} from "./code-point-string.js";

/** Native %T diagnostics use owned module/qualname metadata, not metaclass
 * attribute hooks. Main-module and builtin types omit the module prefix. */
export function runtimeQualifiedTypeName(type:TypeValue,values:RuntimeValues,meter:ExecutionMeter):string {
  const points=runtimeQualifiedTypeNamePoints(type,values,meter);
  let name="";
  for(const point of points){meter.checkpoint(1,point>0xffff?4:2);name+=String.fromCodePoint(point);}
  return name;
}

/** Keep guest module and qualname strings in code-point storage when they
 * become part of a Python value, rather than a host-only diagnostic. */
export function runtimeQualifiedTypeNamePoints(type:TypeValue,values:RuntimeValues,meter:ExecutionMeter):CodePointString {
  meter.checkpoint();
  const module=type.value.namespace.items.lookup(values.string("__module__"))?.value;
  const name=type.value.names.get("__qualname__",values,meter).value;
  const moduleString=module===undefined?undefined:runtimeStringPayload(module);
  if(moduleString===undefined||moduleString.value.compare(values.string("__main__").value,meter)===0||moduleString.value.compare(values.string("builtins").value,meter)===0)return name;
  return moduleString.value.concat(values.string(".").value,meter).concat(name,meter);
}
