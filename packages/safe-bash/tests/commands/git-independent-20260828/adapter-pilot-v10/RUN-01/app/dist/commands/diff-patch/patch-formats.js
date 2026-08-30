import { Budget, ToolError, integer } from "./shared.js";
import { parseUnified, parseUnifiedSection } from "./unified.js";
import { decodeHeaderPath } from "./patch-path.js";
class Reader {
    budget;
    lines;
    index = 0;
    constructor(text, budget) {
        this.budget = budget;
        this.lines = budget.split(text).map(line => line.slice(0, -1));
    }
    peek() { return this.lines[this.index]; }
    async take() {
        this.budget.step();
        await this.budget.checkpoint();
        const line = this.lines[this.index++];
        if (line === undefined)
            throw new ToolError("truncated patch");
        return line;
    }
    number(value) {
        const result = integer(value, "patch range");
        if (result > this.budget.limits.maxLines)
            throw new ToolError("hunk coordinate exceeds line limit");
        return result;
    }
    async content(prefix) {
        const line = await this.take();
        if (line !== prefix && !(prefix === " " && line === "")
            && !line.startsWith(`${prefix} `) && !line.startsWith(`${prefix}\t`))
            throw new ToolError("malformed patch body prefix");
        let text = `${line.slice(2)}\n`;
        if (this.peek() === "\\ No newline at end of file") {
            await this.take();
            if (text === "\n")
                throw new ToolError("empty incomplete line is not a valid text line");
            text = text.slice(0, -1);
        }
        return text;
    }
}
function encoded(line) {
    return `${line.kind}${line.text}${line.text.endsWith("\n") ? "" : "\n\\ No newline at end of file\n"}`;
}
async function normal(reader, target) {
    const quoted = JSON.stringify(target ?? "/dev/null");
    const output = [`--- ${quoted}\n+++ ${quoted}\n`];
    while (reader.peek() !== undefined) {
        if (reader.peek() === "") {
            await reader.take();
            continue;
        }
        if (!/^\d/u.test(reader.peek()))
            break;
        const command = /^(\d+)(?:,(\d+))?([acd])(\d+)(?:,(\d+))?$/u.exec(await reader.take());
        if (!command)
            throw new ToolError("malformed normal patch command");
        const oldStart = reader.number(command[1]);
        const oldLast = reader.number(command[2] ?? command[1]);
        const newStart = reader.number(command[4]);
        const newLast = reader.number(command[5] ?? command[4]);
        const operation = command[3];
        if (oldLast < oldStart || newLast < newStart || (operation === "a" && command[2] !== undefined)
            || (operation === "d" && command[5] !== undefined))
            throw new ToolError("invalid normal patch range");
        const oldCount = operation === "a" ? 0 : oldLast - oldStart + 1;
        const newCount = operation === "d" ? 0 : newLast - newStart + 1;
        output.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n`);
        for (let index = 0; index < oldCount; index++)
            output.push(encoded({ kind: "-", text: await reader.content("<") }));
        if (operation === "c" && await reader.take() !== "---")
            throw new ToolError("missing normal change separator");
        for (let index = 0; index < newCount; index++)
            output.push(encoded({ kind: "+", text: await reader.content(">") }));
    }
    return output.join("");
}
async function contextRange(reader, old) {
    const line = await reader.take();
    const match = (old ? /^\*\*\* (\d+)(?:,(\d+))? \*\*\*\*$/u : /^--- (\d+)(?:,(\d+))? ----$/u).exec(line);
    if (!match)
        throw new ToolError("malformed context range");
    const start = reader.number(match[1]);
    const last = reader.number(match[2] ?? match[1]);
    if (last < start || (match[2] !== undefined && start === 0))
        throw new ToolError("invalid context range");
    return { start, last, multiple: match[2] !== undefined };
}
async function contextSide(reader, old, range) {
    const lines = [];
    const count = range.start === 0 ? 0 : range.last - range.start + 1;
    while (reader.peek() !== undefined && lines.length < count) {
        const kind = reader.peek() === "" ? " " : reader.peek()[0];
        if (kind !== " " && kind !== "!" && kind !== (old ? "-" : "+"))
            break;
        if (old && /^--- \d+(?:,\d+)? ----$/u.test(reader.peek()))
            break;
        lines.push({ kind, text: await reader.content(kind) });
        if (lines.length > reader.budget.limits.maxLines)
            throw new ToolError("context body line limit exceeded");
    }
    return lines;
}
function contextCount(range, lines) {
    if (!lines.length) {
        if (range.multiple)
            throw new ToolError("empty context side has a nonempty range");
        return 0;
    }
    if (range.start === 0 || lines.length !== range.last - range.start + 1)
        throw new ToolError("context body count does not match range");
    return lines.length;
}
async function context(reader) {
    const output = [];
    while (reader.peek() !== undefined) {
        const header = await reader.take();
        if (header === "")
            continue;
        if (/^diff -[^ ]+ /u.test(header)) {
            output.push(`${header}\n`);
            continue;
        }
        if (!header.startsWith("*** "))
            throw new ToolError("expected context file header");
        const next = await reader.take();
        if (!next.startsWith("--- "))
            throw new ToolError("expected new context file header");
        output.push(`--- ${header.slice(4)}\n+++ ${next.slice(4)}\n`);
        let hunks = 0;
        while (reader.peek()?.startsWith("***************")) {
            const delimiter = await reader.take();
            if (!/^\*{15}(?: .*)?$/u.test(delimiter))
                throw new ToolError("malformed context hunk separator");
            if (++hunks > reader.budget.limits.maxHunks)
                throw new ToolError("hunk limit exceeded");
            const oldRange = await contextRange(reader, true);
            let oldLines = await contextSide(reader, true, oldRange);
            const newRange = await contextRange(reader, false);
            let newLines = await contextSide(reader, false, newRange);
            if (!oldLines.length) {
                if (newLines.some(line => line.kind === "!"))
                    throw new ToolError("missing old changed context body");
                oldLines = newLines.filter(line => line.kind === " ");
            }
            if (!newLines.length) {
                if (oldLines.some(line => line.kind === "!"))
                    throw new ToolError("missing new changed context body");
                newLines = oldLines.filter(line => line.kind === " ");
            }
            const oldCount = contextCount(oldRange, oldLines);
            const newCount = contextCount(newRange, newLines);
            output.push(`@@ -${oldRange.start},${oldCount} +${newRange.start},${newCount} @@${delimiter.slice(15)}\n`);
            let oldIndex = 0;
            let newIndex = 0;
            while (oldIndex < oldLines.length || newIndex < newLines.length) {
                let oldChanged = false;
                let newChanged = false;
                while (oldIndex < oldLines.length && oldLines[oldIndex].kind !== " ") {
                    const line = oldLines[oldIndex++];
                    oldChanged ||= line.kind === "!";
                    output.push(encoded({ kind: "-", text: line.text }));
                    reader.budget.step();
                    await reader.budget.checkpoint();
                }
                while (newIndex < newLines.length && newLines[newIndex].kind !== " ") {
                    const line = newLines[newIndex++];
                    newChanged ||= line.kind === "!";
                    output.push(encoded({ kind: "+", text: line.text }));
                    reader.budget.step();
                    await reader.budget.checkpoint();
                }
                if (oldChanged !== newChanged)
                    throw new ToolError("unpaired changed context group");
                if (oldIndex < oldLines.length || newIndex < newLines.length) {
                    const oldLine = oldLines[oldIndex++];
                    const newLine = newLines[newIndex++];
                    if (!oldLine || !newLine || !reader.budget.equal(oldLine.text, newLine.text))
                        throw new ToolError("context halves disagree");
                    output.push(encoded({ kind: " ", text: oldLine.text }));
                }
            }
        }
        if (!hunks)
            throw new ToolError("context file patch has no hunks");
        break;
    }
    return output.join("");
}
export async function parsePatch(text, budget, format, target, progress) {
    if (text && !text.endsWith("\n"))
        throw new ToolError("patch is truncated: missing final LF");
    const reader = new Reader(text, budget);
    const patches = [];
    let convertedBytes = 0;
    while (reader.peek() !== undefined) {
        try {
            if (reader.peek() === "") {
                await reader.take();
                continue;
            }
            if (!progress && patches.length && reader.peek().startsWith("-") && !reader.peek().startsWith("---")) {
                throw new ToolError("unexpected deletion outside a patch hunk");
            }
            if (patches.length && !/^(?:Index: |diff |index |---|\*\*\*|@@|[+\\<>]|\d)/u.test(reader.peek())) {
                await reader.take();
                continue;
            }
            let indexPath;
            if (reader.peek()?.startsWith("Index: ")) {
                indexPath = decodeHeaderPath((await reader.take()).slice(7));
                if (/^=+$/u.test(reader.peek() ?? ""))
                    await reader.take();
            }
            const start = reader.index;
            while (/^diff /u.test(reader.peek() ?? ""))
                await reader.take();
            const first = reader.peek() ?? "";
            const detected = first.startsWith("*** ") ? "context" : /^\d/u.test(first) ? "normal" : "unified";
            if (format && detected !== format)
                throw new ToolError(`patch format is ${detected}, not requested ${format}`);
            if (detected === "unified") {
                reader.index = start;
                patches.push(...(await parseUnifiedSection(reader, budget)).map(patch => ({ ...patch, ...(indexPath === undefined ? {} : { indexPath }) })));
            }
            else {
                if (detected === "context")
                    reader.index = start;
                const converted = detected === "normal" ? await normal(reader, target ?? indexPath) : await context(reader);
                convertedBytes += Buffer.byteLength(converted);
                if (convertedBytes > budget.limits.maxInputBytes * 2 + 16_384)
                    throw new ToolError("converted patch byte limit exceeded");
                patches.push(...(await parseUnified(converted, budget)).map(patch => ({ ...patch, format: detected,
                    ...(indexPath === undefined ? {} : { indexPath }),
                    ...(detected === "normal" && target === undefined && indexPath === undefined ? { unlocated: true } : {}) })));
            }
        }
        catch (error) {
            if (!progress || !(error instanceof ToolError) || /limit|budget|filename|path|escape/u.test(error.message))
                throw error;
            progress.error = error;
            break;
        }
    }
    return patches;
}
//# sourceMappingURL=patch-formats.js.map