import type { TextStore } from "safe-bash-command-html-to-markdown/stored-text";
import { HtmlBudget, type HtmlOptions } from "./contracts.js";
import type { DocumentStore } from "./document-store.js";
import { inlineElements, rustWhitespaceOnly } from "./serializer.js";
import { rawElements, voidElements } from "./tokenizer.js";

/** Classification never materializes arbitrary element names. The emitted name
 * itself always comes from the stored rope, including custom/foreign names. */
export async function knownName(text: TextStore, name: number): Promise<string> {
  if ((await text.info(name)).length > 32) return "";
  let value = "";
  for await (const chunk of text.chunks(name)) value += chunk;
  return value;
}

export async function storedWhitespace(text: TextStore, root: number): Promise<boolean> {
  for await (const chunk of text.chunks(root)) if (!rustWhitespaceOnly(chunk)) return false;
  return true;
}

async function* escaped(text: TextStore, root: number, attribute: boolean): AsyncGenerator<string> {
  for await (const chunk of text.chunks(root)) {
    let result = "";
    for (const c of chunk) result += c === "&" ? "&amp;" : c === "\u00a0" ? "&nbsp;" : attribute && c === '"' ? "&quot;" : !attribute && c === "<" ? "&lt;" : !attribute && c === ">" ? "&gt;" : c;
    yield result;
  }
}

/** Parent/sibling records replace resident traversal frames and indent strings. */
export async function* serializeStoredHtml(root: number, tree: DocumentStore, text: TextStore, options: HtmlOptions, mode: "normalized" | "pretty" = "normalized"): AsyncGenerator<string> {
  const budget = new HtmlBudget(options);
  let id = root, entering = true, depth = 0, indent = 0, previousWasBlock = false;
  function* newline(): Generator<string> {
    yield "\n";
    for (let remaining = indent; remaining > 0; remaining -= 2048) yield " ".repeat(Math.min(2048, remaining));
  }
  while (id) {
    budget.charge("work", 1); budget.bound("depth", depth); budget.bound("retainedBytes", (depth + 1) * 32);
    const node = await tree.read(id), name = await knownName(text, node.name);
    let close = node.kind === "element";
    if (entering) {
      if (node.kind === "text") {
        let emit = true;
        if (mode === "pretty") {
          budget.charge("work", (await text.info(node.data)).length);
          emit = !await storedWhitespace(text, node.data);
          if (emit) {
            if (previousWasBlock) yield* newline();
            previousWasBlock = false;
          }
        }
        if (emit) {
          const parent = node.parent ? await tree.read(node.parent) : undefined;
          if (parent?.namespace === "html" && rawElements.has(await knownName(text, parent.name))) yield* text.chunks(node.data);
          else yield* escaped(text, node.data, false);
        }
      } else if (node.kind === "comment") {
        yield "<!--"; yield* text.chunks(node.data); yield "-->";
      } else if (node.kind === "doctype") {
        yield "<!DOCTYPE "; yield* text.chunks(node.data); yield ">";
      } else {
        if (node.kind === "element") {
          if (mode === "pretty") { if (!inlineElements.has(name) || previousWasBlock) yield* newline(); indent += 2; }
          yield "<"; yield* text.chunks(node.name);
          for await (const a of tree.attributes(id)) {
            yield " "; yield* text.chunks(a.name); yield '="'; yield* escaped(text, a.value, true); yield '"';
          }
          yield ">";
          if (node.namespace === "html" && voidElements.has(name)) {
            close = false;
            if (mode === "pretty") { indent -= 2; previousWasBlock = !inlineElements.has(name); if (previousWasBlock) yield* newline(); }
          }
        }
        if ((close || node.kind !== "element") && node.first) { id = node.first; depth++; entering = true; continue; }
      }
    }
    if (close) {
      if (mode === "pretty") { indent -= 2; previousWasBlock = !inlineElements.has(name); if (previousWasBlock) yield* newline(); }
      yield "</"; yield* text.chunks(node.name); yield ">";
    }
    if (id === root) return;
    if (node.next) { id = node.next; entering = true; }
    else { id = node.parent; depth--; entering = false; }
  }
}
