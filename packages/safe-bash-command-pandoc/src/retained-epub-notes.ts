import {ZipDirectoryIndex} from "@poe-code/office-package/zip";
import {IntegerTable, type PagedStorage} from "safe-bash-io-engine/storage";
import {BackedTextSet} from "./backed-text-set.js";
import {epubFailure} from "./epub-xml.js";
import type {RetainedRtfAst, RtfValue} from "./retained-rtf-ast.js";
import type {AdapterContext} from "./types.js";

/** Note definitions, expansion continuations and active dependency membership
 * live in caller storage. URI control values still cross the existing EPUB
 * string boundary; note prose never does. Call after book identity rewriting. */
export class RetainedEpubNotes {
  private readonly definitions: ZipDirectoryIndex;
  private readonly referenced: BackedTextSet;
  constructor(private readonly ast: RetainedRtfAst, private readonly storage: PagedStorage, private readonly ctx: AdapterContext) {
    this.definitions = new ZipDirectoryIndex(storage, {maximumKeyLength: Number.MAX_SAFE_INTEGER});
    this.referenced = new BackedTextSet(storage, ast.text);
  }
  async add(key: string, blocks: RtfValue): Promise<void> {await this.definitions.set(key, blocks.position);}
  private async text(value: RtfValue): Promise<string> {
    let text = "";
    for await (const chunk of this.ast.text.chunks(await this.ast.range(value))) text += chunk;
    return text;
  }
  private async isReference(attrs: RtfValue): Promise<boolean> {
    const pairs = (await this.ast.at(attrs, 2))!;
    for await (const pair of this.ast.children(pairs)) {
      // Only compare bounded attribute names and tokens. Arbitrarily long
      // attribute values must not accumulate while looking for noteref.
      const key = (await this.ast.edge(pair))!;
      if ((await this.ast.range(key)).units !== 14 || await this.text(key) !== "data-epub-type") continue;
      let token = "", overflow = false;
      for await (const chunk of this.ast.text.chunks(await this.ast.range((await this.ast.edge(pair, true))!))) for (const c of chunk) {
        if (c === " ") {if (!overflow && token === "noteref") return true; token = ""; overflow = false;}
        else if (token.length < 7) token += c;
        else overflow = true;
      }
      if (!overflow && token === "noteref") return true;
    }
    return false;
  }
  async expand(root: RtfValue): Promise<void> {
    const {ast, ctx} = this;
    const active = new ZipDirectoryIndex(this.storage, {maximumKeyLength: Number.MAX_SAFE_INTEGER});
    const exits = new IntegerTable(this.storage);
    await ast.walk(root, async (value, depth, leaving) => {
      ctx.checkpoint();
      if (leaving) {
        const key = await exits.get(BigInt(value.position));
        if (key !== undefined) await active.set(await this.text({position: Number(key)}), 0);
        return;
      }
      ctx.bound("depth", depth);
      const name = await ast.name(value);
      // JS AST traversal also visits each tag's scalar t property.
      if (name) ctx.bound("depth", depth + 1);
      if (name !== "Link") return;
      const content = (await ast.content(value))!, attrs = (await ast.at(content, 0))!;
      if (!await this.isReference(attrs)) return;
      const target = (await ast.edge((await ast.at(content, 2))!))!;
      const key = decodeURIComponent((await this.text(target)).slice(1));
      if (await active.get(key)) epubFailure(ctx, key, "Recursive EPUB note dependency");
      const position = await this.definitions.get(key);
      if (position === undefined) epubFailure(ctx, key, "Missing EPUB note target");
      const original = {position: position!};
      await ast.walk(original, async (node, _depth, done) => {
        if (done) return;
        ctx.checkpoint(); ctx.charge("nodes", 1);
        if (await ast.kind(node) === "string") ctx.charge("retainedBytes", (await ast.range(node)).units * 2);
        const tag = await ast.name(node);
        if (tag) {ctx.charge("nodes", 1); ctx.charge("retainedBytes", tag.length * 2);}
      });
      const copy = await ast.clone(original);
      const hash = key.indexOf("#"), source = decodeURIComponent(hash < 0 ? key : key.slice(0, hash));
      const provenance = await ast.value(["", [], [["data-epub-source", source]]]);
      await ast.replaceTag(value, "Note", await ast.value([await ast.tag("Div", await ast.value([provenance, copy]))]));
      await active.set(key, 1);
      await exits.set(BigInt(value.position), BigInt((await ast.value(key)).position));
      await this.referenced.add(key);
      // The old reader expands the copied prose at depth + 1 before adding
      // provenance wrappers. Preserve that depth-limit behavior.
      return {descend: copy};
    });
  }
  async prune(root: RtfValue): Promise<void> {
    const {ast} = this;
    await ast.walk(root, async (value, _depth, leaving) => {
      if (leaving) return;
      const tag = await ast.name(value);
      if (tag === "Note") return false;
      if (tag !== "Div") return;
      const content = (await ast.content(value))!, attrs = (await ast.at(content, 0))!;
      const id = await this.text((await ast.edge(attrs))!);
      if (await this.referenced.has(id)) {await ast.set(content, 1, await ast.array()); return false;}
    });
  }
}
