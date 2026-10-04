import type {IntegerTable} from "safe-bash-io-engine/storage";
import type {BackedJson} from "./backed-json.js";
import type {backedJsonOrder} from "./backed-json-order.js";
import type {ExecutionContext} from "./execution.js";
import {readJsonNumber, JsonNumberError} from "./json-number.js";
import {PandocError} from "./errors.js";
import {retainedPath, retainedValues} from "./retained-wire.js";

export interface RetainedAstUsage {nodes: number; text: number}

const wireEnums = new Set(["AlignDefault", "AlignLeft", "AlignRight", "AlignCenter", "SingleQuote", "DoubleQuote", "InlineMath", "DisplayMath", "AuthorInText", "SuppressAuthor", "NormalCitation", "DefaultStyle", "Example", "Decimal", "LowerRoman", "UpperRoman", "LowerAlpha", "UpperAlpha", "DefaultDelim", "Period", "OneParen", "TwoParens"]);

/** Reserve normalized nodes, attributes and cell spans without collecting the AST.
 * When translation positions are supplied, also perform the scalar checks that
 * precede schema validation in the buffered normalizer. */
export async function reserveRetainedAstBudgets(tree: BackedJson, order: Awaited<ReturnType<typeof backedJsonOrder>>, context: ExecutionContext, enums?: IntegerTable, aggregate = false): Promise<RetainedAstUsage> {
  if (!Number.isFinite(context.limits.tableCells) && !Number.isFinite(context.limits.attributes) && !Number.isFinite(context.limits.depth) && !Number.isFinite(context.limits.nodes) && !Number.isFinite(context.limits.text) && !Number.isFinite(context.limits.references)) return {nodes: 0, text: 0};
  let cells = 0, references = 0, attributes = 0, nodes = 0, text = 0;
  const fail = async (position: number, message: string, code: "E_AST" | "E_LIMIT" = "E_AST"): Promise<never> => {
    const path = await retainedPath(tree, position);
    throw new PandocError(code, "convert", `${path}: ${message}`, undefined, path);
  };
  const nodeBudget = async (position: number, count = 1, reserve = true, suffix = ""): Promise<void> => {
    const next = nodes + count;
    if (!Number.isSafeInteger(next) || next > context.limits.nodes) {
      const path = await retainedPath(tree, position) + suffix;
      throw new PandocError("E_LIMIT", "convert", `${path}: AST budget exceeded`, undefined, path);
    }
    if (reserve) {nodes = next; if (!aggregate) context.charge("nodes", count);}
  };
  const textBudget = async (position: number, units: number): Promise<void> => {
    text += units;
    if (!Number.isSafeInteger(text) || text > context.limits.text) await fail(position, "AST budget exceeded", "E_LIMIT");
    if (!aggregate) context.charge("text", units);
  };
  const string = async (position: number, location = position): Promise<void> => {
    let high = false;
    for await (const chunk of tree.scalarChunks(position)) for (let i = 0; i < chunk.length; i++) {
      const code = chunk.charCodeAt(i);
      if (high) {if (code < 0xdc00 || code > 0xdfff) await fail(location, "Invalid Unicode"); high = false;}
      else if (code >= 0xd800 && code <= 0xdbff) high = true;
      else if (code >= 0xdc00 && code <= 0xdfff) await fail(location, "Invalid Unicode");
    }
    if (high) await fail(location, "Invalid Unicode");
  };
  const translated = async (position: number): Promise<number> => {
    if (enums) return Number(await enums.get(BigInt(position)) ?? 0n);
    // Already schema-validated generations have enum constructors only at their
    // contextual positions. Collapse these for normalized depth accounting.
    const header = await tree.describe(position);
    if (header.kind !== "object" || header.children !== 2) return 0;
    const tag = await tree.property(position, "t");
    if (tag === undefined) return 0;
    const name = await tree.smallText(tag, 32);
    return wireEnums.has(name ?? "") ? tag : 0;
  };
  await nodeBudget(tree.rootPosition);
  if (context.limits.depth < 1) await fail(tree.rootPosition, "AST budget exceeded", "E_LIMIT");
  const roots = [(await tree.property(tree.rootPosition, "blocks"))!, (await tree.property(tree.rootPosition, "meta"))!];
  for (const [index, root] of roots.entries()) {
    await nodeBudget(tree.rootPosition);
    await textBudget(tree.rootPosition, index ? 8 : 6); // blocks/metadata property name
    for await (const {position: node, exit, key, depth} of retainedValues(tree, order, root, async position => !!await translated(position))) {
      if (exit) continue;
      await context.cooperate();
      const header = await tree.describe(node), enumPosition = await translated(node);
      if (depth + 1 > context.limits.depth) await fail(key ? header.parent : node, "AST budget exceeded", "E_LIMIT");
      if (key) {
        await nodeBudget(header.parent);
        await textBudget(header.parent, ((await tree.describe(key)).end - key - 32) / 2);
      }
      if (enums && key) {
        await string(key, header.parent);
        if (["__proto__", "constructor", "prototype"].includes(await tree.smallText(key, 11) ?? "")) await fail(node, "Invalid shape");
      }
      await nodeBudget(node);
      if (enumPosition || header.kind === "string") {
        const position = enumPosition || node;
        await textBudget(node, ((await tree.describe(position)).end - position - 32) / 2);
      }
      if (enums && (enumPosition || header.kind === "string")) await string(enumPosition || node, node);
      if (header.kind === "array" && !enumPosition) await nodeBudget(node, header.children, false);
      if (header.kind === "array" && header.children === 3 && Number.isFinite(context.limits.attributes)) {
        const first = await tree.describe(node + 32), second = await tree.describe(first.end), third = await tree.describe(second.end);
        if ((first.kind === "string" || !!await enums?.get(BigInt(node + 32))) && second.kind === "array" && third.kind === "array") {
          const count = 1 + second.children + third.children;
          attributes += count;
          if (!Number.isSafeInteger(attributes) || attributes > context.limits.attributes) await fail(node, "AST budget exceeded", "E_LIMIT");
          if (!aggregate) context.charge("attributes", count);
        }
      }
      if (header.kind !== "array" || header.children !== 5) continue;
      const first = await tree.describe(node + 32), second = await tree.describe(first.end);
      const tag = second.kind === "object" ? await tree.property(first.end, "t") : undefined;
      const isString = enums ? second.kind === "string" || !!await enums.get(BigInt(first.end))
        : tag !== undefined && ["AlignDefault", "AlignLeft", "AlignRight", "AlignCenter"].includes(await tree.smallText(tag, 16) ?? "");
      if (first.kind !== "array" || !isString) continue;
      const row = second.end, column = (await tree.describe(row)).end;
      const spanNumber = async (position: number): Promise<number> => {
        if ((await tree.describe(position)).kind !== "literal") return fail(node, "Invalid spans");
        try {
          const value = await readJsonNumber(tree.scalarChunks(position), units => context.cooperate(units));
          if (!Number.isSafeInteger(value) || value < 1) return fail(node, "Invalid spans");
          return value;
        } catch (error) {if (error instanceof JsonNumberError) return fail(node, "Invalid spans"); throw error;}
      };
      const span = await spanNumber(row) * await spanNumber(column);
      cells += span;
      if (!Number.isSafeInteger(cells) || cells > context.limits.tableCells) await fail(node, "AST budget exceeded", "E_LIMIT");
      if (!aggregate) context.charge("tableCells", span);
      references += span;
      if (!Number.isSafeInteger(references) || references > context.limits.references) await fail(node, "AST budget exceeded", "E_LIMIT");
      if (!aggregate) context.charge("references", span);
    }
  }
  await nodeBudget(tree.rootPosition); // resources property name
  await textBudget(tree.rootPosition, 9);
  await nodeBudget(tree.rootPosition, 1, true, ".resources"); // resource entries are reserved by their owner
  return {nodes, text};
}
