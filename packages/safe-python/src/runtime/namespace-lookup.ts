/** Internal dictionary storage or a guest mapping protocol adapter. The adapter
 * translates only KeyError to absence; other guest/host failures propagate. It
 * owns protocol-call metering and must preserve present undefined values.
 */
export type NameNamespace<Value> = ReadonlyMap<string, Value> | {
  lookup(name: string): { readonly value: Value } | undefined;
};

/** Internal dictionary fast path without forcing arbitrary builtin objects into
 * a dictionary. This discriminates trusted host adapters, not guest attributes.
 */
export function lookupNamespace<Value>(namespace: NameNamespace<Value>, name: string): { readonly value: Value } | undefined {
  if ("lookup" in namespace) return namespace.lookup(name);
  return namespace.has(name) ? { value: namespace.get(name)! } : undefined;
}
