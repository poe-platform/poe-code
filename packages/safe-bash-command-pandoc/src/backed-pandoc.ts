import {IntegerTable, type PagedStorage} from "safe-bash-io-engine/storage";
import type {BackedJson} from "./backed-json.js";
import type {AdapterContext} from "./types.js";
import {readJsonNumber, JsonNumberError} from "./json-number.js";
import {PandocError} from "./errors.js";

type Rule = string | {list: Rule} | {tuple: readonly Rule[]} | {record: Readonly<Record<string, Rule>>}
  | {tag: Readonly<Record<string, Rule | null>>} | {map: Rule} | {nullable: Rule} | {constant: number};
const list = (rule: Rule): Rule => ({list: rule});
const tuple = (...rules: readonly Rule[]): Rule => ({tuple: rules});
const enumeration = (...names: readonly string[]): Rule => ({tag: Object.fromEntries(names.map(name => [name, null]))});
const attr = tuple("string", list("string"), list(tuple("string", "string")));
const align = enumeration("AlignLeft", "AlignRight", "AlignCenter", "AlignDefault");
const inlines = list("inline"), blocks = list("block");
const caption = tuple({nullable: inlines}, blocks);
const cell = tuple(attr, align, "positive", "positive", blocks);
const row = tuple(attr, list(cell));
const head = tuple(attr, list(row));
const citation: Rule = {record: {
  citationId: "string", citationPrefix: inlines, citationSuffix: inlines,
  citationMode: enumeration("AuthorInText", "SuppressAuthor", "NormalCitation"),
  citationNoteNum: "integer", citationHash: "integer"
}};
const shapes: Readonly<Record<string, Rule>> = {
  document: {record: {"pandoc-api-version": tuple(...[1, 23, 1, 2].map(constant => ({constant}))), meta: {map: "meta"}, blocks}},
  inline: {tag: {
    Str: "string", Space: null, SoftBreak: null, LineBreak: null,
    Emph: inlines, Underline: inlines, Strong: inlines, Strikeout: inlines,
    Superscript: inlines, Subscript: inlines, SmallCaps: inlines,
    Quoted: tuple(enumeration("SingleQuote", "DoubleQuote"), inlines),
    Cite: tuple(list(citation), inlines), Code: tuple(attr, "string"),
    Math: tuple(enumeration("InlineMath", "DisplayMath"), "string"),
    RawInline: tuple("string", "string"), Link: tuple(attr, inlines, tuple("string", "string")),
    Image: tuple(attr, inlines, tuple("string", "string")), Note: blocks, Span: tuple(attr, inlines)
  }},
  block: {tag: {
    Plain: inlines, Para: inlines, LineBlock: list(inlines), CodeBlock: tuple(attr, "string"),
    RawBlock: tuple("string", "string"), BlockQuote: blocks,
    OrderedList: tuple(tuple("integer", enumeration("DefaultStyle", "Example", "Decimal", "LowerRoman", "UpperRoman", "LowerAlpha", "UpperAlpha"), enumeration("DefaultDelim", "Period", "OneParen", "TwoParens")), list(blocks)),
    BulletList: list(blocks), DefinitionList: list(tuple(inlines, list(blocks))),
    Header: tuple("positive", attr, inlines), HorizontalRule: null, Div: tuple(attr, blocks), Figure: tuple(attr, caption, blocks),
    Table: tuple(attr, caption, list(tuple(align, {tag: {ColWidthDefault: null, ColWidth: "width"}})), head, list(tuple(attr, "integer", list(row), list(row))), head)
  }},
  meta: {tag: {MetaMap: {map: "meta"}, MetaList: list("meta"), MetaBool: "boolean", MetaString: "string", MetaInlines: inlines, MetaBlocks: blocks}}
};

/** Validate a retained wire AST without materializing strings, arrays or a
 * depth-dependent JavaScript call stack. Pending schema work and table span
 * occupancy use the caller's paged scratch storage. */
export async function validateBackedPandoc(tree: BackedJson, scratch: PagedStorage, context: AdapterContext): Promise<void> {
  const rules: Rule[] = [], ids = new Map<Rule, number>();
  let pending = 0;
  const push = async (position: number, rule: Rule, cursor = 0, ordinal = 0): Promise<void> => {
    let id = ids.get(rule);
    if (id === undefined) {id = rules.length; rules.push(rule); ids.set(rule, id);}
    const bytes = new Uint8Array(40), view = new DataView(bytes.buffer);
    [pending, position, id, cursor, ordinal].forEach((value, index) => view.setFloat64(index * 8, value, true));
    pending = await scratch.append(bytes);
  };
  const fail = async (position: number, message = "Invalid shape"): Promise<never> => {
    // Only the returned diagnostic owns its path string; successful traversal
    // never retains paths proportional to nesting depth or key length.
    let location = "";
    for (let child = position; child !== tree.rootPosition;) {
      const parent = (await tree.describe(child)).parent;
      if (!parent) break;
      const header = await tree.describe(parent);
      let index = 0;
      for await (const sibling of tree.children(parent)) {
        if (header.kind === "object") {
          const value = (await tree.describe(sibling)).end;
          if (sibling === child || value === child) {
            let key = "";
            for await (const part of tree.scalarChunks(sibling)) key += part;
            location = `.${key}${location}`;
            break;
          }
        } else if (sibling === child) {location = `[${index}]${location}`; break;}
        index++;
      }
      child = parent;
    }
    throw new PandocError("E_AST", "read", message, "json", `$${location}`);
  };
  const number = async (position: number): Promise<number> => {
    if ((await tree.describe(position)).kind !== "literal") return fail(position);
    try {return await readJsonNumber(tree.scalarChunks(position), units => context.cooperate(units));}
    catch (error) {if (!(error instanceof JsonNumberError)) throw error; return fail(position, error.message);}
  };
  const string = async (position: number, key = false): Promise<void> => {
    const header = await tree.describe(position);
    if (header.kind !== (key ? "key" : "string")) await fail(position);
    if (key && ["__proto__", "constructor", "prototype"].includes(await tree.smallText(position, 11) ?? "")) await fail(position);
    let high = false;
    for await (const chunk of tree.scalarChunks(position)) {
      for (let index = 0; index < chunk.length; index++) {
        const code = chunk.charCodeAt(index);
        if (high) {if (code < 0xdc00 || code > 0xdfff) await fail(position, "Invalid Unicode"); high = false;}
        else if (code >= 0xd800 && code <= 0xdbff) high = true;
        else if (code >= 0xdc00 && code <= 0xdfff) await fail(position, "Invalid Unicode");
      }
    }
    if (high) await fail(position, "Invalid Unicode");
  };
  const element = async (position: number, index: number): Promise<number> => {
    let offset = 0;
    for await (const child of tree.children(position)) {if (offset++ === index) return child;}
    return fail(position);
  };
  const geometry = async (position: number): Promise<void> => {
    const columns = (await tree.describe(await element(position, 2))).children;
    const section = async (rows: number, rowHeads = 0): Promise<void> => {
      const count = (await tree.describe(rows)).children;
      const occupied = new IntegerTable(scratch, 64);
      const expiry = new IntegerTable(scratch, 64);
      let rowIndex = 0, covered = 0;
      for await (const row of tree.children(rows)) {
        covered -= Number(await expiry.get(BigInt(rowIndex)) ?? 0n);
        let column = 0;
        for await (const cell of tree.children(await element(row, 1))) {
          while (Number(await occupied.get(BigInt(column)) ?? 0n) > rowIndex) {column++; await context.cooperate();}
          const rowSpan = await number(await element(cell, 2)), columnSpan = await number(await element(cell, 3));
          if (rowSpan > count - rowIndex || columnSpan > columns - column) await fail(cell, "Span exceeds table section");
          if (column < rowHeads && columnSpan > rowHeads - column) await fail(cell, "Row header boundary crossed");
          for (let offset = 0; offset < columnSpan; offset++) {
            const key = BigInt(column + offset);
            if (Number(await occupied.get(key) ?? 0n) > rowIndex) await fail(cell, "Overlapping spans");
            await occupied.set(key, BigInt(rowIndex + rowSpan));
            await context.cooperate();
          }
          const end = BigInt(rowIndex + rowSpan);
          await expiry.set(end, (await expiry.get(end) ?? 0n) + BigInt(columnSpan));
          covered += columnSpan;
          column += columnSpan;
        }
        if (covered !== columns) await fail(row, "Incomplete row occupancy");
        rowIndex++;
      }
    };
    await section(await element(await element(position, 3), 1));
    for await (const body of tree.children(await element(position, 4))) {
      const rowHeadsPosition = await element(body, 1), rowHeads = await number(rowHeadsPosition);
      if (rowHeads < 0 || rowHeads > columns) await fail(rowHeadsPosition, "Invalid row head columns");
      await section(await element(body, 2));
      await section(await element(body, 3), rowHeads);
    }
    await section(await element(await element(position, 5), 1));
  };
  await push(tree.rootPosition, "document");
  while (pending) {
    await context.cooperate();
    const bytes = await scratch.read(pending, 40), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    pending = view.getFloat64(0, true);
    const position = view.getFloat64(8, true), rule = rules[view.getFloat64(16, true)]!;
    const cursor = view.getFloat64(24, true), ordinal = view.getFloat64(32, true);
    const header = await tree.describe(position);
    if (typeof rule === "string") {
      if (Object.hasOwn(shapes, rule)) {await push(position, shapes[rule]!); continue;}
      if (rule === "geometry") {await geometry(position); continue;}
      if (rule === "string") {await string(position); continue;}
      if (rule === "boolean") {
        if (header.kind !== "literal" || !["true", "false"].includes(await tree.smallText(position, 5) ?? "")) await fail(position);
        continue;
      }
      const value = await number(position);
      if (rule === "width" ? value <= 0 || value > 1 : !Number.isSafeInteger(value) || rule === "positive" && value < 1) await fail(position);
      continue;
    }
    if ("constant" in rule) {if (await number(position) !== rule.constant) await fail(position, "Unsupported API version; expected [1,23,1,2]"); continue;}
    if ("nullable" in rule) {
      if (header.kind !== "literal" || await tree.smallText(position, 4) !== "null") await push(position, rule.nullable);
      continue;
    }
    if ("tag" in rule) {
      if (header.kind !== "object") await fail(position);
      const tagPosition = await tree.property(position, "t");
      const tag = tagPosition === undefined || (await tree.describe(tagPosition)).kind !== "string" ? undefined : await tree.smallText(tagPosition, 32);
      if (tag === undefined || !Object.hasOwn(rule.tag, tag)) await fail(position, "Unknown tag");
      const content = await tree.property(position, "c"), shape = rule.tag[tag!];
      if (header.children !== (shape === null ? 2 : 4) || (shape === null ? content !== undefined : content === undefined)) await fail(position);
      if (shape !== null) {
        if (tag === "Table") await push(content!, "geometry");
        await push(content!, shape!);
      }
      continue;
    }
    const object = "record" in rule || "map" in rule;
    if (header.kind !== (object ? "object" : "array")) await fail(position);
    if ("tuple" in rule && header.children !== rule.tuple.length) await fail(position, "Invalid tuple arity");
    if ("record" in rule && header.children !== Object.keys(rule.record).length * 2) await fail(position);
    const child = cursor || position + 32;
    if (child >= header.end) continue;
    if (object) {
      await string(child, true);
      const value = (await tree.describe(child)).end;
      const key = await tree.smallText(child, 32);
      const shape = "map" in rule ? rule.map : key !== undefined && Object.hasOwn(rule.record, key) ? rule.record[key] : undefined;
      if (shape === undefined) await fail(child);
      await push(position, rule, (await tree.describe(value)).end, ordinal + 1);
      await push(value, shape!);
    } else {
      const shape = "tuple" in rule ? rule.tuple[ordinal]! : rule.list;
      await push(position, rule, (await tree.describe(child)).end, ordinal + 1);
      await push(child, shape);
    }
  }
}
