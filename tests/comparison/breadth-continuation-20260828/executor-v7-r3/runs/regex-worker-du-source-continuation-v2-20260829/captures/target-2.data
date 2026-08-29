import { isAscii } from "node:buffer";
class SearchError extends Error {
}
class UsageError extends Error {
}
function decode(bytes) {
    let text = "";
    const offsets = [];
    const invalid = [];
    for (let offset = 0; offset < bytes.length;) {
        const first = bytes[offset];
        let length = first < 128 ? 1 : first >= 0xc2 && first <= 0xdf ? 2 : first >= 0xe0 && first <= 0xef ? 3 : first >= 0xf0 && first <= 0xf4 ? 4 : 0;
        let consumed = 1;
        if (length > 1) {
            for (; consumed < length; consumed++) {
                const next = bytes[offset + consumed];
                if (next === undefined || next < 0x80 || next > 0xbf || consumed === 1 && (first === 0xe0 && next < 0xa0 || first === 0xed && next >= 0xa0 || first === 0xf0 && next < 0x90 || first === 0xf4 && next >= 0x90))
                    break;
            }
            if (consumed < length)
                length = 0;
        }
        const character = length ? Buffer.from(bytes.subarray(offset, offset + length)).toString("utf8") : "\ufffd";
        if (!length)
            invalid.push(text.length);
        offsets.push(offset);
        if (character.length === 2)
            offsets.push(offset);
        text += character;
        offset += length || 1;
    }
    offsets.push(bytes.length);
    return { text, offsets, invalid };
}
const escaped = (source) => source.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");
class SearchMatcher {
    regex;
    byteEmpty;
    fragments = new Map();
    constructor(patterns, args) {
        this.byteEmpty = patterns.length === 1 && patterns[0] === "" && !args.word && !args.whole;
        if (patterns.length > 1024)
            throw new SearchError("pattern count limit exceeded");
        if (!patterns.length)
            return;
        const insensitive = args.case === "insensitive" || args.case === "smart" && !patterns.some(pattern => /\p{Lu}/u.test(pattern));
        const sources = patterns.map(pattern => {
            if (Buffer.byteLength(pattern) > 8192)
                throw new SearchError("pattern byte limit exceeded");
            if (pattern.includes("\n") && !args.nullData)
                throw new SearchError("multiline matching is not supported");
            if (args.fixed)
                return escaped(pattern);
            if (/\\[1-9]|\(\?(?:[=!]|<[=!]|P[<=])/u.test(pattern))
                throw new SearchError("backreferences and look-around are not supported");
            return pattern;
        });
        let source = sources.map(pattern => `(?:${pattern})`).join("|");
        if (args.whole)
            source = `^(?:${source})$`;
        else if (args.word)
            source = `(?<![\\p{L}\\p{N}\\p{M}\\p{Pc}\\u200c\\u200d])(?:${source})(?![\\p{L}\\p{N}\\p{M}\\p{Pc}\\u200c\\u200d])`;
        try {
            this.regex = new RegExp(source, `gu${insensitive ? "i" : ""}`);
        }
        catch (error) {
            throw new SearchError(`invalid or unsupported regular expression: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    fragmentRegex(atStart, atEnd) {
        if (atStart && atEnd)
            return this.regex;
        const key = Number(atStart) + Number(atEnd) * 2;
        const cached = this.fragments.get(key);
        if (cached)
            return cached;
        let source = "";
        let characterClass = false;
        for (let index = 0; index < this.regex.source.length; index++) {
            const character = this.regex.source[index];
            if (character === "\\") {
                source += character + this.regex.source[++index];
                continue;
            }
            if (character === "[")
                characterClass = true;
            else if (character === "]")
                characterClass = false;
            source += !characterClass && (character === "^" && !atStart || character === "$" && !atEnd) ? "(?!)" : character;
        }
        const regex = new RegExp(source, this.regex.flags);
        this.fragments.set(key, regex);
        return regex;
    }
    matches(bytes, all = true, terminated = true) {
        if (!this.regex)
            return [];
        if (this.byteEmpty) {
            const length = all ? bytes.length + Number(terminated) : 1;
            if (length > 100000)
                throw new SearchError("matches per line limit exceeded");
            return Array.from({ length }, (_value, offset) => ({ start: offset, end: offset }));
        }
        const { text, offsets, invalid } = isAscii(bytes) ? { text: Buffer.from(bytes).toString("ascii"), offsets: undefined, invalid: [] } : decode(bytes);
        const matches = [];
        let previousEnd = -1;
        let fragmentStart = 0;
        for (const fragmentEnd of [...invalid, text.length]) {
            const fragment = text.slice(fragmentStart, fragmentEnd);
            const regex = this.fragmentRegex(fragmentStart === 0, fragmentEnd === text.length);
            regex.lastIndex = 0;
            while (true) {
                const match = regex.exec(fragment);
                if (!match)
                    break;
                const first = fragmentStart + match.index;
                const last = first + match[0].length;
                const start = offsets?.[first] ?? first;
                const end = offsets?.[last] ?? last;
                if (start !== end || start !== previousEnd)
                    matches.push({ start, end });
                if (matches.length > 100000)
                    throw new SearchError("matches per line limit exceeded");
                if (!all && matches.length)
                    return matches;
                previousEnd = end;
                if (match[0].length === 0) {
                    if (regex.lastIndex === fragment.length)
                        break;
                    regex.lastIndex += fragment.codePointAt(regex.lastIndex) > 0xffff ? 2 : 1;
                }
            }
            fragmentStart = fragmentEnd + 1;
        }
        return matches;
    }
}
function expression(pattern, extended) {
    const classes = { digit: "0-9", lower: "a-z", upper: "A-Z", alpha: "A-Za-z", alnum: "A-Za-z0-9", space: "\\t\\n\\v\\f\\r ", blank: "\\t ", xdigit: "0-9A-Fa-f" };
    let source = pattern.replace(/\[:([a-z]+):\]/gu, (_whole, name) => {
        if (!classes[name])
            throw new UsageError(`unsupported character class '${name}'`);
        return classes[name];
    });
    if (source.length > 65536)
        throw new UsageError("pattern is too large");
    if (!extended) {
        let translated = "";
        let bracket = false;
        for (let index = 0; index < source.length; index++) {
            const character = source[index];
            if (character === "\\" && index + 1 < source.length) {
                const next = source[++index];
                translated += !bracket && "(){}+?|".includes(next) ? next : `\\${next}`;
            }
            else {
                if (character === "[")
                    bracket = true;
                if (character === "]")
                    bracket = false;
                translated += !bracket && "(){}+?|".includes(character) ? `\\${character}` : character;
            }
        }
        source = translated;
    }
    if (source.includes("(?"))
        throw new UsageError("lookaround and special groups are not supported");
    return source;
}
function grepMatcher(args) {
    const matchers = args.patterns.map(pattern => {
        let source = args.fixed ? escaped(pattern) : expression(pattern, args.extended);
        if (args.whole)
            source = `^(?:${source})$`;
        try {
            return new RegExp(source, args.insensitive ? "gi" : "g");
        }
        catch {
            throw new UsageError(`invalid regular expression '${pattern}'`);
        }
    });
    return (bytes, all) => {
        const text = Buffer.from(bytes).toString("latin1");
        const ranges = [];
        for (const matcher of matchers) {
            matcher.lastIndex = 0;
            let match;
            while ((match = matcher.exec(text)) !== null) {
                const boundary = !args.word || !/[A-Za-z0-9_]/u.test(text[match.index - 1] ?? "") && !/[A-Za-z0-9_]/u.test(text[match.index + match[0].length] ?? "");
                if (boundary) {
                    ranges.push({ start: match.index, end: match.index + match[0].length });
                    if (!all)
                        return ranges;
                }
                if (match[0] === "")
                    matcher.lastIndex++;
            }
        }
        return ranges.sort((left, right) => left.start - right.start || right.end - left.end);
    };
}
const quoteGlob = (character) => character.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");
function globSource(source, literalUnclosedClass) {
    let output = "";
    let braces = 0;
    for (let offset = 0; offset < source.length; offset++) {
        const character = source[offset];
        if (character === "\\") {
            const next = source[++offset];
            if (next === undefined)
                throw new SearchError("trailing glob escape");
            output += quoteGlob(next);
        }
        else if (character === "*") {
            if (source[offset + 1] === "*") {
                while (source[offset + 1] === "*")
                    offset++;
                if (source[offset + 1] === "/") {
                    offset++;
                    output += "(?:.*/)?";
                }
                else
                    output += ".*";
            }
            else
                output += "[^/]*";
        }
        else if (character === "?")
            output += "[^/]";
        else if (character === "[") {
            const opening = offset;
            let contents = "";
            if (source[offset + 1] === "!" || source[offset + 1] === "^") {
                contents = "^";
                offset++;
            }
            let closed = false;
            while (++offset < source.length) {
                if (source[offset] === "]" && contents !== "" && contents !== "^") {
                    closed = true;
                    break;
                }
                contents += source[offset] === "\\" ? "\\\\" : source[offset] === "]" ? "\\]" : source[offset];
            }
            if (!closed) {
                if (!literalUnclosedClass)
                    throw new SearchError("unclosed glob character class");
                output += "\\[";
                offset = opening;
                continue;
            }
            output += `[${contents}]`;
        }
        else if (character === "{") {
            if (++braces > 8)
                throw new SearchError("glob nesting limit exceeded");
            output += "(?:";
        }
        else if (character === "}") {
            if (!braces--)
                throw new SearchError("unmatched glob brace");
            output += ")";
        }
        else if (character === "," && braces)
            output += "|";
        else
            output += quoteGlob(character);
    }
    if (braces)
        throw new SearchError("unclosed glob brace");
    return output;
}
function globMatcher(source, insensitive, literalUnclosedClass) {
    if (!source || source.length > 8192)
        throw new SearchError("empty or excessive glob");
    const directory = source.endsWith("/");
    if (directory)
        source = source.slice(0, -1);
    const anchored = source.startsWith("/") || source.includes("/");
    if (source.startsWith("/"))
        source = source.slice(1);
    let regex;
    try {
        regex = new RegExp(`${anchored ? "^" : "(?:^|/)"}${globSource(source, literalUnclosedClass)}$`, insensitive ? "ui" : "u");
    }
    catch (error) {
        throw new SearchError(`invalid glob: ${error instanceof Error ? error.message : String(error)}`);
    }
    return row => {
        const path = Buffer.from(row.bytes).toString("utf16le");
        if ((!directory || row.directory) && regex.test(path))
            return [{ start: 0, end: 0 }];
        if (row.ancestors !== false) {
            let slash = path.lastIndexOf("/");
            while (slash >= 0) {
                if (regex.test(path.slice(0, slash)))
                    return [{ start: 0, end: 0 }];
                slash = path.lastIndexOf("/", slash - 1);
            }
        }
        return [];
    };
}
export function compile(descriptor) {
    if (descriptor.kind === "glob") {
        if (descriptor.globOptions.length !== descriptor.patterns.length)
            throw new SearchError("invalid glob options");
        const matchers = descriptor.patterns.map((pattern, index) => {
            const options = descriptor.globOptions[index];
            return globMatcher(pattern, options.insensitive, options.literalUnclosedClass);
        });
        return (row, index) => matchers[index](row);
    }
    if (descriptor.kind === "grep") {
        const matcher = grepMatcher(descriptor);
        return row => matcher(row.bytes, row.all);
    }
    const matcher = new SearchMatcher(descriptor.patterns, descriptor);
    return row => matcher.matches(row.bytes, row.all, row.terminated);
}
//# sourceMappingURL=matching.js.map