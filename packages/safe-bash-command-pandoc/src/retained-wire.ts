import {IntegerTable, type PagedStorage} from "safe-bash-io-engine/storage";
import type {BackedJson} from "./backed-json.js";
import type {backedJsonOrder} from "./backed-json-order.js";
import type {ExecutionContext} from "./execution.js";
import {PandocError} from "./errors.js";

type Order = Awaited<ReturnType<typeof backedJsonOrder>>;

/** Construct diagnostic paths only on failure. */
export async function retainedPath(tree: BackedJson, position: number, metadataOnly = false, normalized = true): Promise<string> {
  let path = "";
  while (position !== tree.rootPosition) {
    const parent = (await tree.describe(position)).parent, header = await tree.describe(parent);
    let index = 0;
    for await (const child of tree.children(parent)) {
      if (header.kind === "object") {
        const item = await tree.describe(child);
        if (item.kind !== "key" || child !== position && item.end !== position) continue;
        let key = ""; for await (const chunk of tree.scalarChunks(child)) key += chunk;
        if (normalized && !metadataOnly && parent === tree.rootPosition && key === "meta") key = "metadata";
        path = "." + key + path; break;
      }
      if (child === position) {path = `[${index}]` + path; break;}
      index++;
    }
    position = parent;
  }
  return (metadataOnly ? "$.metadata" : "$") + path;
}

/** Visit values in JS property order, using tape parent links rather than a
 * resident depth-dependent stack. Exit events support contextual translation. */
export async function* retainedValues(tree: BackedJson, order: Order, root: number, scalar?: (position: number) => Promise<boolean>): AsyncGenerator<{position: number; exit: boolean; key: number}> {
  let position = root, exit = false, key = 0;
  while (position) {
    const header = await tree.describe(position);
    yield {position, exit, key};
    key = 0;
    if (!exit && header.children && !await scalar?.(position)) {
      key = header.kind === "object" ? await order.first(position) : 0;
      position = key ? (await tree.describe(key)).end : position + 32;
      continue;
    }
    if (!exit) {exit = true; continue;}
    if (position === root) break;
    const parent = await tree.describe(header.parent);
    const next = parent.kind === "object" ? await order.next(position, header.parent) : header.end < parent.end ? header.end : 0;
    if (next) {key = parent.kind === "object" ? next : 0; position = key ? (await tree.describe(key)).end : next; exit = false;}
    else {position = header.parent; exit = true;}
  }
}

/** Match jsonReader's contextual translation checks before normalization. The
 * enum index records only translated positions, including unknown enum names. */
export async function validateRetainedWire(tree: BackedJson, order: Order, scratch: PagedStorage, context: ExecutionContext): Promise<IntegerTable> {
  const enums = new IntegerTable(scratch, 64);
  const fail = async (position: number, message: string, suffix = ""): Promise<never> => {
    throw new PandocError("E_AST", "read", message, "json", await retainedPath(tree, position, false, false) + suffix);
  };
  const shape = async (position: number, kind: "object" | "array", length?: number): Promise<void> => {
    const header = await tree.describe(position);
    if (header.kind !== kind || length !== undefined && header.children !== length)
      await fail(position, length === undefined ? `Expected ${kind}` : "Invalid tuple arity");
  };
  const element = async (position: number, index: number): Promise<number> => {
    let child = position + 32;
    for (let i = 0; i < index; i++) child = (await tree.describe(child)).end;
    return child;
  };
  const enumeration = async (position: number): Promise<void> => {
    await shape(position, "object");
    const tag = await tree.property(position, "t");
    if ((await tree.describe(position)).children !== 2 || tag === undefined || (await tree.describe(tag)).kind !== "string") await fail(position, "Invalid enum arity");
    await enums.set(BigInt(position), BigInt(tag!));
  };
  await shape(tree.rootPosition, "object");
  const blocks = await tree.property(tree.rootPosition, "blocks"), meta = await tree.property(tree.rootPosition, "meta"), version = await tree.property(tree.rootPosition, "pandoc-api-version");
  if ((await tree.describe(tree.rootPosition)).children !== 6 || blocks === undefined || meta === undefined) await fail(tree.rootPosition, "Expected pandoc-api-version, meta and blocks only");
  if (version === undefined) await fail(tree.rootPosition, "Invalid tuple arity", ".pandoc-api-version");
  await shape(version!, "array", 4);
  for (let i = 0; i < 4; i++) {
    const part = await element(version!, i);
    if ((await tree.describe(part)).kind !== "literal" || await order.literal(part) !== String([1, 23, 1, 2][i])) await fail(version!, "Unsupported API version; expected [1,23,1,2]");
  }
  const rows = async (position: number): Promise<void> => {
    await shape(position, "array");
    for await (const row of tree.children(position)) {
      await shape(row, "array", 2);
      const cells = await element(row, 1); await shape(cells, "array");
      for await (const cell of tree.children(cells)) {await shape(cell, "array", 5); await enumeration(await element(cell, 1));}
    }
  };
  for (const root of [blocks!, meta!]) for await (const {position, exit} of retainedValues(tree, order, root)) {
    await context.cooperate();
    if (!exit || (await tree.describe(position)).kind !== "object") continue;
    const tagPosition = await tree.property(position, "t");
    const tag = tagPosition === undefined ? undefined : await tree.smallText(tagPosition, 16);
    if (!["Quoted", "Math", "Cite", "OrderedList", "Table"].includes(tag ?? "")) continue;
    const c = await tree.property(position, "c");
    if (c === undefined) await fail(position, "Invalid tuple arity", ".c");
    await shape(c!, "array", tag === "Table" ? 6 : 2);
    const first = await element(c!, 0);
    if (tag === "Quoted" || tag === "Math") await enumeration(first);
    else if (tag === "Cite") {
      await shape(first, "array");
      for await (const citation of tree.children(first)) {
        await shape(citation, "object");
        const mode = await tree.property(citation, "citationMode");
        if (mode === undefined) await fail(citation, "Expected object", ".citationMode");
        await enumeration(mode!);
      }
    } else if (tag === "OrderedList") {
      await shape(first, "array", 3); await enumeration(await element(first, 1)); await enumeration(await element(first, 2));
    } else {
      const specs = await element(c!, 2); await shape(specs, "array");
      for await (const spec of tree.children(specs)) {await shape(spec, "array", 2); await enumeration(await element(spec, 0));}
      const head = await element(c!, 3); await shape(head, "array", 2); await rows(await element(head, 1));
      const bodies = await element(c!, 4); await shape(bodies, "array");
      for await (const body of tree.children(bodies)) {await shape(body, "array", 4); await rows(await element(body, 2)); await rows(await element(body, 3));}
      const foot = await element(c!, 5); await shape(foot, "array", 2); await rows(await element(foot, 1));
    }
  }
  return enums;
}
