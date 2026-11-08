import type { CST, Node } from "yaml";
import type { YamlModule } from "./nodes.js";
import type { NativeWork } from "./native-work.js";

// The YAML library and Mike yq attach block collection headers differently.
// Read the retained CST without changing the nodes used for round-trip output.
export async function recordHeadComments(node: Node, prefix: readonly CST.Token[], input: string | undefined, yaml: YamlModule, work: NativeWork): Promise<void> {
  const normalize = (text: string) => text.split("\n").map(line => line.startsWith("# ") ? line.slice(2) : line).join("\n");
  const comments = async (tokens: readonly CST.Token[]): Promise<string> => {
    const parts: string[] = [];
    let lineStart = true;
    let skipNewline = false;
    for (const token of tokens) {
      { const t = work.tick(); if (t) await t; }
      if (token.type === "comment" && lineStart) parts.push(token.source);
      else if (token.type === "newline") {
        if (parts.length && !skipNewline) parts.push("\n");
        lineStart = true;
        skipNewline = false;
      } else if (token.type === "doc-start" || token.type === "directive") skipNewline = true;
      else if (token.type === "seq-item-ind") lineStart = true;
      else if (token.type !== "space") lineStart = false;
    }
    const text = parts.join("");
    return normalize(text.endsWith("\n") ? text.slice(0, -1) : text);
  };
  // The first document exposes yq's leading-content preprocessing, including
  // directives and original line endings. Later headers follow YAML node rules.
  let head = "";
  if (input !== undefined) {
    const parts: string[] = [];
    let offset = 0;
    let remainder = "";
    while (offset < input.length || remainder) {
      const newline = input.indexOf("\n", offset);
      const end = newline < 0 ? input.length : newline + 1;
      const line = remainder + input.slice(offset, end);
      { const t = work.tick(line.length + 1); if (t) await t; }
      offset = end;
      remainder = "";
      const content = line.endsWith("\r\n") ? line.slice(0, -2) : line.endsWith("\n") ? line.slice(0, -1) : line;
      const trimmed = content.trimStart();
      if (trimmed.trimEnd() === "---") continue;
      if (trimmed.startsWith("---") && (trimmed[3] === " " || trimmed[3] === "\t")) {
        remainder = trimmed.slice(3).trimStart();
        continue;
      }
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("%YAML")) parts.push(line);
      else break;
    }
    const text = parts.join("");
    head = normalize(text.endsWith("\n") ? text.slice(0, -1) : text);
  } else head = await comments(prefix);
  const visit = async (current: Node, leading: string, documentRoot = false): Promise<void> => {
    { const t = work.tick(); if (t) await t; }
    const token = current.srcToken;
    const block = token?.type === "block-map" || token?.type === "block-seq";
    if (leading && (!block || documentRoot)) work.headComments.set(current, leading);
    const inherited = block && !documentRoot ? leading : "";
    const combine = (head: string) => inherited && head ? `${inherited}\n${head}` : inherited || head;
    if (yaml.isMap(current) && (token?.type === "block-map" || token?.type === "flow-collection")) {
      for (let index = 0; index < current.items.length; index++) {
        const pair = current.items[index]!;
        const item = token.items[index];
        if (!item) continue;
        const head = await comments(item.start);
        if (yaml.isNode(pair.key)) await visit(pair.key, index === 0 ? combine(head) : head);
        if (yaml.isNode(pair.value)) await visit(pair.value, await comments(item.sep ?? []));
      }
    } else if (yaml.isSeq(current) && (token?.type === "block-seq" || token?.type === "flow-collection")) {
      for (let index = 0; index < current.items.length; index++) {
        const child = current.items[index];
        const item = token.items[index];
        if (yaml.isNode(child) && item) {
          const head = await comments(item.start);
          await visit(child, index === 0 ? combine(head) : head);
        }
      }
    }
  };
  await visit(node, head, input !== undefined);
}
