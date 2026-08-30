import { basename, resolvePath, writeBytes } from "../../contracts/index.js";
import { Budget, ToolError, definition, host, inspect } from "./shared.js";
import { contextual, normal } from "./diff-format.js";
function contextLength(value) {
    if (!/^(?:[ \t\n\v\f\r]*[+-]?\d+)?$/u.test(value) || Number(value) < 0) {
        throw new ToolError(`invalid context length: ${value}`);
    }
    return Math.min(Number(value), Number.MAX_SAFE_INTEGER);
}
function flags(args) {
    const result = { format: "normal", whitespace: "exact", context: 0, brief: false, recursive: false, newFile: false, labels: [], files: [] };
    let selectedFormat;
    const selectFormat = (format) => {
        if (selectedFormat !== undefined && selectedFormat !== format)
            throw new ToolError("conflicting output format options");
        selectedFormat = result.format = format;
    };
    let explicitContext = false;
    let legacyContext = -1;
    let previousDigit = false;
    const selectContext = (format, width, explicit) => {
        selectFormat(format);
        result.context = Math.max(result.context, width);
        explicitContext ||= explicit;
    };
    let operands = false;
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (!operands && arg.startsWith("--"))
            previousDigit = false;
        const value = (attached, name) => {
            const next = attached ?? args[++index];
            if (next === undefined)
                throw new ToolError(`${name} requires an argument`);
            return next;
        };
        if (operands || arg === "-" || !arg.startsWith("-"))
            result.files.push(arg);
        else if (arg === "--")
            operands = true;
        else if (arg === "--brief")
            result.brief = true;
        else if (arg === "--recursive")
            result.recursive = true;
        else if (arg === "--new-file")
            result.newFile = true;
        else if (arg === "--ignore-all-space")
            result.whitespace = "all";
        else if (arg === "--ignore-space-change") {
            if (result.whitespace !== "all")
                result.whitespace = "change";
        }
        else if (arg === "--normal")
            selectFormat("normal");
        else if (arg === "--unified")
            selectContext("unified", 3, true);
        else if (arg.startsWith("--unified="))
            selectContext("unified", contextLength(arg.slice(10)), true);
        else if (arg === "--context")
            selectContext("context", 3, true);
        else if (arg.startsWith("--context="))
            selectContext("context", contextLength(arg.slice(10)), true);
        else if (arg === "--label" || arg.startsWith("--label="))
            result.labels.push(value(arg.includes("=") ? arg.slice(8) : undefined, "--label"));
        else if (arg.startsWith("--"))
            throw new ToolError(`unsupported option: ${arg}`);
        else {
            for (let offset = 1; offset < arg.length; offset++) {
                const flag = arg[offset];
                if (/^\d$/u.test(flag)) {
                    legacyContext = Math.min((previousDigit ? legacyContext : 0) * 10 + Number(flag), Number.MAX_SAFE_INTEGER);
                    previousDigit = true;
                    continue;
                }
                previousDigit = false;
                if (flag === "u")
                    selectContext("unified", 3, false);
                else if (flag === "c")
                    selectContext("context", 3, false);
                else if (flag === "q")
                    result.brief = true;
                else if (flag === "r")
                    result.recursive = true;
                else if (flag === "N")
                    result.newFile = true;
                else if (flag === "w")
                    result.whitespace = "all";
                else if (flag === "b") {
                    if (result.whitespace !== "all")
                        result.whitespace = "change";
                }
                else if (flag === "U" || flag === "C" || flag === "L") {
                    const parameter = value(arg.slice(offset + 1) || undefined, `-${flag}`);
                    if (flag === "U")
                        selectContext("unified", contextLength(parameter), true);
                    else if (flag === "C")
                        selectContext("context", contextLength(parameter), true);
                    else
                        result.labels.push(parameter);
                    break;
                }
                else
                    throw new ToolError(`unsupported option: -${flag}`);
            }
        }
    }
    if (legacyContext >= 0 && result.format !== "normal") {
        result.context = explicitContext ? Math.max(result.context, legacyContext) : legacyContext;
    }
    if (result.files.length !== 2)
        throw new ToolError("expected two files or directories");
    if (result.labels.length > 2)
        throw new ToolError("at most two labels are supported");
    for (const name of [...result.labels, ...result.files]) {
        if (!name || /[\0\r\n\t]/u.test(name))
            throw new ToolError("empty names or control characters in filenames/labels are unsupported");
    }
    return result;
}
async function comparisonLines(lines, whitespace, budget) {
    if (whitespace === "exact")
        return lines;
    const result = [];
    for (const line of lines) {
        budget.step(1 + line.length);
        await budget.checkpoint();
        const body = line.endsWith("\n") ? line.slice(0, -1) : line;
        const normalized = body.replace(/[ \t\v\f\r]+/gu, whitespace === "all" ? "" : " ");
        result.push(normalized.endsWith(" ") ? normalized.slice(0, -1) : normalized);
    }
    return result;
}
async function equivalent(oldKeys, newKeys, budget) {
    if (oldKeys.length !== newKeys.length)
        return false;
    for (let index = 0; index < oldKeys.length; index++) {
        if (!budget.equal(oldKeys[index], newKeys[index]))
            return false;
        await budget.checkpoint();
    }
    return true;
}
async function edits(oldLines, newLines, oldKeys, newKeys, budget) {
    let prefix = 0;
    while (prefix < Math.min(oldLines.length, newLines.length) && budget.equal(oldKeys[prefix], newKeys[prefix])) {
        prefix++;
        await budget.checkpoint();
    }
    let suffix = 0;
    while (suffix < Math.min(oldLines.length, newLines.length) - prefix
        && budget.equal(oldKeys[oldLines.length - suffix - 1], newKeys[newLines.length - suffix - 1])) {
        suffix++;
        await budget.checkpoint();
    }
    const oldCount = oldLines.length - prefix - suffix;
    const newCount = newLines.length - prefix - suffix;
    const cells = (oldCount + 1) * (newCount + 1);
    if (oldCount && newCount && cells > budget.limits.maxMatrixCells)
        throw new ToolError("diff matrix cell limit exceeded");
    const width = newCount + 1;
    const matrix = oldCount && newCount ? new Uint32Array(cells) : undefined;
    if (matrix)
        for (let oldIndex = oldCount - 1; oldIndex >= 0; oldIndex--) {
            for (let newIndex = newCount - 1; newIndex >= 0; newIndex--) {
                const position = oldIndex * width + newIndex;
                matrix[position] = budget.equal(oldKeys[prefix + oldIndex], newKeys[prefix + newIndex])
                    ? 1 + matrix[position + width + 1]
                    : Math.max(matrix[position + width], matrix[position + 1]);
                await budget.checkpoint();
            }
        }
    const result = oldLines.slice(0, prefix).map((line, index) => ({ kind: " ", line, newLine: newLines[index] }));
    let oldIndex = 0;
    let newIndex = 0;
    while (oldIndex < oldCount || newIndex < newCount) {
        budget.step();
        if (oldIndex < oldCount && newIndex < newCount && budget.equal(oldKeys[prefix + oldIndex], newKeys[prefix + newIndex])) {
            result.push({ kind: " ", line: oldLines[prefix + oldIndex++], newLine: newLines[prefix + newIndex++] });
        }
        else if (oldIndex < oldCount && (newIndex === newCount || matrix[oldIndex * width + newIndex + width] >= matrix[oldIndex * width + newIndex + 1])) {
            result.push({ kind: "-", line: oldLines[prefix + oldIndex++] });
        }
        else
            result.push({ kind: "+", line: newLines[prefix + newIndex++] });
        await budget.checkpoint();
    }
    for (let index = 0; index < suffix; index++) {
        result.push({ kind: " ", line: oldLines[oldLines.length - suffix + index], newLine: newLines[newLines.length - suffix + index] });
        budget.step();
        await budget.checkpoint();
    }
    return result;
}
async function run(context, budget) {
    const options = flags(context.args);
    const pieces = [];
    const append = (text) => { budget.output(text); pieces.push(text); };
    let different = false;
    let stdin;
    const pending = [{ left: options.files[0], right: options.files[1], nested: false }];
    while (pending.length) {
        budget.file();
        await budget.checkpoint();
        const pair = pending.pop();
        let left = pair.left;
        let right = pair.right;
        let leftStat = left === "-" ? { type: "file" } : await inspect(budget, left);
        let rightStat = right === "-" ? { type: "file" } : await inspect(budget, right);
        if (!pair.nested && leftStat && rightStat && (leftStat.type === "directory") !== (rightStat.type === "directory")) {
            if (left === "-" || right === "-")
                throw new ToolError("cannot compare stdin with a directory");
            if (leftStat.type === "directory") {
                left = `${left}/${basename(right)}`;
                leftStat = await inspect(budget, left);
            }
            else {
                right = `${right}/${basename(left)}`;
                rightStat = await inspect(budget, right);
            }
        }
        if (!leftStat && !rightStat)
            throw new ToolError(`both paths are missing: ${left}, ${right}`);
        if ((!leftStat || !rightStat) && !options.newFile) {
            if (!pair.nested)
                throw new ToolError(`file not found: ${leftStat ? right : left}`);
            const present = leftStat ? left : right;
            append(`Only in ${present.slice(0, present.lastIndexOf("/"))}: ${basename(present)}\n`);
            different = true;
            continue;
        }
        if (leftStat?.type === "directory" || rightStat?.type === "directory") {
            if (leftStat && rightStat && leftStat.type !== rightStat.type) {
                append(`File ${left} is a ${leftStat.type} while file ${right} is a ${rightStat.type}\n`);
                different = true;
                continue;
            }
            if (pair.nested && !options.recursive) {
                append(`Common subdirectories: ${left} and ${right}\n`);
                continue;
            }
            const names = new Set();
            for (const path of [leftStat ? left : undefined, rightStat ? right : undefined]) {
                if (path === undefined)
                    continue;
                const entries = await host(context, () => context.fs.readdir(resolvePath(context.cwd, path), { signal: context.signal }));
                for (const entry of entries) {
                    budget.step();
                    if (!entry.name || entry.name === "." || entry.name === ".." || /[\/\\\0\r\n\t]/u.test(entry.name))
                        throw new ToolError("unsafe directory entry name");
                    names.add(entry.name);
                    if (names.size + pending.length > budget.limits.maxFiles)
                        throw new ToolError("file/entry limit exceeded");
                }
            }
            for (const name of [...names].sort().reverse())
                pending.push({ left: `${left}/${name}`, right: `${right}/${name}`, nested: true });
            continue;
        }
        const read = async (path, exists) => {
            if (!exists)
                return "";
            if (path === "-")
                return stdin ??= await budget.read("-");
            return budget.read(resolvePath(context.cwd, path));
        };
        const oldText = await read(left, !!leftStat);
        const newText = await read(right, !!rightStat);
        if (oldText === newText)
            continue;
        const oldLines = budget.split(oldText);
        const newLines = budget.split(newText);
        const oldKeys = await comparisonLines(oldLines, options.whitespace, budget);
        const newKeys = await comparisonLines(newLines, options.whitespace, budget);
        if (options.whitespace !== "exact" && await equivalent(oldKeys, newKeys, budget))
            continue;
        different = true;
        if (options.brief)
            append(`Files ${options.labels[0] ?? left} and ${options.labels[1] ?? right} differ\n`);
        else {
            const changes = await edits(oldLines, newLines, oldKeys, newKeys, budget);
            if (options.format === "normal")
                await normal(changes, budget, append);
            else
                await contextual(changes, options.format, options.labels[0] ?? (leftStat ? left : "/dev/null"), options.labels[1] ?? (rightStat ? right : "/dev/null"), options.context, budget, append);
        }
    }
    await writeBytes(context.stdout, Buffer.from(pieces.join("")), context.signal);
    return different ? 1 : 0;
}
export function diffCommand(options) { return definition("diff", options, run); }
//# sourceMappingURL=diff.js.map