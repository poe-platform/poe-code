import { dictGet, type PdfCosDict, type PdfCosNode, type PdfCosRef } from "@poe-code/pdf-ast";

type ObjectValue = { value: PdfCosNode; container?: number | undefined } | undefined;
type Work<T> = Generator<PdfCosRef | string, T, ObjectValue>;
// Native qpdf category precedence, before arranging categories into PDF parts.
enum Category { Root, Open, FirstShared, FirstPrivate, Shared, Private, ThumbShared, ThumbPrivate, Pages, OutlinesRoot, Outlines, Other }
type Usage = { category: Category; page: number };

/** Compute placement from references, not offsets or hints. Both readers supply
 * one object dictionary at a time; stream payloads are never read here. */
export function* linearizationAssignments(rootRef: PdfCosRef, trailer: PdfCosDict): Work<void> {
  const usage = new Map<number, Usage>(), pages: number[] = [], thumbs: number[] = [];
  function assign(id: number, category: Category, page = -1) {
    const old = usage.get(id);
    if (!old) { usage.set(id, { category, page }); return; }
    const min = Math.min(old.category, category), max = Math.max(old.category, category);
    let merged = min;
    if (min === Category.FirstPrivate && (max === Category.Private || max === Category.Shared)) merged = Category.FirstShared;
    else if (min === Category.Private && max === Category.Private && old.page !== page) merged = Category.Shared;
    else if (min === Category.ThumbPrivate && max === Category.ThumbPrivate && old.page !== page) merged = Category.ThumbShared;
    usage.set(id, { category: merged, page: old.page <= 0 || page <= 0 ? Math.max(old.page, page) : Math.min(old.page, page) });
  }
  function* resolve(node: PdfCosNode | undefined): Work<PdfCosNode | undefined> {
    const seen = new Set<number>();
    while (node?.kind === "ref") {
      if (seen.has(node.objectNumber)) return;
      seen.add(node.objectNumber); node = (yield node)?.value;
    }
    return node?.kind === "stream" ? node.dict : node;
  }
  function* walk(start: PdfCosNode, category: Category, page = -1, pageDict?: PdfCosDict): Work<void> {
    const seen = new Set<number>(), pending = [{ node: start, category, top: true }];
    while (pending.length) {
      const current = pending.pop()!;
      let node = current.node, isPage = false;
      if (node.kind === "ref") {
        if (seen.has(node.objectNumber)) continue;
        seen.add(node.objectNumber);
        const object = yield node;
        if (!object) continue;
        const id = object.container ?? node.objectNumber;
        node = current.top && pageDict ? pageDict : object.value;
        const type = node.kind === "dict" ? dictGet(node, "Type") : undefined;
        isPage = type?.kind === "name" && type.decoded === "Page";
        if (isPage && !current.top) continue;
        if (page >= 0 && category !== Category.ThumbPrivate && type?.kind === "name" && type.decoded === "Pages") continue;
        assign(id, current.top && current.category === Category.Outlines ? Category.OutlinesRoot : current.category, page);
        if (current.top && isPage && page >= 0) pages[page] = id;
        if (current.category === Category.ThumbPrivate && thumbs[page] === undefined) thumbs[page] = id;
      }
      if (node.kind === "stream") node = node.dict;
      if (node.kind === "array") for (const item of node.items) pending.push({ node: item, category: current.category, top: false });
      if (node.kind === "dict") for (const entry of node.entries) {
        if (isPage && entry.key.decoded === "Parent") continue;
        pending.push({ node: entry.value, category: isPage && entry.key.decoded === "Thumb" ? Category.ThumbPrivate : current.category, top: false });
      }
    }
  }
  const rootObject = yield rootRef, root = rootObject?.value;
  if (root?.kind !== "dict") return;
  const tree = dictGet(root, "Pages"), visited = new Set<number>();
  const pending: { node: PdfCosNode; inherited: PdfCosDict["entries"] }[] = tree ? [{ node: tree, inherited: [] }] : [];
  let page = 0;
  while (pending.length) {
    const { node, inherited } = pending.pop()!;
    if (node.kind === "ref") { if (visited.has(node.objectNumber)) continue; visited.add(node.objectNumber); }
    const dict = yield* resolve(node);
    if (dict?.kind !== "dict") continue;
    const attrs = inherited.filter(entry => !dictGet(dict, entry.key.decoded));
    attrs.push(...dict.entries.filter(entry => ["Resources", "MediaBox", "CropBox", "Rotate"].includes(entry.key.decoded)));
    const type = dictGet(dict, "Type");
    if (type?.kind === "name" && type.decoded === "Page") {
      yield* walk(node, page === 0 ? Category.FirstPrivate : Category.Private, page++, { ...dict, entries: [...dict.entries, ...attrs.filter(entry => !dictGet(dict, entry.key.decoded))] });
    } else {
      const kids = yield* resolve(dictGet(dict, "Kids"));
      if (kids?.kind === "array") for (const child of [...kids.items].reverse()) pending.push({ node: child, inherited: attrs });
    }
  }
  for (const entry of trailer.entries) if (!["Root", "Prev", "XRefStm"].includes(entry.key.decoded)) yield* walk(entry.value, entry.key.decoded === "Encrypt" ? Category.Open : Category.Other);
  for (const entry of root.entries) {
    const key = entry.key.decoded;
    const category = ["ViewerPreferences", "PageMode", "Threads", "OpenAction", "AcroForm"].includes(key) ? Category.Open : key === "Pages" ? Category.Pages : key === "Outlines" ? Category.Outlines : Category.Other;
    yield* walk(entry.value, category);
  }
  assign(rootObject!.container ?? rootRef.objectNumber, Category.Root);
  const ordered = [...usage.keys()].sort((a, b) => a - b);
  const select = (category: Category, page?: number) => ordered.filter(id => usage.get(id)!.category === category && (page === undefined || usage.get(id)!.page === page));
  const first = (ids: number[], id: number | undefined) => id !== undefined && ids.includes(id) ? [id, ...ids.filter(value => value !== id)] : ids;
  const outlines = [...select(Category.OutlinesRoot), ...select(Category.Outlines)];
  const mode = yield* resolve(dictGet(root, "PageMode")), showOutlines = mode?.kind === "name" && mode.decoded === "UseOutlines";
  const parts: [string, number[]][] = [
    ["4 (root, document open)", [...select(Category.Root), ...select(Category.Open)]],
    ["6 (first page)", [...first(select(Category.FirstPrivate), pages[0]), ...select(Category.FirstShared), ...(showOutlines ? outlines : [])]],
    ["7 (other pages, private)", pages.flatMap((id, page) => first(select(Category.Private, page), id))],
    ["8 (other pages, shared)", select(Category.Shared)],
    ["9 (everything else)", [...select(Category.Pages), ...pages.flatMap((_, page) => first(select(Category.ThumbPrivate, page), thumbs[page])), ...select(Category.ThumbShared), ...(showOutlines ? [] : outlines), ...select(Category.Other)]],
  ];
  yield "\nComputed Linearization Part Assignments\n\n";
  for (const [label, ids] of parts) {
    yield `part ${label}:`;
    if (!ids.length) { yield " none\n"; continue; }
    let ranges = 0;
    for (let i = 0; i < ids.length; i++) {
      const start = ids[i]!; let end = start;
      while (ids[i + 1] === end + 1) { i++; end++; }
      yield `${ranges++ % 10 === 0 ? "\n " : ", "}${start}${end === start ? "" : `-${end}`}`;
    }
    yield "\n";
  }
}
