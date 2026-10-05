import type { PagedStorage } from "@poe-code/safe-fs/storage";
import type { TextStore } from "safe-bash-command-html-to-markdown/stored-text";
import { HtmlBudget, type HtmlOptions, type HtmlNamespace, type HtmlNode } from "./contracts.js";
import { DocumentStore, StoredSequence } from "./document-store.js";
import { decodedHtml } from "./tree.js";
import { StoredHtmlTokenizer, StoredNames, type StoredHtmlToken } from "./stored-tokenizer.js";
import { lowerStoredName } from "./stored-name.js";
import { StoredQueries } from "./stored-selectors.js";
import { rawElements, voidElements } from "./tokenizer.js";
import { htmlSpace } from "./entities.js";
import { formatting, blocks, headElements, tableAllowedElements, headingElements, htmlScopeBarriers, mathmlScopeBarriers, svgScopeBarriers, specialHtmlElements, captionBreakingElements, tableCloseElements, endScopeExtraElements, svgNames, svgAttributes } from "./tree-rules.js";
/** Recovery uses stored node identities and stored open/formatting sequences.
 * Token framing is still shared with the incremental compatibility tokenizer. */
export async function parseStoredHtml(source: AsyncIterable<Uint8Array>, tree: DocumentStore, strings: TextStore, storage: PagedStorage, options: HtmlOptions): Promise<number> {
    const budget = new HtmlBudget(options);
    async function* normalized(): AsyncGenerator<string> {
        let first = true, carriage = false;
        for await (const original of decodedHtml(source, options)) {
            let result = "";
            for (const c of original) {
                budget.charge("work", 1);
                if (first) {
                    first = false;
                    if (c === "\ufeff")
                        continue;
                }
                if (carriage && c === "\n") {
                    carriage = false;
                    continue;
                }
                carriage = c === "\r";
                result += carriage ? "\n" : c;
            }
            yield result;
        }
    }
    const tokenizer = new StoredHtmlTokenizer(normalized(), budget, tree, strings, storage);
    let result = 0, failure: {
        error: unknown;
    } | undefined;
    try {
        result = await buildStoredTree(tree, strings, storage, tokenizer, budget);
    }
    catch (error) {
        failure = { error };
    }
    try {
        await tokenizer.close();
    }
    catch (error) {
        if (failure)
            throw new AggregateError([failure.error, error], "HTML parsing and input cleanup failed");
        throw error;
    }
    if (failure)
        throw failure.error;
    return result;
}
async function buildStoredTree(tree: DocumentStore, strings: TextStore, storage: PagedStorage, tokenizer: StoredHtmlTokenizer, budget: HtmlBudget): Promise<number> {
    const queries = new StoredQueries(tree, strings, storage, budget);
    const whitespacePrefix = async (root: number): Promise<number> => {
        let offset = 0;
        for await (const chunk of strings.chunks(root)) {
            budget.charge("work", chunk.length);
            for (const c of chunk) { if (!htmlSpace(c)) return offset; offset++; }
        }
        return offset;
    };
    const allSpace = async (root: number): Promise<boolean> => await whitespacePrefix(root) === (await strings.info(root)).length;
    const labels = new Map<number, string>();
    const names = new Map<string, number>();
    const value = async (id: number): Promise<string> => {
        const cached = labels.get(id);
        if (cached !== undefined) return cached;
        if ((await strings.info(id)).length > 64) return "";
        let value = "";
        for await (const chunk of strings.chunks(id)) value += chunk;
        if (value.length <= 64) {
            if (labels.size === 256) labels.delete(labels.keys().next().value!);
            labels.set(id, value);
        }
        return value;
    };
    const nameRef = async (name: string): Promise<number> => {
        const cached = names.get(name);
        if (cached !== undefined) return cached;
        const id = await strings.from(name);
        if (name.length <= 64) {
            if (names.size === 256) names.delete(names.keys().next().value!);
            names.set(name, id);
            if (labels.size === 256) labels.delete(labels.keys().next().value!);
            labels.set(id, name);
        }
        return id;
    };
    const meta = async (id: number) => { const node = await tree.read(id); return { ...node, name: await value(node.name) }; };
    const make = async (kind: HtmlNode["kind"], name: string | number = "", data: string | number = "", namespace: HtmlNamespace = "html"): Promise<number> => {
        budget.charge("nodes", 1);
        const nameId = typeof name === "string" ? await nameRef(name) : name;
        const dataId = typeof data === "string" ? await strings.from(data) : data;
        budget.charge("retainedBytes", 128 + ((await strings.info(nameId)).length + (await strings.info(dataId)).length) * 2);
        return tree.create(kind, { name: nameId, data: dataId, namespace });
    };
    const append = async (parent: number, node: number, before = 0): Promise<void> => {
        const previous = (await tree.read(node)).parent;
        budget.charge("work", (previous ? (await tree.read(previous)).childCount : 0) + (before ? (await tree.read(parent)).childCount : 1));
        await tree.attach(parent, node, before);
    };
    const document = await make("document"), html = await make("element", "html"), head = await make("element", "head"), body = await make("element", "body");
    await append(document, html);
    await append(html, head);
    await append(html, body);
    const stack = new StoredSequence(storage), active = new StoredSequence(storage);
    await stack.push(html);
    let form = 0;
    let mode: "beforeHead" | "head" | "body" = "beforeHead";
    const current = async (): Promise<number> => (await stack.get(stack.length - 1))!;
    const target = async (node?: number): Promise<number> => { node ??= await current(); return (await tree.read(node)).templateContents || node; };
    const push = async (node: number): Promise<void> => { budget.bound("depth", stack.length + 1); await stack.push(node); };
    const find = async (name: string): Promise<number> => {
        for (let i = stack.length - 1; i >= 0; i--) {
            budget.charge("work", 1);
            if ((await meta((await stack.get(i))!)).name.toLowerCase() === name)
                return i;
        }
        return -1;
    };
    const pop = async (name: string): Promise<void> => { const i = await find(name); if (i > 0)
        await stack.truncate(i); };
    const inScope = async (names: readonly string[], extra: readonly string[] = []): Promise<number> => {
        for (let i = stack.length - 1; i >= 0; i--) {
            budget.charge("work", 1);
            const node = await meta((await stack.get(i))!);
            if (node.namespace === "html" && names.includes(node.name))
                return i;
            if (node.namespace === "html" && (htmlScopeBarriers.has(node.name) || extra.includes(node.name)) || node.namespace === "mathml" && mathmlScopeBarriers.has(node.name) || node.namespace === "svg" && svgScopeBarriers.has(node.name))
                return -1;
        }
        return -1;
    };
    const headings = ["h1", "h2", "h3", "h4", "h5", "h6"];
    const clearFormatting = async (): Promise<void> => { while (active.length) {
        budget.charge("work", 1);
        if (await active.pop() === 0)
            break;
    } };
    const closeCell = async (): Promise<void> => { const index = await inScope(["td", "th"]); if (index > 0) {
        await stack.truncate(index);
        await clearFormatting();
    } };
    const setAttributes = async (node: number, attributes: number): Promise<void> => {
        const source = await tree.read(attributes);
        await tree.patch(node, { firstAttribute: source.firstAttribute, lastAttribute: source.lastAttribute, attributeCount: source.attributeCount });
    };
    const mergeAttributes = async (node: number, attributes: number): Promise<void> => {
        const names = new StoredNames(storage, strings, queries);
        for await (const old of tree.attributes(node)) await names.add(old.name);
        for await (const a of tree.attributes(attributes)) {
            if (await names.add(a.name)) {
                budget.charge("retainedBytes", 64 + ((await strings.info(a.name)).length + (await strings.info(a.value)).length) * 2);
                await tree.attribute(node, a.name, a.value, a.namespace);
            }
        }
    };
    const clone = async (node: number): Promise<number> => {
        const original = await tree.read(node);
        budget.charge("nodes", 1);
        budget.charge("retainedBytes", 128 + (await strings.info(original.name)).length * 2);
        budget.charge("attributes", original.attributeCount);
        for await (const a of tree.attributes(node))
            budget.charge("retainedBytes", 64 + ((await strings.info(a.name)).length + (await strings.info(a.value)).length) * 2);
        return tree.clone(node);
    };
    const reconstruct = async (): Promise<void> => {
        for (let i = await active.indexOf(0, true) + 1; i < active.length; i++) {
            budget.charge("work", stack.length + 1);
            const a = (await active.get(i))!;
            if (await stack.indexOf(a) < 0) {
                const n = await clone(a);
                await append(await target(), n);
                await push(n);
                await active.set(i, n);
            }
        }
    };
    const location = async (): Promise<[
        number,
        number?
    ]> => {
        const name = (await meta(await current())).name;
        if (["table", "tbody", "thead", "tfoot", "tr"].includes(name)) {
            const table = await stack.get(await find("table"));
            if (table) {
                const parent = (await tree.read(table)).parent;
                if (parent)
                    return [parent, table];
            }
        }
        return [await target()];
    };
    const special = async (id: number): Promise<boolean> => { const node = await meta(id); return node.namespace !== "html" || blocks.has(node.name) || specialHtmlElements.has(node.name); };
    const adopt = async (name: string): Promise<void> => {
        for (let outer = 0; outer < 8; outer++) {
            budget.charge("work", stack.length + active.length);
            let at = -1;
            for (let i = active.length - 1; i >= 0; i--) {
                const node = (await active.get(i))!;
                if (!node)
                    break;
                if ((await meta(node)).name === name) {
                    at = i;
                    break;
                }
            }
            if (at < 0) {
                await pop(name);
                return;
            }
            const fmt = (await active.get(at))!, index = await stack.indexOf(fmt);
            if (index < 0) {
                await active.splice(at, 1);
                return;
            }
            let blockIndex = -1;
            for (let i = index + 1; i < stack.length; i++)
                if (await special((await stack.get(i))!)) {
                    blockIndex = i;
                    break;
                }
            if (blockIndex < 0) {
                await stack.truncate(index);
                await active.splice(at, 1);
                return;
            }
            const block = (await stack.get(blockIndex))!, ancestor = (await stack.get(index - 1))!;
            let bookmark = at, last = block, cursor = blockIndex;
            for (let inner = 1; cursor > index; inner++) {
                budget.charge("work", stack.length + active.length);
                cursor--;
                const node = (await stack.get(cursor))!;
                if (node === fmt)
                    break;
                let activeIndex = await active.indexOf(node);
                if (inner > 3 && activeIndex >= 0) {
                    await active.splice(activeIndex, 1);
                    if (activeIndex < bookmark)
                        bookmark--;
                    activeIndex = -1;
                }
                if (activeIndex < 0) {
                    await stack.splice(cursor, 1);
                    continue;
                }
                const replacement = await clone(node);
                await stack.set(cursor, replacement);
                await active.set(activeIndex, replacement);
                if (last === block)
                    bookmark = activeIndex + 1;
                await append(replacement, last);
                last = replacement;
            }
            if (["table", "tbody", "tfoot", "thead", "tr"].includes((await meta(ancestor)).name)) {
                const table = await stack.get(await find("table")), parent = table ? (await tree.read(table)).parent : 0;
                if (table && parent)
                    await append(parent, last, table);
                else
                    await append(await target(ancestor), last);
            }
            else
                await append(await target(ancestor), last);
            const replacement = await clone(fmt);
            while ((await tree.read(block)).first)
                await append(replacement, (await tree.read(block)).first);
            await append(block, replacement);
            const old = await active.indexOf(fmt);
            await active.splice(old, 1);
            if (old < bookmark)
                bookmark--;
            await active.splice(bookmark, 0, replacement);
            await stack.splice(await stack.indexOf(fmt), 1);
            await stack.splice(await stack.indexOf(block) + 1, 0, replacement);
        }
    };
    const text = async (data: number): Promise<void> => {
        if (!data)
            return;
        await reconstruct();
        const [parent, before] = await allSpace(data) ? [await target(), undefined] : await location();
        const last = before ? (await tree.read(before)).previous : (await tree.read(parent)).last;
        if (last && (await tree.read(last)).kind === "text") {
            budget.charge("retainedBytes", (await strings.info(data)).length * 2);
            await tree.patch(last, { data: await strings.concat((await tree.read(last)).data, data) });
        }
        else
            await append(parent!, await make("text", "", data), before);
    };
    const integration = async (node: number): Promise<boolean> => {
        for await (const a of tree.attributes(node))
            if (await value(a.name) === "encoding" && ["text/html", "application/xhtml+xml"].includes((await value(a.value)).toLowerCase()))
                return true;
        return false;
    };
    const activeAnchor = async (): Promise<boolean> => {
        for (let i = await active.indexOf(0, true) + 1; i < active.length; i++)
            if ((await meta((await active.get(i))!)).name === "a")
                return true;
        return false;
    };
    for (;;) {
        const top = await meta(await current());
        const raw = top.namespace === "html" && (rawElements.has(top.name) || top.name === "title" || top.name === "textarea") ? top.name : undefined;
        const token = await tokenizer.next(raw, top.namespace !== "html");
        if (!token)
            break;
        budget.charge("work", stack.length + active.length + 1);
        if (token.kind === "doctype") {
            if (mode === "beforeHead")
                await append(document, await make("doctype", "", token.data), html);
            continue;
        }
        if (token.kind === "comment") {
            await append(mode === "beforeHead" ? document : await target(), await make("comment", "", token.data), mode === "beforeHead" ? html : undefined);
            continue;
        }
        if (token.kind === "text") {
            if (mode === "beforeHead") {
                if (await allSpace(token.data))
                    continue;
                mode = "body";
                await stack.push(body);
            }
            if (mode === "head" && await current() === head && !await allSpace(token.data)) {
                mode = "body";
                await stack.truncate(1);
                await stack.push(body);
            }
            let data = token.data;
            if ((await meta(await current())).name === "colgroup" && !await allSpace(data)) {
                const prefix = await whitespacePrefix(data);
                if (prefix) await text(await strings.slice(data, 0, prefix));
                data = await strings.slice(data, prefix);
                await stack.pop();
            }
            if (((await meta(await current())).name === "pre" ||
                (await meta(await current())).name === "textarea" ||
                (await meta(await current())).name === "listing") &&
                (await tree.read(await current())).childCount === 0 &&
                await strings.at(data, 0) === "\n")
                data = await strings.slice(data, 1);
            await text(data);
            continue;
        }
        let t = token as Extract<StoredHtmlToken, {
            name: number;
        }>;
        const name = await value(t.name);
        if ((await meta(await current())).namespace === "html" && (await meta(await current())).name === "colgroup" &&
            name !== "col" && name !== "template" && name !== "colgroup")
            await stack.pop();
        if (t.kind === "start" && captionBreakingElements.has(name)) {
            const caption = await inScope(["caption"]);
            if (caption > 0) {
                await stack.truncate(caption);
                await clearFormatting();
            }
        }
        if (await find("select") >= 0 &&
            !["option", "optgroup", "select", "script", "template"].includes(name)) {
            if (["input", "keygen", "textarea"].includes(name) && t.kind === "start")
                await pop("select");
            else
                continue;
        }
        if (t.kind === "start" && name === "select" && await find("select") >= 0) {
            await pop("select");
            continue;
        }
        if (t.kind === "start" && name === "html") {
            await mergeAttributes(html, t.attributes);
            continue;
        }
        if (t.kind === "start" && name === "head" && mode === "beforeHead") {
            mode = "head";
            await stack.push(head);
            await setAttributes(head, t.attributes);
            continue;
        }
        if (name === "head" && mode !== "beforeHead" && !(t.kind === "end" && mode === "head"))
            continue;
        if (t.kind === "end" && name === "head") {
            await stack.truncate(1);
            mode = "body";
            await stack.push(body);
            continue;
        }
        if (mode === "beforeHead") {
            if (t.kind === "start" && headElements.has(name)) {
                mode = "head";
                await stack.push(head);
            }
            else {
                mode = "body";
                await stack.push(body);
            }
        }
        if (mode === "head" && await current() === head && t.kind === "start" && !headElements.has(name)) {
            await stack.truncate(1);
            await stack.push(body);
            mode = "body";
        }
        if (t.kind === "start" && name === "body") {
            await mergeAttributes(body, t.attributes);
            continue;
        }
        if (t.kind === "end" && name === "br" && (await meta(await current())).namespace === "html")
            t = { ...t, kind: "start" };
        if (t.kind === "end") {
            if (name === "body" || name === "html")
                continue;
            if (tableCloseElements.has(name)) {
                if (await find(name) >= 0) {
                    await closeCell();
                    if (name !== "td" && name !== "th")
                        await pop(name);
                }
                continue;
            }
            if (name === "form" && await find("template") < 0) {
                const node = form;
                form = 0;
                const index = node ? await inScope(["form"]) : -1;
                if (index > 0 && (await stack.get(index)) === node)
                    await stack.splice(index, 1);
                continue;
            }
            if (name === "caption") {
                const index = await inScope(["caption"]);
                if (index > 0) {
                    await stack.truncate(index);
                    await clearFormatting();
                }
                continue;
            }
            if (formatting.has(name)) {
                await adopt(name);
                continue;
            }
            if (name === "template") {
                await pop(name);
                await clearFormatting();
                continue;
            }
            if (name === "p" && await inScope(["p"], ["button"]) < 0) {
                const p = await make("element", "p");
                await append(await target(), p);
                continue;
            }
            if (headingElements.has(name)) {
                const index = await inScope(headings);
                if (index > 0)
                    await stack.truncate(index);
                continue;
            }
            if (blocks.has(name) || endScopeExtraElements.has(name)) {
                const index = await inScope([name], name === "li" ? ["ol", "ul"] : name === "p" ? ["button"] : []);
                if (index > 0)
                    await stack.truncate(index);
            }
            else {
                for (let i = stack.length - 1; i > 0; i--) {
                    budget.charge("work", 1);
                    if (await queries.equal(await lowerStoredName(strings, (await tree.read((await stack.get(i))!)).name, budget), t.name)) {
                        await stack.truncate(i);
                        break;
                    }
                    if (await special((await stack.get(i))!))
                        break;
                }
            }
            continue;
        }
        let ns: HtmlNamespace = (await meta(await current())).namespace;
        if ((ns === "svg" && ["foreignObject", "desc", "title"].includes((await meta(await current())).name)) ||
            (ns === "mathml" &&
                ["mi", "mo", "mn", "ms", "mtext"].includes((await meta(await current())).name) &&
                name !== "mglyph" &&
                name !== "malignmark") ||
            (ns === "mathml" &&
                (await meta(await current())).name === "annotation-xml" && await integration(await current())))
            ns = "html";
        if (ns !== "html" &&
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
            ].includes(name)) {
            while ((await meta(await current())).namespace !== "html")
                await stack.pop();
            ns = "html";
        }
        if (name === "svg")
            ns = "svg";
        if (name === "math")
            ns = "mathml";
        if (ns === "html") {
            if (["caption", "col", "colgroup", "tbody", "td", "tfoot", "th", "thead", "tr"].includes(name) &&
                await find("table") < 0 && await find("template") < 0)
                continue;
            if (name === "form" && form && await find("template") < 0)
                continue;
            if (blocks.has(name) || name === "table" || name === "hr") {
                const index = await inScope(["p"], ["button"]);
                if (index > 0)
                    await stack.truncate(index);
            }
            if (name === "li") {
                const index = await inScope(["li"], ["ol", "ul"]);
                if (index > 0)
                    await stack.truncate(index);
            }
            if (headingElements.has(name) && headingElements.has((await meta(await current())).name))
                await stack.pop();
            if (name === "button") {
                const index = await inScope(["button"]);
                if (index > 0)
                    await stack.truncate(index);
                await reconstruct();
            }
            if (name === "dt" || name === "dd") {
                await pop("dt");
                await pop("dd");
            }
            if (name === "option")
                await pop("option");
            if (name === "optgroup") {
                if ((await meta(await current())).name === "option")
                    await stack.pop();
                if ((await meta(await current())).name === "optgroup")
                    await stack.pop();
            }
            if (name === "tr") {
                await closeCell();
                await pop("tr");
                if ((await meta(await current())).name === "table") {
                    const section = await make("element", "tbody");
                    await append(await target(), section);
                    await push(section);
                }
            }
            if (name === "td" || name === "th") {
                await closeCell();
                if ((await meta(await current())).name === "table") {
                    const section = await make("element", "tbody");
                    await append(await target(), section);
                    await push(section);
                }
                if (["tbody", "thead", "tfoot"].includes((await meta(await current())).name)) {
                    const row = await make("element", "tr");
                    await append(await target(), row);
                    await push(row);
                }
            }
            if (name === "tbody" || name === "thead" || name === "tfoot") {
                await closeCell();
                await pop("tr");
                if (["tbody", "thead", "tfoot"].includes((await meta(await current())).name))
                    await stack.pop();
            }
            if (name === "col" && (await meta(await current())).name === "table") {
                const group = await make("element", "colgroup");
                await append(await target(), group);
                await push(group);
            }
            if (name === "a" && await activeAnchor())
                await adopt("a");
            if (formatting.has(name))
                await reconstruct();
        }
        const node = await make("element", ns === "svg" ? (svgNames[name] ?? t.name) : t.name, "", ns);
        const attributes = t.attributes;
        for await (const a of tree.attributes(attributes)) {
            budget.charge("retainedBytes", 64 + ((await strings.info(a.name)).length + (await strings.info(a.value)).length) * 2);
            if (ns !== "html") {
                const label = await value(a.name);
                const adjusted = ns === "svg" ? svgAttributes[label] : label === "definitionurl" ? "definitionURL" : undefined;
                let namespace = a.namespace;
                for (const prefix of ["xml", "xmlns", "xlink"] as const)
                    if (await queries.literal(a.name, prefix + ":", false, true)) namespace = prefix;
                if (label === "xmlns") namespace = "xmlns";
                await tree.patchAttribute(a.id, adjusted ? await nameRef(adjusted) : a.name, namespace);
            }
        }
        await setAttributes(node, attributes);
        const [parent, before] = ns === "html" && !tableAllowedElements.has(name) ? await location() : [await target(), undefined];
        await append(parent, node, before);
        if (name === "form" && ns === "html" && await find("template") < 0)
            form = node;
        if (["caption", "td", "th"].includes(name) && ns === "html")
            await active.push(0);
        if (name === "template" && ns === "html") {
            await tree.patch(node, { templateContents: await make("fragment") });
            await active.push(0);
        }
        if ((ns === "html" && voidElements.has(name)) || (ns !== "html" && t.selfClosing))
            continue;
        await push(node);
        if (ns === "html" && formatting.has(name))
            await active.push(node);
    }
    return document;
}
