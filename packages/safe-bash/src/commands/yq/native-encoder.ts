import type { Node } from "yaml";
import { cloneNode, dereference, inspectNode, type Candidate, type YamlModule } from "./nodes.js";
import { mikeLimits, MikeError, type NativeWork } from "./native-work.js";

export interface EncodeOptions { format: "yaml" | "json"; indent: number; unwrap: boolean; compactSequence: boolean }

export async function encodeNative(candidate: Candidate, options: EncodeOptions, yaml: YamlModule, work: NativeWork): Promise<string> {
  await inspectNode(candidate.node, yaml, work);
  if (options.indent > work.limits.maxOutputBytes) throw new MikeError("yq limit exceeded: maxOutputBytes");
  const spacing = Math.max(0, options.indent);
  const chunks: string[] = [];
  let bytes = 0;
  const append = (text: string) => {
    const incoming = Buffer.byteLength(text);
    if (incoming > work.limits.maxOutputBytes - bytes) throw new MikeError("yq limit exceeded: maxOutputBytes");
    bytes += incoming; chunks.push(text);
  };
  const indent = (depth: number) => {
    const count = spacing * depth;
    if (count > work.limits.maxOutputBytes - bytes) throw new MikeError("yq limit exceeded: maxOutputBytes");
    append(" ".repeat(count));
  };
  const primitive = (node: Node): string => {
    if (!yaml.isScalar(node) || node.value == null) return "null";
    if (typeof node.value === "bigint") return node.value.toString();
    if (typeof node.value === "number" && !Number.isFinite(node.value)) return node.value === Infinity ? ".inf" : node.value === -Infinity ? "-.inf" : ".nan";
    return String(node.value);
  };
  if (options.format === "yaml" && yaml.isScalar(candidate.node) && candidate.node.value === null && (candidate.node.source === "" || candidate.document.filename === "")) {
    return candidate.document.doc.directives?.docStart && candidate.node === candidate.document.doc.contents ? "---\n" : "\n";
  }
  if (options.unwrap && yaml.isScalar(candidate.node)) return `${primitive(candidate.node)}\n`;
  if (options.format === "json") {
    const write = async (current: Candidate, depth: number): Promise<void> => {
      await work.tick(); work.depth(depth);
      const base = dereference(current, yaml, work);
      const node = base.node;
      if (yaml.isScalar(node)) {
        if (typeof node.value === "number" && !Number.isFinite(node.value)) {
          throw new MikeError(`${"json: error calling MarshalJSON for type *yqlib.CandidateNode: ".repeat(depth + 1)}strconv.ParseFloat: parsing ${JSON.stringify(node.source ?? primitive(node))}: invalid syntax`);
        }
        const custom = node.tag && !node.tag.startsWith("tag:yaml.org,2002:") && typeof node.value === "string" && /^(?:true|false|null|[+-]?[0-9]+(?:\.[0-9]+)?)$/u.test(node.value);
        const typed = node.tag === "tag:yaml.org,2002:int" || node.tag === "tag:yaml.org,2002:float" || node.tag === "tag:yaml.org,2002:bool" || node.tag === "tag:yaml.org,2002:null";
        if (typeof node.value === "string" && (custom || typed)) {
          const text = node.value;
          if (/^[+-]?[0-9]+$/u.test(text)) append(BigInt(text).toString());
          else if (/^[+-]?[0-9]+\.[0-9]+$/u.test(text)) append(JSON.stringify(Number(text)));
          else if (["true", "false", "null"].includes(text)) append(text);
          else throw new MikeError(`cannot encode ${node.tag} value as JSON`);
        } else append(typeof node.value === "string" ? JSON.stringify(node.value) : primitive(node));
        return;
      }
      if (yaml.isAlias(node)) throw new MikeError("cyclic YAML alias");
      const map = yaml.isMap(node);
      append(map ? "{" : "[");
      const items = node.items;
      for (let index = 0; index < items.length; index++) {
        if (index) append(",");
        if (spacing) { append("\n"); indent(depth + 1); }
        let child: Node;
        if (map) {
          const pair = node.items[index]!;
          if (!yaml.isScalar(pair.key)) throw new MikeError("cannot encode complex YAML key as JSON");
          append(JSON.stringify(String(pair.key.value))); append(spacing ? ": " : ":"); child = pair.value as Node;
        } else child = items[index] as Node;
        await write({ node: child, document: current.document }, depth + 1);
      }
      if (items.length && spacing) { append("\n"); indent(depth); }
      append(map ? "}" : "]");
    };
    await write(candidate, 0); append("\n"); return chunks.join("");
  }
  if (options.indent < 0) throw new MikeError("indent must not be negative");
  const pending: { node: Node; depth: number }[] = [{ node: candidate.node, depth: 0 }];
  let projected = 0;
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    await work.tick();
    projected += 32 + depth * Math.max(options.indent, 2) + 6 * Buffer.byteLength(node.comment ?? "") + 6 * Buffer.byteLength(node.commentBefore ?? "");
    if (yaml.isScalar(node)) projected += 6 * Buffer.byteLength(String(node.value));
    else if (yaml.isMap(node)) for (const pair of node.items) {
      if (yaml.isScalar(pair.key) && pair.key.value === "<<" && pair.key.type === "PLAIN") pair.key.tag = "tag:yaml.org,2002:merge";
      pending.push({ node: pair.key as Node, depth: depth + 1 }, { node: pair.value as Node, depth: depth + 1 });
    }
    else if (yaml.isSeq(node)) for (const child of node.items) pending.push({ node: child as Node, depth: depth + 1 });
    if (projected > mikeLimits.maxOutputBytes) throw new MikeError("yq limit exceeded: maxOutputBytes");
  }
  work.assertOpen();
  const doc = new yaml.Document<Node>();
  doc.schema.tags = doc.schema.tags.map(tag => {
    if (!tag.stringify) return tag;
    const original = tag.stringify;
    const stringify: NonNullable<import("yaml").ScalarTag["stringify"]> = (item, context, onComment, onChompKeep) => {
      const node: Node = item;
      return yaml.isCollection(node) ? node.toString(context, onComment, onChompKeep) : original(item, context, onComment, onChompKeep);
    };
    return { ...tag, stringify };
  });
  doc.contents = await cloneNode(candidate.node, yaml, work);
  const formatting: Node[] = [doc.contents];
  while (formatting.length) {
    const node = formatting.pop()!;
    await work.tick();
    if (work.implicitTags.has(node) && node.tag?.startsWith("tag:yaml.org,2002:")) delete node.tag;
    if (yaml.isScalar(node) && (node.type === "QUOTE_DOUBLE" || node.type === "QUOTE_SINGLE")) node.value = String(node.value);
    else if (yaml.isMap(node)) for (const pair of node.items) { if (yaml.isNode(pair.key)) formatting.push(pair.key); if (yaml.isNode(pair.value)) formatting.push(pair.value); }
    else if (yaml.isSeq(node)) for (const child of node.items) if (yaml.isNode(child)) formatting.push(child);
  }
  if (candidate.node === candidate.document.doc.contents) {
    doc.commentBefore = candidate.document.doc.commentBefore;
    doc.comment = candidate.document.doc.comment;
  }
  const text = doc.toString({ indent: options.indent === 0 ? 4 : Math.max(2, options.indent), indentSeq: !options.compactSequence, flowCollectionPadding: false, lineWidth: 0, verifyAliasOrder: false });
  append(text);
  return chunks.join("");
}
