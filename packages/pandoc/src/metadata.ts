import type { MetaValue } from "./ast-types.js";
import type { AdapterContext, MetadataObject, MetadataValue } from "./types.js";
import { PandocError } from "./errors.js";
import { visit } from "jsonc-parser";

/** Admit strict JSON token/depth budgets before materializing parsed objects. */
export async function parseMetadataJson(text: string, context: AdapterContext, source?: string): Promise<MetadataObject> {
  for (let offset = 0; offset < text.length; offset += 256) await context.cooperate(256);
  let depth = 0;
  const token = (): void => {context.checkpoint(); context.charge("nodes", 1);};
  const begin = (): void => {token(); context.bound("depth", ++depth);};
  visit(text, {
    onObjectBegin: begin, onArrayBegin: begin,
    onObjectEnd: () => {depth--;}, onArrayEnd: () => {depth--;},
    onObjectProperty: token, onLiteralValue: token,
    onError: (_error, _offset, _length, line, column) => {
      throw new PandocError("E_PARSE", context.operation ?? "convert", "Invalid JSON metadata", "json", `${source ? source + ":" : ""}${line + 1}:${column + 1}`);
    }
  }, {disallowComments: true, allowTrailingComma: false, allowEmptyContent: false});
  return JSON.parse(text) as MetadataObject;
}

/** MetaMaps merge recursively; every other typed node is replaced in its entirety. */
export async function mergeMetadata(left: Readonly<Record<string, MetaValue>>, right: Readonly<Record<string, MetaValue>>, context: AdapterContext): Promise<Record<string, MetaValue>> {
  const result = Object.assign(Object.create(null) as Record<string, MetaValue>, left);
  for (const [key, value] of Object.entries(right)) {
    await context.cooperate();
    const previous = result[key];
    result[key] = previous?.t === "MetaMap" && value.t === "MetaMap"
      ? {t: "MetaMap", c: await mergeMetadata(previous.c, value.c, context)} : value;
  }
  return result;
}

/** JSON numbers have no Pandoc metadata constructor, so preserve their string form. */
export async function mergeJsonMetadata(left: Readonly<Record<string, MetaValue>>, right: MetadataObject, context: AdapterContext, depth = 0): Promise<Record<string, MetaValue>> {
  context.bound("depth", depth);
  if (right === null || typeof right !== "object" || Array.isArray(right)) throw new PandocError("E_OPTION", context.operation ?? "convert", "JSON metadata must be an object");
  const result = Object.assign(Object.create(null) as Record<string, MetaValue>, left);
  const node = async (value: MetadataValue, level: number): Promise<MetaValue> => {
    context.bound("depth", level);
    context.charge("nodes", 1);
    await context.cooperate();
    if (typeof value === "string" || typeof value === "number" && Number.isFinite(value)) return {t: "MetaString", c: String(value)};
    if (typeof value === "boolean") return {t: "MetaBool", c: value};
    if (Array.isArray(value)) {
      const list: MetaValue[] = [];
      for (const child of value) {
        if (child === null) throw new PandocError("E_OPTION", context.operation ?? "convert", "Null metadata list elements are unsupported");
        list.push(await node(child, level + 1));
      }
      return {t: "MetaList", c: list};
    }
    if (value !== null && typeof value === "object") return {t: "MetaMap", c: await mergeJsonMetadata({}, value as MetadataObject, context, level + 1)};
    throw new PandocError("E_OPTION", context.operation ?? "convert", "Invalid JSON metadata value");
  };
  for (const [key, value] of Object.entries(right)) {
    await context.cooperate();
    context.charge("references", 1);
    if (["__proto__", "constructor", "prototype"].includes(key)) throw new PandocError("E_OPTION", context.operation ?? "convert", "Unsafe metadata key");
    if (value === null) {delete result[key]; continue;}
    const old = result[key];
    result[key] = old?.t === "MetaMap" && typeof value === "object" && !Array.isArray(value)
      ? {t: "MetaMap", c: await mergeJsonMetadata(old.c, value as MetadataObject, context, depth + 1)} : await node(value, depth + 1);
  }
  return result;
}
