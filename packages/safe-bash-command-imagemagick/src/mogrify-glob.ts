import { FsError, type FileSystem } from "@poe-code/safe-fs/contracts";
import { resolvePath } from "safe-bash-contracts/path";
import { drainCooperativeSteps } from "safe-bash-contracts/yield";

export function* matchesMagickGlob(pattern: string, name: string): Generator<void, boolean, void> {
    let work = 0;
    let positions = new Set([0]);
    for (let i = 0; i < pattern.length; i++) {
        if (++work % 64 === 0) yield;
        const token = pattern[i]!;
        const next = new Set<number>();
        if (token === "*") {
            let start = name.length;
            for (const position of positions) start = Math.min(start, position);
            for (let position = start; position <= name.length; position++) { if (++work % 64 === 0) yield; next.add(position); }
        } else {
            let literal = token;
            let contents: string | undefined;
            if (token === "\\") literal = pattern[++i] ?? "\\";
            if (token === "[") {
                let end = i + 1;
                if (pattern[end] === "!" || pattern[end] === "^") end++;
                if (pattern[end] === "]") end++;
                while (end < pattern.length && pattern[end] !== "]") { if (++work % 64 === 0) yield; end++; }
                if (end < pattern.length) { contents = pattern.slice(i + 1, end); i = end; }
            }
            for (const position of positions) {
                if (++work % 64 === 0) yield;
                const character = name[position];
                if (character === undefined) continue;
                let included = token === "?" || character === literal;
                if (contents !== undefined) {
                    const negated = contents[0] === "!" || contents[0] === "^";
                    included = false;
                    for (let c = negated ? 1 : 0; c < contents.length; c++) {
                        if (++work % 64 === 0) yield;
                        let start = contents[c]!;
                        if (start === "\\" && c + 1 < contents.length) start = contents[++c]!;
                        if (contents[c + 1] === "-" && c + 2 < contents.length) {
                            included ||= character >= start && character <= contents[c + 2]!;
                            c += 2;
                        } else included ||= character === start;
                    }
                    if (negated) included = !included;
                }
                if (included) next.add(position + 1);
            }
        }
        positions = next;
        if (!positions.size) return false;
    }
    return positions.has(name.length);
}

export function* mogrifyTargets(target: string, paths: Iterable<string>): Generator<void, string[], void> {
    const slash = target.lastIndexOf("/");
    const directory = target.slice(0, slash + 1), pattern = target.slice(slash + 1);
    if (!["*", "?", "["].some(token => pattern.includes(token))) return [target];
    let work = 0;
    const found: string[] = [];
    for (const path of paths) {
        if (++work % 64 === 0) yield;
        if (path.slice(0, path.lastIndexOf("/") + 1) !== directory) continue;
        const name = path.slice(path.lastIndexOf("/") + 1);
        if (name.startsWith(".") && !pattern.startsWith(".")) continue;
        if (yield* matchesMagickGlob(pattern, name)) found.push(path);
    }
    return found.length ? found.sort((a, b) => {
        const left = a.toLowerCase(), right = b.toLowerCase();
        return left < right ? -1 : left > right ? 1 : 0;
    }) : [target];
}

export async function mogrifyFileTargets(target: string, filesystem: FileSystem, cwd: string, signal: AbortSignal): Promise<string[]> {
    const slash = target.lastIndexOf("/");
    const directory = target.slice(0, slash + 1), pattern = target.slice(slash + 1);
    if (!["*", "?", "["].some(token => pattern.includes(token))) return [target];
    try {
        const entries = await filesystem.readdir(resolvePath(cwd, directory || "."), { signal });
        return await drainCooperativeSteps(mogrifyTargets(target, entries.filter(entry => entry.type !== "directory").map(entry => directory + entry.name)), signal);
    } catch (error) {
        signal.throwIfAborted();
        if (error instanceof FsError && ["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(error.code)) return [target];
        throw error;
    }
}
