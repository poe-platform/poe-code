function timestamp(header) {
    if (!header)
        return "";
    const separator = header.indexOf("\t");
    return separator < 0 ? "" : header.slice(separator);
}
function unifiedRange(start, count, offset) {
    return `${start + offset}${count === 1 ? "" : `,${count}`}`;
}
function contextRange(start, count, offset) {
    return count === 0 ? "0" : count === 1 ? `${start + offset}` : `${start + offset},${start + offset + count - 1}`;
}
export async function rejectText(patch, outcomes, oldName, newName, indexName, reverse, budget) {
    const normal = patch.format === "normal";
    const context = patch.format === "context" || normal;
    const names = [normal ? "/dev/null" : oldName ?? "/dev/null", normal ? "/dev/null" : newName ?? "/dev/null"];
    const times = normal ? ["", ""] : [timestamp(patch.oldHeader), timestamp(patch.newHeader)];
    if (reverse) {
        names.reverse();
        times.reverse();
    }
    const output = [];
    const add = (text) => { budget.output(text); output.push(text); };
    if (indexName !== undefined)
        add(`Index: ${indexName}\n`);
    add(`${context ? "***" : "---"} ${names[0]}${times[0]}\n${context ? "---" : "+++"} ${names[1]}${times[1]}\n`);
    for (const outcome of outcomes) {
        if (!outcome.failed)
            continue;
        budget.step();
        await budget.checkpoint();
        const { hunk, outputOffset } = outcome;
        if (!context) {
            add(`@@ -${unifiedRange(hunk.oldStart, hunk.oldCount, outputOffset)} +${unifiedRange(hunk.newStart, hunk.newCount, outputOffset)} @@${hunk.section ?? ""}\n`);
            let group = [];
            const flush = () => {
                for (const kind of ["-", "+"])
                    for (const line of group)
                        if (line.kind === kind)
                            add(`${kind}${line.text}`);
                group = [];
            };
            for (const line of hunk.lines) {
                budget.step();
                await budget.checkpoint();
                if (line.kind === " ") {
                    flush();
                    add(` ${line.text}`);
                }
                else
                    group.push(line);
            }
            flush();
        }
        else {
            add(`***************${hunk.section ?? ""}\n*** ${contextRange(hunk.oldStart, hunk.oldCount, outputOffset)}${normal ? "" : " ****"}\n`);
            const oldLines = [];
            const newLines = [];
            let group = [];
            const flush = () => {
                const changed = !normal && group.some(line => line.kind === "-") && group.some(line => line.kind === "+");
                for (const line of group) {
                    const text = `${changed ? "!" : line.kind} ${line.text}`;
                    (line.kind === "-" ? oldLines : newLines).push(text);
                }
                group = [];
            };
            for (const line of hunk.lines) {
                budget.step();
                await budget.checkpoint();
                if (line.kind === " ") {
                    flush();
                    oldLines.push(`  ${line.text}`);
                    newLines.push(`  ${line.text}`);
                }
                else
                    group.push(line);
            }
            flush();
            for (const line of oldLines)
                add(line);
            add(`--- ${contextRange(hunk.newStart, hunk.newCount, outputOffset)}${normal ? " -----" : " ----"}\n`);
            for (const line of newLines)
                add(line);
        }
    }
    return output.join("");
}
//# sourceMappingURL=patch-gnu-reject.js.map