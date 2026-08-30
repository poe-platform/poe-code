import { Builder } from "./budget.js";
import { destination, escapeText } from "./entities.js";
import { blockTags } from "./parser.js";
import { htmlSpace, normalizeText, trimText } from "./text.js";
const format = (tag) => tag === "em" || tag === "i" ? "em" : tag === "strong" || tag === "b" ? "strong" : tag === "del" || tag === "s" ? "del" : undefined;
const inlineAtoms = new Set(["a", "img", "code", "br"]);
export class Renderer {
    budget;
    normalized = new WeakMap();
    destinations = new WeakMap();
    whitespace = new WeakMap();
    constructor(budget) {
        this.budget = budget;
    }
    trim(text) { return trimText(text, this.budget); }
    space(text, maximum) { return normalizeText(text, this.budget, "space", maximum); }
    async language(text) {
        let start = 0;
        for (let offset = 0; offset <= text.length; offset++) {
            this.budget.work(1);
            if (offset === text.length || /\s/u.test(text[offset])) {
                if (offset - start <= 41) {
                    const match = /^language-([A-Za-z0-9_+-]{1,32})$/u.exec(text.slice(start, offset));
                    if (match)
                        return match[1];
                }
                start = offset + 1;
            }
            await this.budget.checkpoint();
        }
        return "";
    }
    async nonSpace(text) {
        for (const character of text) {
            this.budget.work(1);
            if (character !== " ")
                return true;
            await this.budget.checkpoint();
        }
        return false;
    }
    async onlyWhitespace(children) {
        for (const child of children) {
            this.budget.work(1);
            await this.budget.checkpoint();
            if (child.tag !== "text")
                return false;
            let whitespace = this.whitespace.get(child);
            if (whitespace === undefined) {
                whitespace = true;
                for (const character of child.text) {
                    this.budget.work(1);
                    await this.budget.checkpoint();
                    if (!htmlSpace(character)) {
                        whitespace = false;
                        break;
                    }
                }
                this.budget.work(1);
                this.whitespace.set(child, whitespace);
            }
            if (!whitespace)
                return false;
        }
        return true;
    }
    async hasRawContent(node) {
        for (const child of node.children) {
            this.budget.work(1);
            await this.budget.checkpoint();
            if (child.tag === "text" ? Boolean(child.text) : child.tag === "br" || await this.hasRawContent(child))
                return true;
        }
        return false;
    }
    async inlineChildren(node) {
        this.budget.work(1);
        const cached = this.normalized.get(node);
        if (cached)
            return cached;
        this.budget.work(1);
        const result = [];
        const append = async (child, target = result) => {
            this.budget.work(1);
            await this.budget.checkpoint();
            const style = format(child.tag);
            const previous = target.at(-1);
            if (style && previous && format(previous.tag) === style) {
                for (const nested of child.children)
                    await append(nested, previous.children);
            }
            else
                target.push(child);
        };
        const visit = async (child) => {
            this.budget.work(1);
            await this.budget.checkpoint();
            if (child.tag === "text" && !child.text)
                return;
            if (child.tag === "code" && !await this.hasRawContent(child))
                return;
            if (child.tag === "a" || child.tag === "img") {
                const image = child.tag === "img";
                const url = await destination(child.attributes.get(image ? "src" : "href"), image, this.budget);
                if (!url) {
                    if (!image)
                        for (const nested of child.children)
                            await visit(nested);
                    else {
                        const text = child.attributes.get("alt");
                        if (text) {
                            this.budget.work(2);
                            await append({ tag: "text", attributes: child.attributes, children: [], text });
                        }
                    }
                    return;
                }
                this.budget.work(1);
                this.destinations.set(child, url);
            }
            const style = format(child.tag);
            if (child.tag !== "text" && !blockTags.has(child.tag) && !inlineAtoms.has(child.tag)) {
                if (!style || style === format(node.tag)) {
                    for (const nested of child.children)
                        await visit(nested);
                    return;
                }
                const children = await this.inlineChildren(child);
                if (!children.length)
                    return;
                if (await this.onlyWhitespace(children)) {
                    for (const nested of children)
                        await append(nested);
                    return;
                }
                this.budget.work(2);
                const normalized = { tag: child.tag, attributes: child.attributes, children };
                this.normalized.set(normalized, children);
                await append(normalized);
            }
            else
                await append(child);
        };
        for (const child of node.children)
            await visit(child);
        this.budget.work(1);
        this.normalized.set(node, result);
        return result;
    }
    async punctuationBoundary(node, ending) {
        if (!node || !format(node.tag))
            return false;
        const edge = async (parent) => {
            for (let step = 0; step < parent.children.length; step++) {
                this.budget.work(1);
                await this.budget.checkpoint();
                const child = parent.children[ending ? parent.children.length - 1 - step : step];
                if (child.tag === "text") {
                    if (child.text)
                        return ending ? Array.from(child.text.slice(-2)).at(-1) : String.fromCodePoint(child.text.codePointAt(0));
                }
                else if (child.tag === "br" || blockTags.has(child.tag))
                    return " ";
                else if (format(child.tag) || inlineAtoms.has(child.tag))
                    return "*";
                else {
                    const nested = await edge(child);
                    if (nested !== undefined)
                        return nested;
                }
            }
            return undefined;
        };
        const character = await edge(node);
        return character !== undefined && /[\p{P}\p{S}]/u.test(character);
    }
    async raw(node, maximum) {
        const result = new Builder(this.budget, maximum);
        for (const child of node.children) {
            this.budget.work(1);
            await this.budget.checkpoint();
            if (child.tag === "text")
                result.append(child.text);
            else if (child.tag === "br")
                result.append("\n");
            else
                result.append(await this.raw(child, maximum));
        }
        return result.finish();
    }
    async fence(text, minimum) {
        let longest = 0, current = 0;
        for (let offset = 0; offset < text.length; offset++) {
            this.budget.work(1);
            current = text[offset] === "`" ? current + 1 : 0;
            longest = Math.max(longest, current);
            if (offset % 4096 === 0)
                await this.budget.checkpoint();
        }
        const size = Math.max(minimum, longest + 1);
        this.budget.check(size, this.budget.limits.maxOutputBytes - this.budget.output, "code fence");
        this.budget.work(size);
        return "`".repeat(size);
    }
    async children(node, maximum = this.budget.limits.maxOutputBytes - this.budget.output) {
        const result = new Builder(this.budget, maximum);
        const children = await this.inlineChildren(node);
        const alternate = (index) => format(node.tag) === "em" || format(children[index - 1]?.tag ?? "") === "em" || format(children[index + 1]?.tag ?? "") === "em";
        const separate = async (index, ending) => format(children[index]?.tag ?? "") === "strong" && alternate(index) || await this.punctuationBoundary(children[index], ending);
        for (let index = 0; index < children.length; index++) {
            const child = children[index];
            this.budget.work(1);
            await this.budget.checkpoint();
            const block = blockTags.has(child.tag);
            if (block)
                result.separate();
            const edges = [await separate(index - 1, true), await separate(index + 1, false)];
            const precedingDigit = children[index - 1]?.tag === "text" && /[0-9]/u.test(children[index - 1]?.text?.at(-1) ?? "");
            let rendered = await this.node(child, maximum, edges, alternate(index), precedingDigit);
            if (child.tag === "text" && result.blockBoundary && (!result.empty || node.tag === "root" || blockTags.has(node.tag)) && rendered.startsWith(" "))
                rendered = rendered.slice(1);
            if (child.tag !== "br" && result.trailingSpace && rendered.startsWith(" "))
                rendered = rendered.slice(1);
            result.append(rendered);
            if (block)
                result.separate();
        }
        return result.finish();
    }
    async list(node, maximum) {
        const result = new Builder(this.budget, maximum);
        const start = node.attributes.get("start") ?? "1";
        let ordinal = /^\d{1,9}$/u.test(start) ? Math.max(1, Number(start)) : 1;
        for (const child of node.children) {
            this.budget.work(1);
            await this.budget.checkpoint();
            if (child.tag !== "li") {
                const extra = await this.trim(await this.node(child, maximum));
                if (extra) {
                    result.append(extra);
                    result.append("\n");
                }
                continue;
            }
            const content = await this.trim(await this.children(child, maximum));
            const marker = node.tag === "ol" ? `${ordinal++}. ` : "- ";
            this.budget.check(marker.length, maximum, "list indentation");
            const parts = content.split("\n");
            result.append(marker);
            result.append(parts[0] ?? "");
            for (const part of parts.slice(1)) {
                this.budget.work(1);
                await this.budget.checkpoint();
                result.append("\n");
                if (part) {
                    result.append(" ".repeat(marker.length));
                    result.append(part);
                }
            }
            result.append("\n");
        }
        return result.finish().replace(/\n$/u, "");
    }
    async table(node, maximum) {
        const rows = [];
        const extra = new Builder(this.budget, maximum);
        const visit = async (entry) => {
            this.budget.work(1);
            await this.budget.checkpoint();
            if (entry.tag === "tr") {
                const cells = [];
                for (const child of entry.children) {
                    if (child.tag === "td" || child.tag === "th") {
                        this.budget.add("cells");
                        cells.push(child);
                    }
                    else {
                        const text = await this.trim(await this.node(child, maximum));
                        if (text) {
                            extra.append(text);
                            extra.append(" ");
                        }
                    }
                }
                if (cells.length)
                    rows.push(cells);
            }
            else if (entry.tag === "text")
                extra.append(await escapeText(await this.space(entry.text, maximum), this.budget, maximum));
            else
                for (const child of entry.children)
                    await visit(child);
        };
        await visit(node);
        const result = new Builder(this.budget, maximum);
        const loose = await this.trim(extra.finish());
        if (loose) {
            result.append(loose);
            result.separate();
        }
        if (!rows.length)
            return result.finish();
        const width = rows.reduce((largest, row) => Math.max(largest, row.length), 0);
        const header = rows[0].some(cell => cell.tag === "th");
        const renderRow = async (row) => {
            this.budget.add("cells", width - row.length);
            result.append("| ");
            for (let index = 0; index < width; index++) {
                if (index)
                    result.append(" | ");
                const cell = row[index];
                if (!cell)
                    continue;
                const content = await this.trim(await this.space(await this.children(cell, Math.min(maximum, this.budget.limits.maxTableCellBytes))));
                const escaped = new Builder(this.budget, this.budget.limits.maxTableCellBytes);
                let backslashes = 0;
                for (const character of content) {
                    this.budget.work(1);
                    escaped.append(character === "|" && backslashes % 2 === 0 ? "\\|" : character);
                    backslashes = character === "\\" ? backslashes + 1 : 0;
                    await this.budget.checkpoint();
                }
                result.append(escaped.finish());
            }
            result.append(" |\n");
        };
        if (header)
            await renderRow(rows[0]);
        else
            await renderRow([]);
        result.append("|");
        for (let index = 0; index < width; index++) {
            this.budget.work(1);
            result.append(" --- |");
            await this.budget.checkpoint();
        }
        result.append("\n");
        for (const row of rows.slice(header ? 1 : 0))
            await renderRow(row);
        return result.finish().replace(/\n$/u, "");
    }
    async node(node, maximum, edges = [false, false], alternateStrong = false, precedingDigit = false) {
        if (node.tag === "text")
            return escapeText(await this.space(node.text, maximum), this.budget, maximum, edges, precedingDigit);
        if (node.tag === "br")
            return "  \n";
        if (node.tag === "hr")
            return "---";
        if (node.tag === "pre" || node.tag === "code") {
            const raw = await normalizeText(await this.raw(node, maximum), this.budget, "lines", maximum);
            const result = new Builder(this.budget, maximum);
            if (node.tag === "pre") {
                const fence = await this.fence(raw, 3);
                const code = node.children.find(child => child.tag === "code");
                const language = await this.language(code?.attributes.get("class") ?? "");
                result.append(fence);
                result.append(language);
                result.append("\n");
                result.append(raw);
                if (!raw.endsWith("\n"))
                    result.append("\n");
                result.append(fence);
            }
            else {
                const inline = await normalizeText(raw, this.budget, "inline", maximum);
                if (!inline)
                    return "";
                const fence = await this.fence(inline, 1);
                const pad = inline.startsWith("`") || inline.endsWith("`") || inline.startsWith(" ") && inline.endsWith(" ") && await this.nonSpace(inline);
                result.append(fence);
                if (pad)
                    result.append(" ");
                result.append(inline);
                if (pad)
                    result.append(" ");
                result.append(fence);
            }
            return result.finish();
        }
        if (node.tag === "ul" || node.tag === "ol")
            return this.list(node, maximum);
        if (node.tag === "table")
            return this.table(node, maximum);
        const content = await this.children(node, maximum);
        const result = new Builder(this.budget, maximum);
        if (/^h[1-6]$/u.test(node.tag)) {
            result.append("#".repeat(Number(node.tag[1])));
            result.append(" ");
            result.append(await this.trim(await this.space(content, maximum)));
        }
        else if (node.tag === "em" || node.tag === "i" || node.tag === "strong" || node.tag === "b" || node.tag === "del" || node.tag === "s") {
            const trimmed = await this.trim(content);
            const marker = node.tag === "em" || node.tag === "i" ? "*" : node.tag === "del" || node.tag === "s" ? "~~" : alternateStrong && trimmed === content ? "__" : "**";
            if (!trimmed || content.includes("\n\n"))
                return content;
            if (htmlSpace(content[0]))
                result.append(" ");
            result.append(marker);
            result.append(trimmed);
            result.append(marker);
            if (htmlSpace(content.at(-1)))
                result.append(" ");
        }
        else if (node.tag === "a" || node.tag === "img") {
            const image = node.tag === "img";
            const label = image ? await escapeText(await this.space(node.attributes.get("alt") ?? "", maximum), this.budget, maximum) : await this.trim(content);
            const url = this.destinations.has(node) ? this.destinations.get(node) : await destination(node.attributes.get(image ? "src" : "href"), image, this.budget);
            if (!url)
                return image ? label : content;
            if (!image && htmlSpace(content[0]))
                result.append(" ");
            result.append(image ? "![" : "[");
            result.append(label);
            result.append("](<");
            result.append(url);
            result.append(">)");
            if (!image && htmlSpace(content.at(-1)))
                result.append(" ");
        }
        else if (node.tag === "blockquote") {
            const parts = (await this.trim(content)).split("\n");
            for (let index = 0; index < parts.length; index++) {
                this.budget.work(1);
                await this.budget.checkpoint();
                if (index)
                    result.append("\n");
                result.append(parts[index] ? "> " : ">");
                result.append(parts[index]);
            }
        }
        else
            result.append(content);
        return result.finish();
    }
    async document(root) {
        const output = await this.trim(await this.children(root));
        if (!output)
            return "";
        const result = new Builder(this.budget);
        result.append(output);
        result.append("\n");
        return result.finish();
    }
}
//# sourceMappingURL=render.js.map