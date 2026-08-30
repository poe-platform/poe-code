import { relativePath } from "../../contracts/index.js";
import { pathspecs, quote, selected } from "./arguments.js";
import { patch } from "./diff.js";
import { ignored, ignoreFile } from "./ignore.js";
import { objectPath, parent } from "./io.js";
import { GIT_LIMITS, GitFailure, demand } from "./limits.js";
import { Repository } from "./repository.js";
function change(before, after) {
    if (!before)
        return after ? "A" : " ";
    if (!after)
        return "D";
    if ((before.mode & 0o170000) !== (after.mode & 0o170000))
        return "T";
    return before.mode !== after.mode || before.oid !== after.oid ? "M" : " ";
}
async function blob(repository, entry) {
    if (!entry)
        return undefined;
    const object = await repository.object(entry.oid);
    demand(object.type === "blob", "Git index/tree leaf is not a blob");
    return { ...entry, bytes: object.bytes };
}
async function attributes(repository, specs, maps, worktree) {
    const session = repository.session;
    const check = async (bytes) => {
        for (const line of session.text(bytes).split("\n")) {
            await session.step(line.length + 1);
            demand(!line.trim() || line.trimStart().startsWith("#"), "M1A active Git attributes unsupported");
        }
    };
    const info = await session.read(session.path(repository.gitdir, "info/attributes"), GIT_LIMITS.maxMetadataBytes, true, true);
    if (info) {
        try {
            await check(info);
        }
        finally {
            session.release(info);
        }
    }
    const names = new Set([".gitattributes"]);
    for (const map of maps)
        for (const name of map.keys()) {
            if (!selected(name, specs))
                continue;
            let directory = parent(name);
            while (directory !== "." && directory !== "/") {
                names.add(directory + "/.gitattributes");
                directory = parent(directory);
            }
            if (name.endsWith("/.gitattributes"))
                names.add(name);
        }
    for (const spec of specs) {
        let directory = spec;
        while (directory && directory !== "." && directory !== "/") {
            names.add(directory + "/.gitattributes");
            directory = parent(directory);
        }
    }
    for (const name of names) {
        for (const map of maps) {
            const entry = map.get(name);
            if (!entry)
                continue;
            demand(entry.mode !== 0o120000, "symlinked Git attributes unsupported");
            const value = await blob(repository, entry);
            demand(value.bytes.length <= GIT_LIMITS.maxMetadataBytes, "Git attributes size exceeded");
            await check(value.bytes);
        }
        if (worktree && repository.root) {
            let directory = parent(name), obstructed = false;
            while (directory !== "." && directory !== "/") {
                const stat = await session.stat(session.path(repository.root, directory));
                if (!stat || stat.type !== "directory") {
                    obstructed = true;
                    break;
                }
                directory = parent(directory);
            }
            if (obstructed)
                continue;
            const value = await session.read(session.path(repository.root, name), GIT_LIMITS.maxMetadataBytes, true, true);
            if (value) {
                try {
                    await check(value);
                }
                finally {
                    session.release(value);
                }
            }
        }
    }
}
async function untracked(repository, parsed, tracked) {
    const session = repository.session, root = repository.root;
    const specs = pathspecs(parsed, root);
    const directories = new Set();
    for (const path of tracked) {
        let directory = parent(path);
        while (directory !== "." && directory !== "/") {
            await session.step(directory.length + 1);
            if (!directories.has(directory)) {
                session.reserve(directory.length * 2 + 24);
                directories.add(directory);
            }
            directory = parent(directory);
        }
    }
    const initial = await ignoreFile(session, session.path(repository.gitdir, "info/exclude"), "");
    const walk = async (directory, inherited, depth) => {
        demand(depth <= GIT_LIMITS.maxDepth, "Git worktree depth exceeded");
        const absolute = session.path(root, directory);
        const rules = [...inherited, ...await ignoreFile(session, session.path(absolute, ".gitignore"), directory)];
        const output = [];
        for (const name of await session.sorted((await session.list(absolute)).map(entry => entry.name))) {
            if (name.toLowerCase() === ".git") {
                demand(!directory && name === ".git", "nested/case-aliased Git repository unsupported");
                continue;
            }
            const path = directory ? directory + "/" + name : name;
            objectPath(path);
            const stat = (await session.stat(session.path(root, path)));
            demand(stat, "Git directory changed during scan");
            const hasTracked = tracked.has(path) || directories.has(path);
            await session.step(path.length + 1);
            if (!hasTracked && await ignored(session, rules, path, stat.type === "directory"))
                continue;
            if (stat.type === "directory") {
                const children = await walk(path, rules, depth + 1);
                if (children.length && !hasTracked && parsed.untracked === "normal" && selected(path, specs))
                    output.push(path + "/");
                else
                    output.push(...children);
            }
            else if (!tracked.has(path) && selected(path, specs)) {
                demand(stat.type === "file" || stat.type === "symlink", "unsupported Git worktree entry");
                output.push(path);
            }
        }
        return output;
    };
    return walk("", initial, 0);
}
function display(repository, parsed, path, porcelain = false) {
    const name = porcelain ? path : relativePath(parsed.cwd, repository.session.path(repository.root ?? repository.cwd, path)) + (path.endsWith("/") ? "/" : "");
    return parsed.flags.has("-z") ? name : quote(name);
}
export async function status(repository, parsed) {
    demand(repository.root, "Git status requires a worktree");
    const session = repository.session, specs = pathspecs(parsed, repository.root);
    const index = await repository.index(), head = await repository.tree(await repository.revision("HEAD", true));
    const cached = new Map(index.filter(entry => entry.stage === 0).map(entry => [entry.path, entry]));
    await attributes(repository, specs, [head, cached], true);
    const stages = new Map();
    for (const entry of index)
        if (entry.stage)
            stages.set(entry.path, (stages.get(entry.path) ?? 0) | 1 << (entry.stage - 1));
    const rows = [];
    const conflict = { 1: "DD", 2: "AU", 4: "UA", 3: "UD", 5: "DU", 6: "AA", 7: "UU" };
    for (const path of await session.sorted(new Set([...head.keys(), ...cached.keys(), ...stages.keys()]))) {
        if (!selected(path, specs))
            continue;
        if (stages.has(path)) {
            rows.push({ path, code: conflict[stages.get(path)] });
            continue;
        }
        const entry = cached.get(path), working = entry ? await repository.working(entry) : undefined;
        const code = change(head.get(path), entry) + (entry ? change(entry, working) : " ");
        if (working)
            session.release(working.bytes);
        if (code !== "  ")
            rows.push({ path, code });
    }
    if (parsed.untracked !== "no")
        for (const path of await untracked(repository, parsed, new Set(index.map(entry => entry.path))))
            rows.push({ path, code: "??" });
    await session.unchanged();
    const porcelain = ["--porcelain", "--porcelain=v1", "-z"].some(flag => parsed.flags.has(flag));
    for (const row of rows)
        await session.output(`${row.code} ${display(repository, parsed, row.path, porcelain)}${parsed.flags.has("-z") ? "\0" : "\n"}`);
    return 0;
}
export async function diff(repository, parsed) {
    const session = repository.session, specs = pathspecs(parsed, repository.root);
    const cached = parsed.flags.has("--cached") || parsed.flags.has("--staged");
    demand(!cached || parsed.operands.length <= 1, "cached Git diff takes at most one revision");
    const working = !cached && parsed.operands.length < 2;
    demand(!working || repository.root, "working Git diff requires a worktree");
    const index = cached || working ? await repository.index() : [];
    demand(!index.some(entry => entry.stage && selected(entry.path, specs)), "selected unmerged Git diff unsupported");
    const indexMap = new Map(index.filter(entry => !entry.stage).map(entry => [entry.path, entry]));
    const before = parsed.operands[0] || cached ? await repository.tree(await repository.revision(parsed.operands[0] ?? "HEAD", cached && !parsed.operands[0])) : indexMap;
    const after = parsed.operands[1] ? await repository.tree(await repository.revision(parsed.operands[1])) : indexMap;
    await attributes(repository, specs, [before, after], working);
    await session.unchanged();
    let different = false;
    const paths = new Set([...before.keys(), ...after.keys()]);
    for (const path of await session.sorted(paths)) {
        if (!selected(path, specs))
            continue;
        const original = await blob(repository, before.get(path));
        const replacement = working ? after.has(path) ? await repository.working(after.get(path)) : undefined : await blob(repository, after.get(path));
        try {
            const code = change(original, replacement);
            if (code === " ")
                continue;
            different = true;
            if (parsed.flags.has("--quiet"))
                continue;
            if (parsed.flags.has("--name-only") || parsed.flags.has("--name-status")) {
                const prefix = parsed.flags.has("--name-status") ? code + (parsed.flags.has("-z") ? "\0" : "\t") : "";
                await session.output(prefix + (parsed.flags.has("-z") ? path : quote(path)) + (parsed.flags.has("-z") ? "\0" : "\n"));
            }
            else
                await patch(repository, parsed, path, original, replacement);
        }
        finally {
            if (working && replacement)
                session.release(replacement.bytes);
        }
    }
    return different && (parsed.flags.has("--quiet") || parsed.flags.has("--exit-code")) ? 1 : 0;
}
export async function query(repository, parsed) {
    const session = repository.session;
    if (parsed.command === "status")
        return status(repository, parsed);
    if (parsed.command === "diff")
        return diff(repository, parsed);
    if (parsed.command === "ls-files") {
        const specs = pathspecs(parsed, repository.root), rows = (await repository.index()).filter(entry => selected(entry.path, specs));
        await session.unchanged();
        for (const entry of rows)
            await session.output(`${parsed.flags.has("-s") || parsed.flags.has("--stage") ? `${entry.mode.toString(8)} ${entry.oid} ${entry.stage}\t` : ""}${display(repository, parsed, entry.path)}${parsed.flags.has("-z") ? "\0" : "\n"}`);
        return 0;
    }
    if (parsed.command === "rev-parse") {
        let value;
        if (parsed.flags.has("--show-toplevel")) {
            demand(repository.root, "bare Git repository has no toplevel");
            value = repository.root;
        }
        else if (parsed.flags.has("--absolute-git-dir"))
            value = repository.gitdir;
        else if (parsed.flags.has("--is-bare-repository"))
            value = String(!repository.root);
        else if (parsed.flags.has("--is-inside-work-tree"))
            value = String(Boolean(repository.root));
        else
            value = (await repository.revision(parsed.operands[0]));
        await session.unchanged();
        await session.output(value + "\n");
        return 0;
    }
    if (parsed.command === "show" && !parsed.flags.has("--no-patch")) {
        const operand = parsed.operands[0], colon = operand.indexOf(":");
        demand(colon > 0 && !parsed.format, "M1A show requires REV:path or --no-patch --format");
        const name = operand.slice(colon + 1);
        objectPath(name);
        const entries = await repository.tree(await repository.revision(operand.slice(0, colon)));
        const entry = entries.get(name);
        demand(entry, "Git tree path not found");
        const content = (await blob(repository, entry));
        await session.unchanged();
        await session.output(content.bytes);
        return 0;
    }
    let oid = await repository.revision(parsed.operands[0] ?? "HEAD");
    const limit = parsed.command === "show" ? 1 : parsed.count ?? GIT_LIMITS.maxCommits;
    const seen = new Set();
    await session.unchanged();
    for (let index = 0; oid && index < limit; index++) {
        oid = await repository.peel(oid, "commit");
        demand(!seen.has(oid), "cyclic Git history");
        seen.add(oid);
        const commit = await repository.commit(oid);
        let text = parsed.format === "oneline" ? await repository.abbreviation(oid) : oid;
        if (parsed.format !== "%H") {
            const message = session.text(commit.message), newline = message.indexOf("\n");
            const subject = newline < 0 ? message : message.slice(0, newline);
            demand(!/[\x00-\x1f\x7f]/.test(subject) && (newline < 0 || newline === message.length - 1 || message[newline + 1] === "\n"), "unsupported Git commit subject");
            text += " " + subject;
        }
        await session.output(text + "\n");
        oid = commit.parents[0];
        if (index + 1 === GIT_LIMITS.maxCommits && parsed.count === undefined && oid)
            throw new GitFailure("Git history limit exceeded");
    }
    return 0;
}
//# sourceMappingURL=queries.js.map