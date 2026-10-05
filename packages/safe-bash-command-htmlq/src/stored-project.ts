import type { PagedStorage } from "@poe-code/safe-fs/storage";
import { TextStore } from "safe-bash-command-html-to-markdown/stored-text";
import { yieldTurn } from "safe-bash-contracts/yield";
import { HtmlBudget, HtmlError, type HtmlOptions } from "./contracts.js";
import type { HtmlqArguments } from "./arguments.js";
import { DocumentStore, StoredSequence } from "./document-store.js";
import { parseStoredHtml } from "./stored-parser.js";
import { selectStoredHtml, StoredQueries } from "./stored-selectors.js";
import { StoredUrls } from "./stored-url.js";
import { knownName, serializeStoredHtml, storedWhitespace } from "./stored-serializer.js";

/** The command owns storage cleanup, so sink failures cannot hide spill cleanup
 * errors while an async iterator is being closed by for-await. */
export async function* projectStoredHtmlq(source: AsyncIterable<Uint8Array>, args: HtmlqArguments, options: HtmlOptions, storage: PagedStorage): AsyncGenerator<Uint8Array> {
  const budget = new HtmlBudget(options);
  let operations = 0, characters = 0;
  const tree = new DocumentStore(storage, () => {
    budget.check();
    if (++operations % 2048 === 0) return yieldTurn(options.signal);
  });
  const text = new TextStore(storage, async count => {
    characters += count;
    if (characters >= 4096) { characters = 0; await yieldTurn(options.signal); }
    budget.check();
  });
  const document = await parseStoredHtml(source, tree, text, storage, options);
  const query = new StoredQueries(tree, text, storage, budget);
  const urls = new StoredUrls(text, storage, budget);
  let base = await urls.parse(await text.from(args.base));
  if (args.detectBase) {
    for await (const first of selectStoredHtml(document, "base", tree, text, storage, options)) {
      base = await urls.parse(await query.attribute(await tree.read(first), "href") ?? 0) ?? base;
      break;
    }
  }
  const baseHref = base ? await urls.serialize(base) : 0;
  const selected = selectStoredHtml(document, args.selector, tree, text, storage, options);
  let removal = "";
  if (args.removeNodes.length) {
    removal = args.removeNodes.join(","); budget.charge("retainedBytes", removal.length * 2);
    try { selectStoredHtml(document, removal, tree, text, storage, options); }
    catch (error) { if (!(error instanceof HtmlError) || error.code !== "E_SELECTOR") throw error; removal = ""; }
  }
  const snapshot = new StoredSequence(storage), matches = new StoredSequence(storage);
  if (removal) for await (const node of selected) { budget.charge("retainedBytes", 8); await snapshot.push(node); }
  async function* nodes(): AsyncGenerator<number> {
    if (!removal) { yield* selected; return; }
    for (let i = 0; i < snapshot.length; i++) yield (await snapshot.get(i))!;
  }
  async function* descendants(root: number): AsyncGenerator<number> {
    let id = root, depth = 0;
    while (id) {
      const node = await tree.read(id);
      budget.charge("work", 1); budget.bound("depth", depth);
      yield id;
      if (node.first) { id = node.first; depth++; continue; }
      while (id !== root && !(await tree.read(id)).next) { id = (await tree.read(id)).parent; depth--; }
      if (id === root) return;
      id = (await tree.read(id)).next;
    }
  }
  const encoder = new TextEncoder();
  async function* output(value: string): AsyncGenerator<Uint8Array> {
    let pending = "";
    for (const c of value) {
      budget.charge("work", 1);
      if (pending.length + c.length > 2048) {
        budget.charge("retainedBytes", pending.length * 3);
        const bytes = encoder.encode(pending); budget.charge("outputBytes", bytes.length);
        yield bytes; budget.check(); pending = "";
      }
      budget.charge("retainedBytes", c.length * 2); pending += c;
    }
    if (pending) {
      budget.charge("retainedBytes", pending.length * 3);
      const bytes = encoder.encode(pending); budget.charge("outputBytes", bytes.length);
      yield bytes; budget.check();
    }
  }
  let index = 0;
  for await (const id of nodes()) {
    if (index++ % 64 === 0) { await yieldTurn(options.signal); budget.check(); }
    if (removal) {
      let ancestor = id;
      for (;;) { const parent = (await tree.read(ancestor)).parent; if (!parent) break; budget.charge("work", 1); ancestor = parent; }
      if (ancestor !== document) continue;
      await matches.truncate(0);
      let removedRoot = false;
      for await (const match of selectStoredHtml(id, removal, tree, text, storage, options)) {
        budget.charge("retainedBytes", 8); await matches.push(match); if (match === id) removedRoot = true;
      }
      for (let i = 0; i < matches.length; i++) {
        const match = (await matches.get(i))!, parent = (await tree.read(match)).parent;
        const count = parent ? (await tree.read(parent)).childCount : 0;
        budget.charge("work", parent ? count : 1); budget.charge("retainedBytes", count * 8);
        await tree.detach(match);
      }
      if (removedRoot) continue;
    }
    const node = await tree.read(id);
    if (base && node.namespace === "html" && ["a", "area", "link"].includes(await knownName(text, node.name))) {
      for await (const a of tree.attributes(id)) {
        if (a.namespace !== "none" || !await query.literal(a.name, "href")) continue;
        const hrefLength = (await text.info(a.value)).length;
        budget.charge("work", hrefLength + (await text.info(baseHref)).length);
        let value: number;
        if (await query.literal(a.value, "////", false, true)) {
          let offset = 0;
          for await (const c of text.characters(a.value)) { budget.charge("work", 1); if (c !== "/") break; offset++; }
          value = await text.slice(a.value, offset);
        } else {
          const resolved = await urls.parse(a.value, base);
          value = resolved ? await urls.serialize(resolved) : baseHref;
        }
        const valueLength = (await text.info(value)).length;
        budget.charge("work", node.attributeCount + valueLength);
        budget.charge("retainedBytes", node.attributeCount * 64 + valueLength * 2);
        await tree.replaceAttribute(a.id, value); break;
      }
    }
    if (args.attributes.length) {
      for (const name of args.attributes) {
        budget.charge("work", node.attributeCount + name.length);
        // Projection attribute names remain case-sensitive in every namespace.
        for await (const a of tree.attributes(id)) {
          if (a.namespace !== "none" || !await query.literal(a.name, name)) continue;
          for await (const chunk of text.chunks(a.value)) yield* output(chunk);
          yield* output("\n"); break;
        }
      }
    } else if (args.text) {
      for await (const descendant of descendants(id)) {
        const n = await tree.read(descendant); if (n.kind !== "text") continue;
        budget.charge("work", (await text.info(n.data)).length);
        if (args.ignoreWhitespace && await storedWhitespace(text, n.data)) continue;
        for await (const chunk of text.chunks(n.data)) yield* output(chunk);
        if (args.ignoreWhitespace) yield* output("\n");
      }
      yield* output("\n");
    } else {
      for await (const piece of serializeStoredHtml(id, tree, text, options, args.pretty ? "pretty" : "normalized")) yield* output(piece);
      yield* output("\n");
    }
  }
}
