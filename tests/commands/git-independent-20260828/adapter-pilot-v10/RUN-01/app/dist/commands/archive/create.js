import { dirname, readBytes, resolvePath } from "../../contracts/index.js";
import { encodeEntry } from "./format.js";
import { Budget, checkPath, display, fail, fileSource, hasIdentity, maybeStat, operation, sameIdentity, vfsPath } from "./internal.js";
import { Exclusions } from "./options.js";
function safeName(name) {
    const relative = name.replace(/^\/+/u, "");
    const components = relative.split("/");
    return components.slice(components.lastIndexOf("..") + 1).join("/") || ".";
}
export async function manifest(context, options, budget) {
    const exclusions = new Exclusions(options.excludes, budget.limits.maxPatternSteps);
    const entries = [];
    let output;
    let outputStat;
    if (options.archive !== "-") {
        const path = vfsPath(context.cwd, options.archive);
        outputStat = await maybeStat(context, path);
        if (outputStat && outputStat.type !== "file")
            fail("output archive must be a regular file, not a symlink or directory");
        if (outputStat && !hasIdentity(outputStat))
            fail("cannot safely replace an archive with unknown backing identity");
        const parent = await operation(context, () => context.fs.realpath(dirname(path), { signal: context.signal }));
        output = resolvePath(parent, path.slice(path.lastIndexOf("/") + 1));
    }
    const identities = new Map();
    const bindings = new Map();
    const visit = async (path, name, depth, explicit) => {
        checkPath(name, budget.limits);
        if (depth > budget.limits.maxDepth)
            fail("source traversal depth limit exceeded");
        await budget.member();
        if (exclusions.matches(name))
            return;
        const stat = await operation(context, () => context.fs.lstat(path, { signal: context.signal }));
        const canonical = stat.type === "symlink" ? path : await operation(context, () => context.fs.realpath(path, { signal: context.signal }));
        if (output && (canonical === output || (outputStat && sameIdentity(stat, outputStat)))) {
            if (explicit)
                fail(`input is the output archive: ${display(name)}`);
            await budget.output(`tar: ${display(name)}: file is the archive; not included\n`, true);
            return;
        }
        if (stat.type !== "file" && stat.type !== "directory" && stat.type !== "symlink")
            fail(`unsupported source type: ${display(name)}`);
        const entry = {
            name: stat.type === "directory" && !name.endsWith("/") ? `${name}/` : name,
            type: stat.type === "directory" ? "5" : stat.type === "symlink" ? "2" : "0",
            linkname: "", size: stat.type === "file" ? stat.size : 0,
            mode: stat.mode & 0o7777, uid: stat.uid ?? 0, gid: stat.gid ?? 0,
            mtime: options.format === "ustar" ? Math.floor(stat.mtimeMs / 1000) : stat.mtimeMs / 1000,
        };
        if (options.format === "pax")
            entry.atime = stat.atimeMs / 1000;
        if (stat.type === "symlink") {
            if ((stat.nlink ?? 1) > 1)
                fail("hardlinked symbolic-link sources are unsupported");
            if (!context.fs.readlink)
                fail("filesystem does not support readlink");
            entry.linkname = await operation(context, () => context.fs.readlink(path, { signal: context.signal }));
            checkPath(entry.linkname, budget.limits);
        }
        const archivePath = resolvePath("/", entry.name);
        const binding = bindings.get(archivePath);
        if (binding) {
            identities.get(binding.scope)?.get(binding.key)?.delete(archivePath);
            bindings.delete(archivePath);
        }
        if (stat.type === "file") {
            if (outputStat && !hasIdentity(stat))
                fail("cannot replace an existing archive when a source has unknown backing identity");
            if ((stat.nlink ?? 1) > 1 && !hasIdentity(stat))
                fail(`cannot preserve hardlinks without complete backing identity: ${display(name)}`);
            if (hasIdentity(stat)) {
                let scope = identities.get(stat.identityScope);
                if (!scope) {
                    scope = new Map();
                    identities.set(stat.identityScope, scope);
                }
                const key = `${stat.dev}:${stat.ino}`;
                let paths = scope.get(key);
                if (!paths) {
                    paths = new Map();
                    scope.set(key, paths);
                }
                const previous = paths.values().next().value;
                if (previous) {
                    entry.type = "1";
                    entry.linkname = previous.entry.name;
                    entry.size = 0;
                }
                paths.set(archivePath, { path, stat, entry });
                bindings.set(archivePath, { scope: stat.identityScope, key });
            }
            if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > budget.limits.maxEntryBytes)
                fail("entry byte limit exceeded");
            if (entry.size > budget.limits.maxTotalBytes - budget.totalBytes)
                fail("total payload byte limit exceeded");
            budget.totalBytes += entry.size;
        }
        const headers = encodeEntry(entry, budget.limits);
        if (options.format === "ustar" && headers.length > 1)
            fail(`metadata requires PAX format: ${display(name)}`);
        entries.push({ path, stat, entry });
        if (stat.type === "directory") {
            const children = await operation(context, () => context.fs.readdir(path, { signal: context.signal }));
            if (children.length > budget.limits.maxMembers - budget.members)
                fail("member/header limit exceeded");
            for (const child of children) {
                if (!child.name || child.name === "." || child.name === ".." || /[/\0]/u.test(child.name))
                    fail("invalid filesystem directory entry");
                await visit(resolvePath(canonical, child.name), `${entry.name}${child.name}`, depth + 1, false);
            }
        }
    };
    for (const operand of options.operands) {
        const base = await operation(context, () => context.fs.stat(operand.cwd, { signal: context.signal }));
        if (base.type !== "directory")
            fail(`not a directory: ${display(operand.cwd)}`);
        if (operand.name.startsWith("/"))
            await budget.output("tar: removing leading '/' from member names\n", true);
        if (operand.name.split("/").includes(".."))
            await budget.output("tar: removing member-name prefix through '..'\n", true);
        await visit(vfsPath(operand.cwd, operand.name), safeName(operand.name), 0, true);
    }
    return { entries, ...(output === undefined ? {} : { output }), ...(outputStat === undefined ? {} : { outputStat }) };
}
async function unchanged(context, source) {
    const current = await operation(context, () => context.fs.lstat(source.path, { signal: context.signal }));
    if (current.type !== source.stat.type || (source.stat.type !== "directory" && (current.size !== source.stat.size || current.mtimeMs !== source.stat.mtimeMs
        || current.ctimeMs !== source.stat.ctimeMs)) || (hasIdentity(source.stat) && !sameIdentity(source.stat, current)))
        fail(`source changed while archiving: ${display(source.entry.name)}`);
    if (source.stat.type === "symlink") {
        const target = await operation(context, () => context.fs.readlink(source.path, { signal: context.signal }));
        if (target !== source.entry.linkname)
            fail("source symlink changed while archiving");
    }
}
export async function* createArchive(context, entries, options, budget) {
    let headers = 0;
    for (const source of entries) {
        await unchanged(context, source);
        const encoded = encodeEntry(source.entry, budget.limits);
        headers += encoded.length > 1 ? 2 : 1;
        if (headers > budget.limits.maxMembers)
            fail("member/header limit exceeded");
        for (const chunk of encoded)
            if (chunk.length)
                yield chunk;
        if (options.verbose)
            await budget.output(`${display(source.entry.name)}\n`, options.archive === "-");
        if (source.entry.type === "0") {
            let bytes = 0;
            for await (const chunk of readBytes(fileSource(context, source.path, budget.limits), context.signal)) {
                if (chunk.length > source.entry.size - bytes)
                    fail(`source grew while archiving: ${display(source.entry.name)}`);
                bytes += chunk.length;
                yield chunk;
            }
            if (bytes !== source.entry.size)
                fail(`source shrank while archiving: ${display(source.entry.name)}`);
            await unchanged(context, source);
            const padding = (512 - bytes % 512) % 512;
            if (padding)
                yield new Uint8Array(padding);
        }
    }
    yield new Uint8Array(1024);
}
//# sourceMappingURL=create.js.map