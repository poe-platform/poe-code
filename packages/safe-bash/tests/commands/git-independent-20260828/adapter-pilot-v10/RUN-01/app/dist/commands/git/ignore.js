import { GIT_LIMITS, demand } from "./limits.js";
async function tokens(session, pattern) {
    session.reserve(pattern.length * 32);
    const result = [];
    for (let offset = 0; offset < pattern.length; offset++) {
        await session.step();
        const byte = pattern[offset];
        if (byte === 92) {
            demand(offset + 1 < pattern.length, "invalid ignore escape");
            result.push({ kind: "literal", byte: pattern[++offset] });
        }
        else if (byte === 63)
            result.push({ kind: "any" });
        else if (byte === 42) {
            if (pattern[offset + 1] === 42 && (offset === 0 || pattern[offset - 1] === 47) && (offset + 2 === pattern.length || pattern[offset + 2] === 47)) {
                offset++;
                if (pattern[offset + 1] === 47) {
                    result.push({ kind: "dirs" });
                    offset++;
                }
                else
                    result.push({ kind: "all" });
            }
            else {
                demand(pattern[offset + 1] !== 42, "unsupported ignore wildcard sequence");
                result.push({ kind: "star" });
            }
        }
        else if (byte === 91) {
            const bytes = new Set();
            let negative = false;
            if (pattern[offset + 1] === 33 || pattern[offset + 1] === 94) {
                negative = true;
                offset++;
            }
            let closed = false;
            while (++offset < pattern.length) {
                await session.step();
                const start = pattern[offset];
                if (start === 93 && bytes.size) {
                    closed = true;
                    break;
                }
                demand(start < 128 && start !== 91 && start !== 92 && start !== 47, "unsupported ignore bracket class");
                if (pattern[offset + 1] === 45 && pattern[offset + 2] !== 93) {
                    const end = pattern[offset + 2];
                    demand(end !== undefined && end >= start && end < 128 && end !== 47, "invalid ignore range");
                    for (let value = start; value <= end; value++)
                        bytes.add(value);
                    offset += 2;
                }
                else
                    bytes.add(start);
            }
            demand(closed, "unterminated ignore bracket class");
            result.push({ kind: "class", bytes, negative });
        }
        else
            result.push({ kind: "literal", byte });
    }
    return result;
}
export async function ignoreFile(session, path, base) {
    const bytes = await session.read(path, GIT_LIMITS.maxMetadataBytes, true);
    if (!bytes)
        return [];
    try {
        const text = session.text(bytes);
        session.reserve(bytes.length * 2);
        const rules = [];
        for (let line of text.split("\n")) {
            await session.step(line.length + 1);
            if (line.endsWith("\r"))
                line = line.slice(0, -1);
            let end = line.length;
            while (end && line[end - 1] === " ") {
                let slash = end - 2;
                while (slash >= 0 && line[slash] === "\\")
                    slash--;
                if ((end - 2 - slash) % 2)
                    break;
                end--;
            }
            line = line.slice(0, end);
            if (!line || line.startsWith("#"))
                continue;
            demand(!line.includes("\0"), "NUL in ignore rule");
            const include = line.startsWith("!");
            if (include)
                line = line.slice(1);
            demand(line.length > 0, "empty ignore negation");
            const directory = line.endsWith("/");
            if (directory)
                line = line.slice(0, -1);
            const anchored = line.includes("/");
            if (line.startsWith("/"))
                line = line.slice(1);
            demand(line.length > 0, "empty ignore pattern");
            session.charge("maxEntries", 1);
            rules.push({ base, directory, include, anchored, tokens: await tokens(session, Buffer.from(line)) });
        }
        return rules;
    }
    finally {
        session.release(bytes);
    }
}
async function match(session, pattern, path) {
    let current = session.allocate(path.length + 1);
    current[0] = 1;
    try {
        for (const token of pattern) {
            const next = session.allocate(path.length + 1);
            let reachable = false;
            for (let offset = 0; offset <= path.length; offset++) {
                await session.step();
                if (token.kind === "star" || token.kind === "all")
                    next[offset] = current[offset] || offset > 0 && (token.kind === "all" || path[offset - 1] !== 47) && next[offset - 1] ? 1 : 0;
                else if (token.kind === "dirs") {
                    reachable ||= Boolean(current[offset]);
                    next[offset] = current[offset] || reachable && offset > 0 && path[offset - 1] === 47 ? 1 : 0;
                }
                else if (offset < path.length && current[offset]) {
                    const byte = path[offset];
                    const accepted = token.kind === "literal" ? token.byte === byte : token.kind === "any" ? byte !== 47 : token.kind === "class" && byte !== 47 && token.bytes.has(byte) !== token.negative;
                    if (accepted)
                        next[offset + 1] = 1;
                }
            }
            session.release(current);
            current = next;
        }
        return Boolean(current[path.length]);
    }
    finally {
        session.release(current);
    }
}
export async function ignored(session, rules, name, directory) {
    let result = false;
    for (const rule of rules) {
        if (rule.directory && !directory)
            continue;
        if (rule.base && !name.startsWith(rule.base + "/"))
            continue;
        const relative = rule.base ? name.slice(rule.base.length + 1) : name;
        const candidate = rule.anchored ? relative : relative.slice(relative.lastIndexOf("/") + 1);
        if (await match(session, rule.tokens, Buffer.from(candidate)))
            result = !rule.include;
    }
    return result;
}
//# sourceMappingURL=ignore.js.map