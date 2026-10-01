import type {Attr, Block, Inline, Row, ColSpec, MetaValue} from "./ast-types.js";
import type {ReaderCapability, Resource} from "./types.js";
import {odtNamespaces as ns, odtPackage, odtFailure, parseOdtXml, odtAttribute as a, odtChildren as children, type OdtElement, fo, xlink, svg} from "./odt-package.js";

const attr: Attr = ["", [], []];
export const odtReader: ReaderCapability = {format: "odt", async read(input, ctx) {
  const parts = await odtPackage(ctx).read(input.bytes);
  const source = parts.get("content.xml") ?? odtFailure(ctx, "Missing ODT content.xml");
  const root = await parseOdtXml(source, ctx);
  if (root.uri !== ns.office || root.name !== "document-content") odtFailure(ctx, "Invalid ODT content root");
  const bodies = children(root, "body", ns.office).flatMap(body => children(body, "text", ns.office));
  if (bodies.length !== 1) odtFailure(ctx, "Expected one ODT text body");
  const styles = new Map<string, OdtElement>();
  const resources = new Map<string, Resource>();
  const collectStyles = (node: OdtElement) => {
    ctx.checkpoint();
    if (node.uri === ns.style && node.name === "style" || node.uri === ns.text && node.name === "list-style") styles.set(a(node, "name", ns.style), node);
    for (const child of node.children) if (typeof child !== "string") collectStyles(child);
  };
  if (parts.has("styles.xml")) collectStyles(await parseOdtXml(parts.get("styles.xml")!, ctx));
  collectStyles(root);
  const styleChain = (name: string): string[] => {
    const names = new Set<string>();
    while (name) {
      ctx.checkpoint(); ctx.bound("depth", names.size + 1);
      if (names.has(name)) odtFailure(ctx, "Cyclic ODT style inheritance");
      names.add(name);
      const style = styles.get(name);
      name = style ? a(style, "parent-style-name", ns.style) : "";
    }
    return [...names];
  };
  const properties = (name: string): Map<string, string> => {
    const result = new Map<string, string>();
    for (const parent of styleChain(name).reverse()) {
      const style = styles.get(parent); if (!style) continue;
      for (const child of children(style, "text-properties", ns.style)) for (const prop of child.attrs) result.set(`${prop.uri}:${prop.name}`, prop.value);
    }
    return result;
  };
  const plainText = (node: OdtElement): string => {ctx.checkpoint(); return node.children.map(child => typeof child === "string" ? child : plainText(child)).join("");};
  const count = (value: string, maximum: number): number => {
    const n = value ? Number(value) : 1;
    if (!Number.isSafeInteger(n) || n < 1) odtFailure(ctx, "Invalid ODT repetition count");
    if (n > maximum) odtFailure(ctx, "ODT repetition limit exceeded", "E_LIMIT");
    ctx.checkpoint(n); return n;
  };
  const inlines = (nodes: readonly (OdtElement | string)[]): Inline[] => {
    const result: Inline[] = [];
    for (const node of nodes) {
      ctx.checkpoint();
      if (typeof node === "string") {if (node) result.push({t: "Str", c: node}); continue;}
      if (node.uri === ns.text) {
        if (node.name === "s") {const n = count(a(node, "c", ns.text), ctx.limits.text); ctx.charge("retainedBytes", n * 2); result.push({t: "Str", c: " ".repeat(n)});}
        else if (node.name === "tab") result.push({t: "Str", c: "\t"});
        else if (node.name === "line-break") result.push({t: "LineBreak"});
        else if (node.name === "a") result.push({t: "Link", c: [attr, inlines(node.children), [a(node, "href", xlink), ""]]});
        else if (node.name === "span") {
          let content = inlines(node.children);
          const props = properties(a(node, "style-name", ns.text));
          const tags: {tag: "Strong" | "Emph" | "Strikeout" | "Superscript" | "Subscript" | "Underline" | "SmallCaps"; enabled: boolean}[] = [
            {tag: "Strong", enabled: props.get(`${fo}:font-weight`) === "bold"}, {tag: "Emph", enabled: props.get(`${fo}:font-style`) === "italic"},
            {tag: "Strikeout", enabled: ["solid", "double"].includes(props.get(`${ns.style}:text-line-through-style`) ?? "")},
            {tag: "Superscript", enabled: props.get(`${ns.style}:text-position`)?.startsWith("super") ?? false},
            {tag: "Subscript", enabled: props.get(`${ns.style}:text-position`)?.startsWith("sub") ?? false},
            {tag: "Underline", enabled: props.get(`${ns.style}:text-underline-style`) === "solid"}, {tag: "SmallCaps", enabled: props.get(`${fo}:font-variant`) === "small-caps"}];
          for (const {tag, enabled} of tags) if (enabled) content = [{t: tag, c: content}];
          result.push(...content);
        } else if (["bookmark", "bookmark-start"].includes(node.name)) result.push({t: "Span", c: [[a(node, "name", ns.text), [], []], []]});
        else if (!["bookmark-end", "soft-page-break"].includes(node.name)) odtFailure(ctx, `Unsupported ODT inline: ${node.name}`, "E_UNSUPPORTED_FEATURE");
      } else if (node.uri === ns.draw && node.name === "frame") {
        const image = children(node, "image", ns.draw)[0];
        if (!image) odtFailure(ctx, "Unsupported ODT drawing", "E_UNSUPPORTED_FEATURE");
        let name: string;
        try {name = decodeURIComponent(a(image, "href", xlink));} catch {return odtFailure(ctx, "Invalid ODT image URI", "E_RESOURCE");}
        if (name.startsWith("./")) name = name.slice(2);
        if (!name || name.startsWith("/") || name.includes(":") || name.includes("\\") || name.split("/").some(part => !part || part === "." || part === "..")) odtFailure(ctx, "Unsafe ODT image reference", "E_RESOURCE");
        const bytes = parts.get(name) ?? odtFailure(ctx, `Missing ODT image: ${name}`, "E_RESOURCE");
        if (!resources.has(name)) {ctx.charge("resourceBytes", bytes.length); resources.set(name, {id: name, bytes});}
        const attributes: [string, string][] = [];
        for (const dimension of ["width", "height"]) {const value = a(node, dimension, svg); if (value) attributes.push([dimension, value]);}
        result.push({t: "Image", c: [["", [], attributes], [{t: "Str", c: children(node, "desc", svg).map(plainText).join("")}], [name, children(node, "title", svg).map(plainText).join("")]]});
      } else odtFailure(ctx, `Unsupported ODT inline namespace: ${node.uri}`, "E_UNSUPPORTED_FEATURE");
    }
    return result;
  };
  const blocks = async (nodes: readonly (OdtElement | string)[], listLevel = 1): Promise<Block[]> => {
    const result: Block[] = [];
    for (const node of nodes) {
      await ctx.cooperate();
      if (typeof node === "string") {if (node.trim()) odtFailure(ctx, "Text outside ODT paragraph"); continue;}
      if (node.uri === ns.text && ["p", "h"].includes(node.name)) {
        const content = inlines(node.children), names = styleChain(a(node, "style-name", ns.text));
        if (node.name === "h") result.push({t: "Header", c: [count(a(node, "outline-level", ns.text), 6), attr, content]});
        else if (names.includes("Rule")) result.push({t: "HorizontalRule"});
        else if (names.includes("Preformatted")) result.push({t: "CodeBlock", c: [attr, content.map(n => n.t === "Str" ? n.c : n.t === "LineBreak" ? "\n" : n.t === "Space" ? " " : "").join("")]});
        else if (names.some(name => ["Quote", "Quotations"].includes(name))) result.push({t: "BlockQuote", c: [{t: "Para", c: content}]});
        else result.push({t: "Para", c: content});
      } else if (node.uri === ns.text && node.name === "section") result.push({t: "Div", c: [[a(node, "name", ns.text), [], []], await blocks(node.children, listLevel)]});
      else if (node.uri === ns.text && node.name === "list") {
        const style = styles.get(a(node, "style-name", ns.text));
        const level = style?.children.find((child): child is OdtElement => typeof child !== "string" && child.uri === ns.text && Number(a(child, "level", ns.text)) === listLevel);
        const items = children(node, "list-item", ns.text), content: Block[][] = [];
        for (const item of items) content.push(await blocks(item.children, listLevel + 1));
        if (level?.name === "list-level-style-number") {
          const start = count((items[0] && a(items[0], "start-value", ns.text)) || a(level, "start-value", ns.text), Number.MAX_SAFE_INTEGER);
          const style = ({"1": "Decimal", a: "LowerAlpha", A: "UpperAlpha", i: "LowerRoman", I: "UpperRoman"} as const)[a(level, "num-format", ns.style) as "1" | "a" | "A" | "i" | "I"] ?? "Decimal";
          result.push({t: "OrderedList", c: [[start, style, a(level, "num-prefix", ns.style) === "(" ? "TwoParens" : a(level, "num-suffix", ns.style) === ")" ? "OneParen" : "Period"], content]});
        } else result.push({t: "BulletList", c: content});
      } else if (node.uri === ns.table && node.name === "table") {
        const head: Row[] = [], rows: Row[] = [];
        const rowNodes = node.children.flatMap(child => typeof child === "string" ? [] : child.uri === ns.table && child.name === "table-header-rows" ? children(child, "table-row", ns.table).map(row => ({row, header: true})) : child.uri === ns.table && child.name === "table-row" ? [{row: child, header: false}] : []);
        let columns = 0;
        for (const {row, header} of rowNodes) {
          const cells: Row[1][number][] = [];
          for (const cell of children(row, "table-cell", ns.table)) {
            if (count(a(cell, "number-columns-spanned", ns.table), ctx.limits.tableColumns) !== 1 || count(a(cell, "number-rows-spanned", ns.table), ctx.limits.tableRows) !== 1) odtFailure(ctx, "ODT table spans are unsupported", "E_UNSUPPORTED_FEATURE");
            const repeat = count(a(cell, "number-columns-repeated", ns.table), ctx.limits.tableColumns);
            const content = await blocks(cell.children);
            for (let i = 0; i < repeat; i++) {ctx.charge("tableCells", 1); cells.push([attr, "AlignDefault", 1, 1, content]);}
            ctx.bound("tableColumns", cells.length);
          }
          columns = Math.max(columns, cells.length);
          const repeat = count(a(row, "number-rows-repeated", ns.table), ctx.limits.tableRows);
          ctx.charge("tableCells", (repeat - 1) * cells.length);
          for (let i = 0; i < repeat; i++) (header ? head : rows).push([attr, cells]);
          ctx.bound("tableRows", head.length + rows.length);
        }
        const specs: ColSpec[] = Array.from({length: columns}, () => ["AlignDefault", {t: "ColWidthDefault"}]);
        result.push({t: "Table", c: [attr, [null, []], specs, [attr, head], [[attr, 0, [], rows]], [attr, []]]});
      } else if (!(node.uri === ns.text && ["sequence-decls", "tracked-changes"].includes(node.name))) odtFailure(ctx, `Unsupported ODT block: ${node.name}`, "E_UNSUPPORTED_FEATURE");
    }
    return result;
  };
  const metadata: Record<string, MetaValue> = {};
  if (parts.has("meta.xml")) {
    const meta = await parseOdtXml(parts.get("meta.xml")!, ctx);
    for (const container of children(meta, "meta", ns.office)) for (const title of children(container, "title", "http://purl.org/dc/elements/1.1/")) metadata.title = {t: "MetaString", c: plainText(title)};
  }
  const content = await blocks(bodies[0]!.children);
  return {blocks: content, metadata, resources: [...resources.values()]};
}};
