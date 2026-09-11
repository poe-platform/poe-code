/** Internal dictionary storage or a guest mapping protocol adapter. The adapter
 * translates only KeyError to absence; other guest/host failures propagate. It
 * owns protocol-call metering and must preserve present undefined values.
 */
export type NameNamespace<Value> = (ReadonlyMap<string, Value> | {
  lookup(name: string): { readonly value: Value } | undefined;
}) & {/** Original guest object, required only for namespace reflection. */readonly object?:Value};

/** Trusted mutable backing storage. Public exec/global argument validation must
 * still require a Python dictionary, not accept arbitrary guest mappings. */
export type MutableNameNamespace<Value> = (Map<string,Value> | {
  lookup(name:string):{readonly value:Value}|undefined;
  store(name:string,value:Value):void;
  delete(name:string):boolean;
}) & {readonly object?:Value};

export function storeNamespace<Value>(namespace:MutableNameNamespace<Value>,name:string,value:Value):void {
  if("store" in namespace)namespace.store(name,value);
  else namespace.set(name,value);
}

/** Internal dictionary fast path without forcing arbitrary builtin objects into
 * a dictionary. This discriminates trusted host adapters, not guest attributes.
 */
export function lookupNamespace<Value>(namespace: NameNamespace<Value>, name: string): { readonly value: Value } | undefined {
  if ("lookup" in namespace) return namespace.lookup(name);
  return namespace.has(name) ? { value: namespace.get(name)! } : undefined;
}
