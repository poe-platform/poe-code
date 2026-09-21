import { types } from "node:util";
import { Snapshot } from "./snapshot.js";
const descriptors = Object.getOwnPropertyDescriptors,
  keys = Object.keys,
  entries = Object.entries,
  define = Object.defineProperty,
  hasOwn = Object.prototype.hasOwnProperty,
  array = Array.isArray;
interface Field { key: string; value: number; enumerable: boolean; }
interface Node { kind: number; fields: Field[]; }
export function recordSnapshot(
  operation: "normalize" | "scope" | "merge",
  value: unknown,
  override?: unknown
): { buffer: Buffer; references: unknown[]; root: number; override: number } | null {
  if (Object.getOwnPropertyDescriptors !== descriptors || Object.keys !== keys ||
      Object.entries !== entries || Object.defineProperty !== define ||
      Object.prototype.hasOwnProperty !== hasOwn || Array.isArray !== array) return null;
  const references: unknown[] = [undefined], nodes: Node[] = [{ kind: 0, fields: [] }],
    records = new WeakMap<object, number>(), scanned = new Map<number, Set<string>>();
  let invalid = false;
  function intern(value: unknown): number {
    if (value === undefined) return 0;
    if (value !== null && typeof value === "object" && records.has(value)) return records.get(value)!;
    const id = references.length;
    references.push(value); nodes.push({ kind: 1, fields: [] });
    if (value !== null && typeof value === "object") records.set(value, id);
    if (id > 100000) invalid = true;
    return id;
  }
  function record(id: number, level: "root" | "scope" | "runtime", depth: number): void {
    const value = references[id];
    if (value === null || typeof value !== "object" || array(value)) return;
    if (types.isProxy(value) || depth > 512) { invalid = true; return; }
    const contexts=scanned.get(id)??new Set<string>();
    if(contexts.has(level))return;
    contexts.add(level);scanned.set(id,contexts);
    if(nodes[id].kind!==2){
      nodes[id].kind=2;
      for(const [key,descriptor]of entries(descriptors(value))){
        if(!hasOwn.call(descriptor,"value")){invalid=true;return;}
        const child=intern(descriptor.value);
        nodes[id].fields.push({key,value:child,enumerable:descriptor.enumerable===true});
        if(invalid)return;
      }
    }
    for(const field of nodes[id].fields){
      if(level==="root")record(field.value,operation==="merge"&&field.key==="runtime"?"runtime":"scope",depth+1);
      else if(level==="runtime")record(field.value,"runtime",depth+1);
      if(invalid)return;
    }
  }

  const root = intern(value), over = operation === "merge" ? intern(override) : 0;
  // Root Object.keys admission and generic foreign cases stay in the callback path.
  if (operation === "merge" && (value === null || typeof value !== "object" || array(value) ||
      override === null || typeof override !== "object" || array(override))) return null;
  record(root, operation === "scope" ? "scope" : "root", 0);
  if (operation === "merge") record(over, "root", 0);
  if (invalid) return null;
  const output = new Snapshot();
  output.tag(9); output.count(nodes.length);
  for (const node of nodes) {
    output.tag(9); output.count(2); output.tag(4); output.number(node.kind);
    output.tag(9); output.count(node.fields.length);
    for (const field of node.fields) {
      output.tag(9); output.count(3); output.tag(5); output.text(field.key);
      output.tag(4); output.number(field.value); output.tag(field.enumerable ? 3 : 2);
    }
  }
  return { buffer: output.finish(), references, root, override: over };
}
