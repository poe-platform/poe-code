import type { ParseResult, TemplateLiteral } from "../parse.js";

// Envelope/schema validation runs first. This checks semantic source ownership
// and the canonical immutable template arrays without executing guest code.
export function validateTemplateObjects(heap: Record<string, unknown>, nodes: Iterable<ParseResult>): void {
  const sites = new Map<number, TemplateLiteral>();
  for (const node of nodes) {
    if (node.type === "TaggedTemplateExpression" && node.quasi.nodeId !== undefined)
      sites.set(node.quasi.nodeId, node.quasi);
  }
  const seen = new Set<number>();
  const rawOwners = new Map<unknown, unknown>();
  for (const raw of Object.values(heap)) {
    const entry = raw as { kind: string; templateNodeId?: number; state?: unknown };
    if (entry.kind !== "guest-array" || entry.templateNodeId === undefined) continue;
    const node = sites.get(entry.templateNodeId);
    if (node === undefined || seen.has(entry.templateNodeId)) throw new TypeError("Invalid or duplicate template source identity.");
    seen.add(entry.templateNodeId);
    const cooked = descriptors(entry.state);
    const rawReference = cooked.get("raw")?.value as { kind?: string; id?: number } | undefined;
    const rawArray = rawReference?.kind === "ref" ? heap[String(rawReference.id)] as { kind?: string; state?: unknown } : undefined;
    if (rawArray?.kind !== "guest-array") throw new TypeError("Invalid template raw array.");
    if (rawOwners.has(rawArray) && rawOwners.get(rawArray) !== raw) throw new TypeError("Conflicting template raw identity.");
    rawOwners.set(rawArray, raw);
    checkArray(cooked, node.quasis.map(quasi => quasi.value.cooked), true);
    checkArray(descriptors(rawArray.state), node.quasis.map(quasi => quasi.value.raw), false);
  }
  for (const [raw, owner] of rawOwners) {
    const reference = (raw as { templateOwner?: { id: number } }).templateOwner;
    if (reference === undefined || heap[String(reference.id)] !== owner)
      throw new TypeError("Missing or invalid template owner identity.");
  }
  for (const raw of Object.values(heap)) {
    const entry = raw as { templateOwner?: { id: number } };
    if (entry.templateOwner !== undefined && rawOwners.get(raw) !== heap[String(entry.templateOwner.id)])
      throw new TypeError("Invalid template owner identity.");
  }
}

type Descriptor = { kind: string; value: unknown; configurable: boolean; enumerable: boolean; writable: boolean };
function descriptors(raw: unknown): Map<string, Descriptor> {
  const state = raw as { prototype?: unknown; properties: { extensible: boolean; properties: Array<[string, Descriptor]> } };
  if (Object.hasOwn(state, "prototype") || state.properties.extensible !== false)
    throw new TypeError("Invalid template object state.");
  return new Map(state.properties.properties);
}

function checkArray(properties: Map<string, Descriptor>, values: Array<string | undefined>, cooked: boolean): void {
  if (properties.size !== values.length + (cooked ? 2 : 1)) throw new TypeError("Invalid template property count.");
  const expected = new Map<string, unknown>(values.map((value, index) => [String(index), value]));
  expected.set("length", values.length);
  if (cooked) expected.set("raw", properties.get("raw")?.value);
  for (const [key, value] of expected) {
    const descriptor = properties.get(key);
    const actual = descriptor?.value;
    const equal = value === undefined
      ? actual !== null && typeof actual === "object" && (actual as { kind?: string }).kind === "undefined"
      : actual === value;
    if (descriptor?.kind !== "data" || descriptor.configurable !== false || descriptor.writable !== false ||
        descriptor.enumerable !== (key !== "length" && key !== "raw") || !equal)
      throw new TypeError("Invalid template property descriptor or contents.");
  }
}
