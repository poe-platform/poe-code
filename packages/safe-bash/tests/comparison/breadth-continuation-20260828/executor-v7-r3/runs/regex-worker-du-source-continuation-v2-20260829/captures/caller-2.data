import { RegexExecutionError } from "../regex-execution/client.js";
import { SearchError } from "./options.js";
export class Glob {
    source;
    insensitive;
    literalUnclosedClass;
    constructor(source, insensitive = false, literalUnclosedClass = false) {
        this.source = source;
        this.insensitive = insensitive;
        this.literalUnclosedClass = literalUnclosedClass;
    }
    async matches(path, directory, session, ancestors = true) {
        return (await matchGlobs([this], [{ path, directory, ancestors }], session))[0];
    }
}
export async function matchGlobs(globs, candidates, session) {
    if (candidates.length && candidates.length !== globs.length)
        throw new SearchError("invalid glob candidate count");
    const results = [];
    for (let offset = 0; offset < globs.length;) {
        const batch = [];
        const rows = [];
        let bytes = 128;
        while (offset < globs.length && batch.length < 128) {
            const glob = globs[offset];
            const candidate = candidates[offset];
            const size = 48 + glob.source.length * 2 + (candidate ? 32 + candidate.path.length * 2 : 0);
            if (batch.length && bytes + size > 64 * 1024)
                break;
            batch.push(glob);
            if (candidate)
                rows.push({ bytes: Buffer.from(candidate.path, "utf16le"), all: false, terminated: true, directory: candidate.directory, ancestors: candidate.ancestors ?? true });
            bytes += size;
            offset++;
        }
        const descriptor = {
            kind: "glob", patterns: batch.map(glob => glob.source),
            globOptions: batch.map(glob => ({ insensitive: glob.insensitive, literalUnclosedClass: glob.literalUnclosedClass })),
        };
        try {
            results.push(...(await session.run(descriptor, rows)).map(result => result.length > 0));
        }
        catch (error) {
            if (error instanceof RegexExecutionError && error.code === "MATCH")
                throw new SearchError(error.message);
            throw error;
        }
    }
    return results;
}
export async function ignoreRules(contents, base, priority, session) {
    const rules = [];
    for (let source of contents.split(/\r?\n/u)) {
        if (!source || source.startsWith("#"))
            continue;
        while (source.endsWith(" ")) {
            let backslashes = 0;
            for (let offset = source.length - 2; offset >= 0 && source[offset] === "\\"; offset--)
                backslashes++;
            if (backslashes % 2)
                break;
            source = source.slice(0, -1);
        }
        if (!source)
            continue;
        const include = source.startsWith("!");
        if (include)
            source = source.slice(1);
        if (source)
            rules.push({ base, priority, include, glob: new Glob(source, false, true) });
        if (rules.length > 10000)
            break;
    }
    await matchGlobs(rules.map(rule => rule.glob), [], session);
    if (rules.length > 10000)
        throw new SearchError("ignore rule count limit exceeded");
    return rules;
}
//# sourceMappingURL=glob.js.map