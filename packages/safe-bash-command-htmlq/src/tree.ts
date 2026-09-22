import {
  HtmlBudget,
  HtmlError,
  type MutableHtmlNode as HtmlNode,
  type HtmlNode as PublicHtmlNode,
  type HtmlOptions,
  type HtmlNamespace
} from "./contracts.js";
import { HtmlTokenizer, rawElements, voidElements, type HtmlToken } from "./tokenizer.js";
import { htmlSpace } from "./entities.js";
function allSpace(data: string): boolean {
  for (const c of data) if (!htmlSpace(c)) return false;
  return true;
}
interface Owner {
  source: string;
  mutated: boolean;
}
const owners = new WeakMap<PublicHtmlNode, Owner>();
const internals = new WeakMap<PublicHtmlNode, HtmlNode>();
const views = new WeakMap<HtmlNode, PublicHtmlNode>();
const childViews = new WeakMap<HtmlNode, readonly PublicHtmlNode[]>();
function expose(document: HtmlNode, budget: HtmlBudget): PublicHtmlNode {
  const pending = [{ node: document, depth: 0 }];
  const nodes: HtmlNode[] = [];
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    budget.bound("depth", depth);
    budget.charge("work", 1);
    budget.charge("retainedBytes", 128 + node.children.length * 8);
    nodes.push(node);
    const view = {} as PublicHtmlNode;
    views.set(node, view);
    internals.set(view, node);
    owners.set(view, owners.get(node)!);
    for (const child of node.children) pending.push({ node: child, depth: depth + 1 });
    if (node.templateContents) pending.push({ node: node.templateContents, depth: depth + 1 });
  }
  for (const node of nodes) {
    const view = views.get(node)!;
    childViews.set(node, Object.freeze(node.children.map((child) => views.get(child)!)));
    Object.freeze(node.attributes);
    for (const attribute of node.attributes) Object.freeze(attribute);
    for (const key of ["kind", "name", "data", "namespace", "attributes"] as const)
      Object.defineProperty(view, key, { enumerable: true, get: () => node[key] });
    Object.defineProperty(view, "children", { enumerable: true, get: () => childViews.get(node)! });
    for (const key of ["parent", "previousSibling", "nextSibling", "templateContents"] as const)
      Object.defineProperty(view, key, {
        enumerable: true,
        get: () => (node[key] ? views.get(node[key]!) : node[key])
      });
    Object.freeze(view);
  }
  return views.get(document)!;
}
export function ownsHtmlNode(node: PublicHtmlNode): boolean {
  return internals.has(node);
}
export function originalSource(node: PublicHtmlNode): string {
  const owner = owners.get(node);
  if (!owner) throw new HtmlError("E_OWNERSHIP", "Node is not owned by this HTML engine");
  if (node.kind !== "document")
    throw new HtmlError(
      "E_UNSUPPORTED",
      "Original serialization is defined only for a complete document"
    );
  if (owner.mutated)
    throw new HtmlError("E_MUTATED", "Original source does not represent the mutated tree");
  return owner.source;
}
function unlink(node: HtmlNode): void {
  const parent = node.parent;
  if (!parent) return;
  const index = parent.children.indexOf(node);
  if (index < 0) throw new HtmlError("E_OWNERSHIP", "Inconsistent parent link");
  if (node.previousSibling) node.previousSibling.nextSibling = node.nextSibling;
  if (node.nextSibling) node.nextSibling.previousSibling = node.previousSibling;
  parent.children.splice(index, 1);
  node.parent = null;
  node.previousSibling = null;
  node.nextSibling = null;
}
export function detachHtmlNode(node: PublicHtmlNode, options: HtmlOptions): void {
  const budget = new HtmlBudget(options);
  const owner = owners.get(node);
  if (!owner) throw new HtmlError("E_OWNERSHIP", "Unowned node");
  const internal = internals.get(node);
  if (!internal) throw new HtmlError("E_OWNERSHIP", "Unowned node");
  const parent = internal.parent;
  budget.charge("work", parent?.children.length ?? 1);
  budget.charge("retainedBytes", (parent?.children.length ?? 0) * 8);
  unlink(internal);
  if (parent)
    childViews.set(parent, Object.freeze(parent.children.map((child) => views.get(child)!)));
  owner.mutated = true;
}
/** Replace an existing attribute through engine ownership; preserve insertion order. */
export function replaceHtmlAttribute(node: PublicHtmlNode, name: string, value: string, options: HtmlOptions): void {
  const budget = new HtmlBudget(options);
  const internal = internals.get(node), owner = owners.get(node);
  if (!internal || !owner) throw new HtmlError("E_OWNERSHIP", "Unowned node");
  budget.charge("work", internal.attributes.length + value.length);
  budget.charge("retainedBytes", internal.attributes.length * 64 + value.length * 2);
  if (!internal.attributes.some(a => a.namespace === "none" && a.name === name)) return;
  internal.attributes = Object.freeze(internal.attributes.map(a => a.namespace === "none" && a.name === name ? Object.freeze({ ...a, value }) : a)) as unknown as HtmlNode["attributes"];
  owner.mutated = true;
}
function attach(parent: HtmlNode, node: HtmlNode, before?: HtmlNode): void {
  unlink(node);
  const index = before ? parent.children.indexOf(before) : parent.children.length;
  if (index < 0) throw new HtmlError("E_OWNERSHIP", "Insertion reference has another parent");
  const previous = parent.children[index - 1] ?? null;
  const next = parent.children[index] ?? null;
  node.parent = parent;
  node.previousSibling = previous;
  node.nextSibling = next;
  if (previous) previous.nextSibling = node;
  if (next) next.previousSibling = node;
  parent.children.splice(index, 0, node);
}
const formatting = new Set([
  "a",
  "b",
  "big",
  "code",
  "em",
  "font",
  "i",
  "nobr",
  "s",
  "small",
  "strike",
  "strong",
  "tt",
  "u"
]);
const blocks = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "center",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "header",
  "hgroup",
  "main",
  "menu",
  "nav",
  "ol",
  "p",
  "section",
  "summary",
  "ul",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "pre",
  "listing"
]);
const headElements = new Set([
  "base",
  "basefont",
  "bgsound",
  "link",
  "meta",
  "title",
  "noscript",
  "noframes",
  "style",
  "script",
  "template"
]);
const svgNames: Readonly<Record<string, string>> = {
  altglyph: "altGlyph",
  altglyphdef: "altGlyphDef",
  altglyphitem: "altGlyphItem",
  animatecolor: "animateColor",
  animatemotion: "animateMotion",
  animatetransform: "animateTransform",
  clippath: "clipPath",
  feblend: "feBlend",
  fecolormatrix: "feColorMatrix",
  fecomponenttransfer: "feComponentTransfer",
  fecomposite: "feComposite",
  feconvolvematrix: "feConvolveMatrix",
  fediffuselighting: "feDiffuseLighting",
  fedisplacementmap: "feDisplacementMap",
  fedistantlight: "feDistantLight",
  fedropshadow: "feDropShadow",
  feflood: "feFlood",
  fefunca: "feFuncA",
  fefuncb: "feFuncB",
  fefuncg: "feFuncG",
  fefuncr: "feFuncR",
  fegaussianblur: "feGaussianBlur",
  feimage: "feImage",
  femerge: "feMerge",
  femergenode: "feMergeNode",
  femorphology: "feMorphology",
  feoffset: "feOffset",
  fepointlight: "fePointLight",
  fespecularlighting: "feSpecularLighting",
  fespotlight: "feSpotLight",
  fetile: "feTile",
  feturbulence: "feTurbulence",
  foreignobject: "foreignObject",
  glyphref: "glyphRef",
  lineargradient: "linearGradient",
  radialgradient: "radialGradient",
  textpath: "textPath"
};
const svgAttributes: Readonly<Record<string, string>> = Object.fromEntries(
  [
    "attributeName",
    "attributeType",
    "baseFrequency",
    "baseProfile",
    "calcMode",
    "clipPathUnits",
    "diffuseConstant",
    "edgeMode",
    "filterUnits",
    "glyphRef",
    "gradientTransform",
    "gradientUnits",
    "kernelMatrix",
    "kernelUnitLength",
    "keyPoints",
    "keySplines",
    "keyTimes",
    "lengthAdjust",
    "limitingConeAngle",
    "markerHeight",
    "markerUnits",
    "markerWidth",
    "maskContentUnits",
    "maskUnits",
    "numOctaves",
    "pathLength",
    "patternContentUnits",
    "patternTransform",
    "patternUnits",
    "pointsAtX",
    "pointsAtY",
    "pointsAtZ",
    "preserveAlpha",
    "preserveAspectRatio",
    "primitiveUnits",
    "refX",
    "refY",
    "repeatCount",
    "repeatDur",
    "requiredExtensions",
    "requiredFeatures",
    "specularConstant",
    "specularExponent",
    "spreadMethod",
    "startOffset",
    "stdDeviation",
    "stitchTiles",
    "surfaceScale",
    "systemLanguage",
    "tableValues",
    "targetX",
    "targetY",
    "textLength",
    "viewBox",
    "viewTarget",
    "xChannelSelector",
    "yChannelSelector",
    "zoomAndPan"
  ].map((name) => [name.toLowerCase(), name])
);

export async function parseHtml(
  source: AsyncIterable<Uint8Array>,
  options: HtmlOptions
): Promise<PublicHtmlNode> {
  const budget = new HtmlBudget(options);
  const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });
  let original = "";
  const iterator = source[Symbol.asyncIterator]();
  let complete = false;
  let failed = false;
  let failure: unknown;
  const abort = (): never => {
    throw new HtmlError("E_CANCELLED", "HTML invocation cancelled");
  };
  try {
    while (true) {
      budget.charge("work", 1);
      let listener: () => void = () => {};
      const cancellation = new Promise<never>((_, reject) => {
        listener = () => reject(new HtmlError("E_CANCELLED", "HTML invocation cancelled"));
        options.signal.addEventListener("abort", listener, { once: true });
      });
      let result: IteratorResult<Uint8Array>;
      try {
        result = await Promise.race([iterator.next(), cancellation]);
      } finally {
        options.signal.removeEventListener("abort", listener);
      }
      if (options.signal.aborted) abort();
      if (result.done) {
        complete = true;
        break;
      }
      const chunk = result.value;
      budget.check();
      const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
      if (
        !ArrayBuffer.isView(chunk) ||
        Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)!.get!.call(chunk) !== "Uint8Array"
      )
        throw new HtmlError("E_UNSUPPORTED", "HTML input requires byte chunks");
      const byteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!
        .get!.call(chunk) as number;
      budget.charge("inputBytes", byteLength);
      budget.charge("retainedBytes", byteLength * 2);
      budget.charge("work", byteLength);
      const text = decoder.decode(chunk, { stream: true });
      budget.charge("decodedBytes", text.length * 2);
      original += text;
    }
  } catch (error) {
    failed = true;
    failure = error;
  }
  if (!complete && iterator.return) {
    try {
      await iterator.return();
    } catch (cleanup) {
      if (failed)
        throw new AggregateError([failure, cleanup], "HTML input and cleanup failed");
      throw cleanup;
    }
  }
  if (failed) throw failure;
  const tail = decoder.decode();
  budget.charge("decodedBytes", tail.length * 2);
  budget.charge("retainedBytes", tail.length * 2);
  original += tail;
  budget.charge("retainedBytes", original.length * 2);
  let normalized = "";
  for (let i = 0; i < original.length; i++) {
    budget.charge("work", 1);
    if (i === 0 && original[i] === "\uFEFF") continue;
    if (original[i] === "\r") {
      normalized += "\n";
      if (original[i + 1] === "\n") i++;
    } else normalized += original[i];
  }

  const owner: Owner = { source: original, mutated: false };
  const make = (
    kind: HtmlNode["kind"],
    name = "",
    data = "",
    namespace: HtmlNamespace = "html"
  ): HtmlNode => {
    budget.charge("nodes", 1);
    budget.charge("retainedBytes", 128 + (name.length + data.length) * 2);
    const node: HtmlNode = {
      kind,
      name,
      data,
      namespace,
      attributes: [],
      children: [],
      parent: null,
      previousSibling: null,
      nextSibling: null
    };
    owners.set(node, owner);
    return node;
  };
  const append = (parent: HtmlNode, node: HtmlNode, before?: HtmlNode): void => {
    budget.charge(
      "work",
      (node.parent?.children.length ?? 0) + (before ? parent.children.length : 1)
    );
    attach(parent, node, before);
  };
  const document = make("document");
  const html = make("element", "html");
  const head = make("element", "head");
  const body = make("element", "body");
  append(document, html);
  append(html, head);
  append(html, body);
  const stack: HtmlNode[] = [html];
  const active: (HtmlNode | null)[] = [];
  let form: HtmlNode | null = null;
  let mode: "beforeHead" | "head" | "body" = "beforeHead";
  const current = (): HtmlNode => stack[stack.length - 1]!;
  const target = (node = current()): HtmlNode => node.templateContents ?? node;
  const push = (node: HtmlNode): void => {
    budget.bound("depth", stack.length + 1);
    stack.push(node);
  };
  const find = (name: string): number => {
    for (let i = stack.length - 1; i >= 0; i--) {
      budget.charge("work", 1);
      if (stack[i]!.name.toLowerCase() === name) return i;
    }
    return -1;
  };
  const pop = (name: string): void => {
    const i = find(name);
    if (i > 0) stack.length = i;
  };
  const inScope = (names: readonly string[], extra: readonly string[] = []): number => {
    for (let i = stack.length - 1; i >= 0; i--) {
      budget.charge("work", 1);
      const node = stack[i]!;
      if (node.namespace === "html" && names.includes(node.name)) return i;
      if (
        (node.namespace === "html" &&
          (["applet", "caption", "html", "table", "td", "th", "marquee", "object", "template"].includes(node.name) ||
            extra.includes(node.name))) ||
        (node.namespace === "mathml" &&
          ["mi", "mo", "mn", "ms", "mtext", "annotation-xml"].includes(node.name)) ||
        (node.namespace === "svg" && ["foreignObject", "desc", "title"].includes(node.name))
      )
        return -1;
    }
    return -1;
  };
  const headings = ["h1", "h2", "h3", "h4", "h5", "h6"];
  const clearFormatting = (): void => {
    while (active.length) {
      budget.charge("work", 1);
      if (active.pop() === null) break;
    }
  };
  const closeCell = (): void => {
    const index = inScope(["td", "th"]);
    if (index > 0) {
      stack.length = index;
      clearFormatting();
    }
  };
  const mergeAttributes = (node: HtmlNode, attributes: HtmlNode["attributes"]): void => {
    const names = new Set(node.attributes.map((attribute) => attribute.name));
    budget.charge("work", node.attributes.length + attributes.length);
    for (const attribute of attributes) {
      if (names.has(attribute.name)) continue;
      budget.charge("retainedBytes", 64 + (attribute.name.length + attribute.value.length) * 2);
      node.attributes.push(attribute);
      names.add(attribute.name);
    }
  };
  const clone = (node: HtmlNode): HtmlNode => {
    const n = make("element", node.name, "", node.namespace);
    budget.charge("attributes", node.attributes.length);
    budget.charge(
      "retainedBytes",
      node.attributes.reduce((sum, a) => sum + 64 + (a.name.length + a.value.length) * 2, 0)
    );
    n.attributes = node.attributes.map((a) => ({ ...a }));
    return n;
  };
  const reconstruct = (): void => {
    for (let i = active.lastIndexOf(null) + 1; i < active.length; i++) {
      budget.charge("work", stack.length + 1);
      const a = active[i]!;
      if (!stack.includes(a)) {
        const n = clone(a);
        append(target(), n);
        push(n);
        active[i] = n;
      }
    }
  };
  const location = (): [HtmlNode, HtmlNode?] => {
    const name = current().name;
    if (
      name === "table" ||
      name === "tbody" ||
      name === "thead" ||
      name === "tfoot" ||
      name === "tr"
    ) {
      const table = stack[find("table")];
      if (table?.parent) return [table.parent, table];
    }
    return [target()];
  };
  const special = (node: HtmlNode): boolean =>
    node.namespace !== "html" ||
    blocks.has(node.name) ||
    [
      "applet",
      "button",
      "caption",
      "colgroup",
      "dd",
      "dt",
      "li",
      "object",
      "select",
      "table",
      "tbody",
      "td",
      "tfoot",
      "th",
      "thead",
      "tr"
    ].includes(node.name);
  const adopt = (name: string): void => {
    // HTML's adoption-agency loop is deliberately capped at eight iterations.
    for (let outer = 0; outer < 8; outer++) {
      budget.charge("work", stack.length + active.length);
      let at = -1;
      for (let i = active.length - 1; i >= 0; i--) {
        if (active[i] === null) break;
        if (active[i]!.name === name) {
          at = i;
          break;
        }
      }
      if (at < 0) {
        pop(name);
        return;
      }
      const fmt = active[at]!;
      const index = stack.indexOf(fmt);
      if (index < 0) {
        active.splice(at, 1);
        return;
      }
      let blockIndex = -1;
      for (let i = index + 1; i < stack.length; i++)
        if (special(stack[i]!)) {
          blockIndex = i;
          break;
        }
      if (blockIndex < 0) {
        stack.length = index;
        active.splice(at, 1);
        return;
      }
      const block = stack[blockIndex]!;
      const ancestor = stack[index - 1]!;
      let bookmark = at;
      let last = block;
      let cursor = blockIndex;
      for (let inner = 1; cursor > index; inner++) {
        budget.charge("work", stack.length + active.length);
        cursor--;
        const node = stack[cursor]!;
        if (node === fmt) break;
        let activeIndex = active.indexOf(node);
        if (inner > 3 && activeIndex >= 0) {
          active.splice(activeIndex, 1);
          if (activeIndex < bookmark) bookmark--;
          activeIndex = -1;
        }
        if (activeIndex < 0) {
          stack.splice(cursor, 1);
          continue;
        }
        const replacement = clone(node);
        stack[cursor] = replacement;
        active[activeIndex] = replacement;
        if (last === block) bookmark = activeIndex + 1;
        append(replacement, last);
        last = replacement;
      }
      if (["table", "tbody", "tfoot", "thead", "tr"].includes(ancestor.name)) {
        const table = stack[find("table")];
        if (table?.parent) append(table.parent, last, table);
        else append(target(ancestor), last);
      } else append(target(ancestor), last);
      const replacement = clone(fmt);
      while (block.children.length) append(replacement, block.children[0]!);
      append(block, replacement);
      const old = active.indexOf(fmt);
      active.splice(old, 1);
      if (old < bookmark) bookmark--;
      active.splice(bookmark, 0, replacement);
      stack.splice(stack.indexOf(fmt), 1);
      stack.splice(stack.indexOf(block) + 1, 0, replacement);
    }
  };
  const text = (data: string): void => {
    if (!data) return;
    reconstruct();
    const [parent, before] = allSpace(data) ? [target(), undefined] : location();
    const last = before ? before.previousSibling : parent.children[parent.children.length - 1];
    if (last?.kind === "text") {
      budget.charge("retainedBytes", data.length * 2);
      last.data += data;
    } else append(parent, make("text", "", data), before);
  };
  const tokenizer = new HtmlTokenizer(normalized, budget);
  let token: HtmlToken | undefined;
  while (
    (token = tokenizer.next(
      current().namespace === "html" &&
        (rawElements.has(current().name) ||
          current().name === "title" ||
          current().name === "textarea")
        ? current().name
        : undefined,
      current().namespace !== "html"
    ))
  ) {
    budget.charge("work", stack.length + active.length + 1);
    if (token.kind === "doctype") {
      if (mode === "beforeHead") append(document, make("doctype", "", token.data), html);
      continue;
    }
    if (token.kind === "comment") {
      append(
        mode === "beforeHead" ? document : target(),
        make("comment", "", token.data),
        mode === "beforeHead" ? html : undefined
      );
      continue;
    }
    if (token.kind === "text") {
      if (mode === "beforeHead") {
        if (allSpace(token.data)) continue;
        mode = "body";
        stack.push(body);
      }
      if (mode === "head" && current() === head && !allSpace(token.data)) {
        mode = "body";
        stack.length = 1;
        stack.push(body);
      }
      let data = token.data;
      if (current().name === "colgroup" && !allSpace(data)) {
        let prefix = 0;
        while (htmlSpace(data[prefix] ?? "")) {
          budget.charge("work", 1);
          prefix++;
        }
        if (prefix) text(data.slice(0, prefix));
        data = data.slice(prefix);
        stack.pop();
      }
      if (
        (current().name === "pre" ||
          current().name === "textarea" ||
          current().name === "listing") &&
        current().children.length === 0 &&
        data.startsWith("\n")
      )
        data = data.slice(1);
      if (current().namespace === "html" && !rawElements.has(current().name))
        data = data.split("\0").join("");
      text(data);
      continue;
    }
    let t = token as Extract<HtmlToken, { name: string }>;
    const name = t.name;
    if (current().namespace === "html" && current().name === "colgroup" &&
      !["col", "template", "colgroup"].includes(name)) stack.pop();
    if (t.kind === "start" && ["caption", "col", "colgroup", "tbody", "td", "tfoot", "th", "thead", "tr"].includes(name)) {
      const caption = inScope(["caption"]);
      if (caption > 0) {
        stack.length = caption;
        clearFormatting();
      }
    }
    if (
      find("select") >= 0 &&
      !["option", "optgroup", "select", "script", "template"].includes(name)
    ) {
      if (["input", "keygen", "textarea"].includes(name) && t.kind === "start") pop("select");
      else continue;
    }
    if (t.kind === "start" && name === "select" && find("select") >= 0) {
      pop("select");
      continue;
    }
    if (t.kind === "start" && name === "html") {
      mergeAttributes(html, t.attributes);
      continue;
    }
    if (t.kind === "start" && name === "head" && mode === "beforeHead") {
      mode = "head";
      stack.push(head);
      head.attributes = t.attributes;
      continue;
    }
    if (name === "head" && mode !== "beforeHead" && !(t.kind === "end" && mode === "head")) continue;
    if (t.kind === "end" && name === "head") {
      stack.length = 1;
      mode = "body";
      stack.push(body);
      continue;
    }
    if (mode === "beforeHead") {
      if (t.kind === "start" && headElements.has(name)) {
        mode = "head";
        stack.push(head);
      } else {
        mode = "body";
        stack.push(body);
      }
    }
    if (mode === "head" && current() === head && t.kind === "start" && !headElements.has(name)) {
      stack.length = 1;
      stack.push(body);
      mode = "body";
    }
    if (t.kind === "start" && name === "body") {
      mergeAttributes(body, t.attributes);
      continue;
    }
    if (t.kind === "end" && name === "br" && current().namespace === "html")
      t = { ...t, kind: "start" };
    if (t.kind === "end") {
      if (name === "body" || name === "html") continue;
      if (["table", "tbody", "thead", "tfoot", "tr", "td", "th"].includes(name)) {
        if (find(name) >= 0) {
          closeCell();
          if (name !== "td" && name !== "th") pop(name);
        }
        continue;
      }
      if (name === "form" && find("template") < 0) {
        const node = form;
        form = null;
        const index = node ? inScope(["form"]) : -1;
        if (index > 0 && stack[index] === node) stack.splice(index, 1);
        continue;
      }
      if (name === "caption") {
        const index = inScope(["caption"]);
        if (index > 0) {
          stack.length = index;
          clearFormatting();
        }
        continue;
      }
      if (formatting.has(name)) {
        adopt(name);
        continue;
      }
      if (name === "template") {
        pop(name);
        clearFormatting();
        continue;
      }
      if (name === "p" && inScope(["p"], ["button"]) < 0) {
        const p = make("element", "p");
        append(target(), p);
        continue;
      }
      if (headings.includes(name)) {
        const index = inScope(headings);
        if (index > 0) stack.length = index;
        continue;
      }
      if (blocks.has(name) || ["li", "dd", "dt", "button", "applet", "marquee", "object"].includes(name)) {
        const index = inScope([name], name === "li" ? ["ol", "ul"] : name === "p" ? ["button"] : []);
        if (index > 0) stack.length = index;
      } else {
        for (let i = stack.length - 1; i > 0; i--) {
          budget.charge("work", 1);
          if (stack[i]!.name.toLowerCase() === name) {
            stack.length = i;
            break;
          }
          if (special(stack[i]!)) break;
        }
      }
      continue;
    }
    let ns: HtmlNamespace = current().namespace;
    if (
      (ns === "svg" && ["foreignObject", "desc", "title"].includes(current().name)) ||
      (ns === "mathml" &&
        ["mi", "mo", "mn", "ms", "mtext"].includes(current().name) &&
        name !== "mglyph" &&
        name !== "malignmark") ||
      (ns === "mathml" &&
        current().name === "annotation-xml" &&
        current().attributes.some(
          (a) =>
            a.name === "encoding" &&
            ["text/html", "application/xhtml+xml"].includes(a.value.toLowerCase())
        ))
    )
      ns = "html";
    if (
      ns !== "html" &&
      [
        "b",
        "big",
        "blockquote",
        "body",
        "br",
        "center",
        "code",
        "dd",
        "div",
        "dl",
        "dt",
        "em",
        "embed",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "head",
        "hr",
        "i",
        "img",
        "li",
        "listing",
        "menu",
        "meta",
        "nobr",
        "ol",
        "p",
        "pre",
        "ruby",
        "s",
        "small",
        "span",
        "strong",
        "strike",
        "sub",
        "sup",
        "table",
        "tt",
        "u",
        "ul",
        "var"
      ].includes(name)
    ) {
      while (current().namespace !== "html") stack.pop();
      ns = "html";
    }
    if (name === "svg") ns = "svg";
    if (name === "math") ns = "mathml";
    if (ns === "html") {
      if (["caption", "col", "colgroup", "tbody", "td", "tfoot", "th", "thead", "tr"].includes(name) &&
        find("table") < 0 && find("template") < 0) continue;
      if (name === "form" && form && find("template") < 0) continue;
      if (blocks.has(name) || name === "table" || name === "hr") {
        const index = inScope(["p"], ["button"]);
        if (index > 0) stack.length = index;
      }
      if (name === "li") {
        const index = inScope(["li"], ["ol", "ul"]);
        if (index > 0) stack.length = index;
      }
      if (headings.includes(name) && headings.includes(current().name)) stack.pop();
      if (name === "button") {
        const index = inScope(["button"]);
        if (index > 0) stack.length = index;
        reconstruct();
      }
      if (name === "dt" || name === "dd") {
        pop("dt");
        pop("dd");
      }
      if (name === "option") pop("option");
      if (name === "optgroup") {
        if (current().name === "option") stack.pop();
        if (current().name === "optgroup") stack.pop();
      }
      if (name === "tr") {
        closeCell();
        pop("tr");
        if (current().name === "table") {
          const section = make("element", "tbody");
          append(target(), section);
          push(section);
        }
      }
      if (name === "td" || name === "th") {
        closeCell();
        if (current().name === "table") {
          const section = make("element", "tbody");
          append(target(), section);
          push(section);
        }
        if (["tbody", "thead", "tfoot"].includes(current().name)) {
          const row = make("element", "tr");
          append(target(), row);
          push(row);
        }
      }
      if (name === "tbody" || name === "thead" || name === "tfoot") {
        closeCell();
        pop("tr");
        if (["tbody", "thead", "tfoot"].includes(current().name)) stack.pop();
      }
      if (name === "col" && current().name === "table") {
        const group = make("element", "colgroup");
        append(target(), group);
        push(group);
      }
      if (
        name === "a" &&
        active.slice(active.lastIndexOf(null) + 1).some((node) => node?.name === "a")
      )
        adopt("a");
      if (formatting.has(name)) reconstruct();
    }
    const node = make("element", ns === "svg" ? (svgNames[name] ?? name) : name, "", ns);
    node.attributes = t.attributes;
    budget.charge(
      "retainedBytes",
      node.attributes.reduce((sum, a) => sum + 64 + (a.name.length + a.value.length) * 2, 0)
    );
    if (ns !== "html")
      for (const a of node.attributes) {
        if (ns === "svg") a.name = svgAttributes[a.name] ?? a.name;
        if (ns === "mathml" && a.name === "definitionurl") a.name = "definitionURL";
        const colon = a.name.indexOf(":");
        const prefix = a.name.slice(0, colon);
        if (colon > 0 && ["xml", "xmlns", "xlink"].includes(prefix))
          a.namespace = prefix as "xml" | "xmlns" | "xlink";
        else if (a.name === "xmlns") a.namespace = "xmlns";
      }
    const tableAllowed = new Set([
      "caption",
      "colgroup",
      "col",
      "tbody",
      "thead",
      "tfoot",
      "tr",
      "td",
      "th",
      "style",
      "script",
      "template"
    ]);
    const [parent, before] =
      ns === "html" && !tableAllowed.has(name) ? location() : [target(), undefined];
    append(parent, node, before);
    if (name === "form" && ns === "html" && find("template") < 0) form = node;
    if (["caption", "td", "th"].includes(name) && ns === "html") active.push(null);
    if (name === "template" && ns === "html") {
      node.templateContents = make("fragment");
      active.push(null);
    }
    if ((ns === "html" && voidElements.has(name)) || (ns !== "html" && t.selfClosing)) continue;
    push(node);
    if (ns === "html" && formatting.has(name)) active.push(node);
  }
  return expose(document, budget);
}
