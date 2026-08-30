import { dirname, isPathWithin, resolvePath } from "../../contracts/index.js";
import { applyPax, numberField, parseHeader, parsePax } from "./format.js";
import { Budget, checkPath, display, fail, hasIdentity, maybeStat, operation, publish, sameIdentity, text, vfsPath } from "./internal.js";
import { Exclusions } from "./options.js";
import { Reader } from "./stream.js";
function relativeName(name, strip) {
    if (name.includes("\0"))
        fail("NUL in member name");
    const components = name.replace(/^\/+/u, "").split("/").filter(component => component !== "");
    if (components.includes(".."))
        fail(`unsafe parent component in member: ${display(name)}`);
    const stripped = components.slice(strip).filter(component => component !== ".");
    if (components.length <= strip)
        return undefined;
    return stripped.join("/");
}
async function checkRoot(context, root) {
    let path = "/";
    for (const component of root.split("/").filter(Boolean)) {
        path = resolvePath(path, component);
        const stat = await operation(context, () => context.fs.lstat(path, { signal: context.signal }));
        if (stat.type !== "directory")
            fail(`extraction root has a non-directory or symlink ancestor: ${display(path)}`);
    }
    const stat = await operation(context, () => context.fs.lstat(root, { signal: context.signal }));
    if (stat.type !== "directory")
        fail(`not an extraction directory: ${display(root)}`);
}
async function parents(context, root, path, create, allowMissing = false) {
    if (!isPathWithin(root, path))
        fail("extraction path escapes root");
    await checkRoot(context, root);
    const relative = path.slice(root === "/" ? 1 : root.length + 1);
    let parent = root;
    for (const component of relative.split("/").slice(0, -1)) {
        if (!component)
            continue;
        parent = resolvePath(parent, component);
        const stat = await maybeStat(context, parent);
        if (!stat && create)
            await operation(context, () => context.fs.mkdir(parent, { signal: context.signal, mode: 0o700 }));
        else if ((!stat && !allowMissing) || (stat && stat.type !== "directory"))
            fail(`unsafe non-directory or symlink ancestor: ${display(parent)}`);
    }
}
async function removeExisting(context, path, stat) {
    if (!stat)
        return;
    if (stat.type === "directory") {
        if (!context.fs.rmdir)
            fail("filesystem does not support safe empty-directory replacement");
        await operation(context, () => context.fs.rmdir(path, { signal: context.signal }));
    }
    else
        await operation(context, () => context.fs.rm(path, { signal: context.signal }));
}
async function checkSymlinkTarget(context, root, path, target, budget) {
    if (target.startsWith("/"))
        fail(`symlink target escapes extraction root: ${display(path)}`);
    let current = dirname(path);
    let pending = target.split("/");
    let links = 0;
    let steps = 0;
    const safeComponents = (value) => {
        const components = value.split("/");
        let descended = false;
        for (const component of components) {
            if (component === ".." && descended)
                fail("symlink targets with non-leading '..' components are unsafe under later link replacement");
            if (component !== ".." && component !== "." && component !== "")
                descended = true;
        }
        return components;
    };
    pending = safeComponents(target);
    while (pending.length) {
        if (++steps > budget.limits.maxDepth * 41)
            fail("symlink target resolution limit exceeded");
        const component = pending.shift();
        if (!component || component === ".")
            continue;
        if (component === "..") {
            if (current === root)
                fail(`symlink target escapes extraction root: ${display(path)}`);
            current = dirname(current);
            continue;
        }
        const candidate = resolvePath(current, component);
        if (!isPathWithin(root, candidate))
            fail("symlink target escapes extraction root");
        const stat = await maybeStat(context, candidate);
        if (stat?.type === "symlink") {
            if (++links > 40 || !context.fs.readlink)
                fail("symlink target chain cannot be safely resolved");
            const link = await operation(context, () => context.fs.readlink(candidate, { signal: context.signal }));
            checkPath(link, budget.limits);
            if (link.startsWith("/")) {
                if (root !== "/" && link !== root && !link.startsWith(`${root}/`))
                    fail("symlink target chain escapes extraction root");
                current = root;
                pending = [...safeComponents(link.slice(root === "/" ? 1 : root.length)), ...pending];
            }
            else
                pending = [...safeComponents(link), ...pending];
        }
        else
            current = candidate;
    }
}
async function metadata(context, path, entry) {
    if (context.fs.chmod && context.fs.capabilities.permissions !== false) {
        await operation(context, () => context.fs.chmod(path, entry.mode & 0o777, { signal: context.signal }));
    }
    if (context.fs.utimes && context.fs.capabilities.timestamps !== false) {
        const atime = entry.atime ?? (entry.atimeDeleted ? undefined : entry.mtime);
        const mtime = entry.mtime;
        if (atime === undefined && mtime === undefined)
            return;
        const current = atime === undefined || mtime === undefined
            ? await operation(context, () => context.fs.stat(path, { signal: context.signal })) : undefined;
        await operation(context, () => context.fs.utimes(path, atime === undefined ? current.atimeMs : atime * 1000, mtime === undefined ? current.mtimeMs : mtime * 1000, { signal: context.signal }));
    }
}
function verbose(entry) {
    const type = entry.type === "5" ? "d" : entry.type === "2" ? "l" : entry.type === "1" ? "h" : "-";
    let permissions = "";
    for (const bit of [0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001])
        permissions += entry.mode & bit ? (bit & 0o444 ? "r" : bit & 0o222 ? "w" : "x") : "-";
    for (const [offset, special, execute, lower, upper] of [[2, 0o4000, 0o100, "s", "S"], [5, 0o2000, 0o010, "s", "S"], [8, 0o1000, 0o001, "t", "T"]]) {
        if (entry.mode & special)
            permissions = permissions.slice(0, offset) + (entry.mode & execute ? lower : upper) + permissions.slice(offset + 1);
    }
    const suffix = entry.type === "2" ? ` -> ${display(entry.linkname)}` : entry.type === "1" ? ` link to ${display(entry.linkname)}` : "";
    return `${type}${permissions} ${entry.uid ?? "-"}/${entry.gid ?? "-"} ${entry.size} ${entry.mtime ?? "-"} ${display(entry.name)}${suffix}\n`;
}
export async function readArchive(context, source, options, budget) {
    const reader = new Reader(source, context.signal);
    const exclusions = new Exclusions(options.excludes, budget.limits.maxPatternSteps);
    const global = new Map();
    let local = new Map();
    let pending = false;
    let longName;
    let longLink;
    let warnedAbsolute = false;
    const matched = new Set();
    const published = new Map();
    const directories = new Map();
    let archivePath;
    let archiveStat;
    if (options.mode === "x" && options.archive !== "-") {
        archivePath = await operation(context, () => context.fs.realpath(vfsPath(context.cwd, options.archive), { signal: context.signal }));
        archiveStat = await operation(context, () => context.fs.stat(archivePath, { signal: context.signal }));
    }
    if (options.mode === "x")
        await checkRoot(context, resolvePath(options.cwd));
    try {
        while (true) {
            const block = await reader.exact(512);
            if (block.every(byte => byte === 0)) {
                if (!(await reader.exact(512)).every(byte => byte === 0))
                    fail("missing second end-of-archive block");
                if (pending)
                    fail("orphan extended header at end of archive");
                await reader.finish();
                break;
            }
            const header = parseHeader(block);
            await budget.member();
            if (["x", "g", "L", "K"].includes(header.type)) {
                const size = numberField(block, 124, 12);
                if (size > budget.limits.maxPaxBytes)
                    fail("extended header byte limit exceeded");
                const payload = await reader.exact(size);
                await reader.padding(size);
                if (header.type === "x" || header.type === "g") {
                    const values = parsePax(payload);
                    if (header.type === "g") {
                        for (const [key, value] of values)
                            global.set(key, value);
                    }
                    else {
                        for (const [key, value] of values)
                            local.set(key, value);
                        pending = true;
                    }
                    for (const state of [global, local]) {
                        if ([...state].reduce((size, [key, value]) => size + Buffer.byteLength(key) + Buffer.byteLength(value), 0) > budget.limits.maxPaxBytes)
                            fail("PAX state byte limit exceeded");
                    }
                }
                else {
                    if (payload.length === 0 || payload.at(-1) !== 0)
                        fail("invalid GNU long-name record");
                    const value = text(payload.subarray(0, -1));
                    checkPath(value, budget.limits);
                    if (header.type === "L")
                        longName = value;
                    else
                        longLink = value;
                    pending = true;
                }
                continue;
            }
            const entry = applyPax(header, global, local, longName, longLink);
            local = new Map();
            pending = false;
            longName = undefined;
            longLink = undefined;
            checkPath(entry.name, budget.limits);
            if (entry.mtime !== undefined && (!Number.isFinite(entry.mtime) || Math.abs(entry.mtime * 1000) > 8.64e15))
                fail("archive timestamp is outside the supported range");
            if (entry.linkname)
                checkPath(entry.linkname, budget.limits);
            if (entry.type === "0" && entry.name.endsWith("/"))
                entry.type = "5";
            if (!["0", "1", "2", "5"].includes(entry.type))
                fail(`unsupported archive entry type: ${display(entry.type)}`);
            if (entry.type !== "0" && entry.size !== 0)
                fail("non-file entry has a nonzero payload size");
            if (entry.size > budget.limits.maxEntryBytes)
                fail("entry byte limit exceeded");
            if (entry.size > budget.limits.maxTotalBytes - budget.totalBytes)
                fail("total payload byte limit exceeded");
            budget.totalBytes += entry.size;
            let relative;
            if (options.mode === "x")
                relative = relativeName(entry.name, options.strip);
            const name = entry.name.replace(/^\/+/u, "");
            let selected = options.operands.length === 0;
            let root = resolvePath(options.cwd);
            for (let index = 0; index < options.operands.length; index++) {
                const operand = options.operands[index];
                const wanted = operand.name.replace(/^\/+/u, "").replace(/\/+$/u, "");
                if (name.replace(/\/+$/u, "") === wanted || name.startsWith(`${wanted}/`)) {
                    if (!selected)
                        root = resolvePath(operand.cwd);
                    selected = true;
                    matched.add(index);
                }
            }
            if (!selected || exclusions.matches(name)) {
                await reader.discard(entry.size);
                await reader.padding(entry.size);
                continue;
            }
            if (options.mode === "t") {
                await budget.output(options.verbose ? verbose(entry) : `${display(entry.name)}\n`);
                await reader.discard(entry.size);
                await reader.padding(entry.size);
                continue;
            }
            if (entry.name.startsWith("/") && !warnedAbsolute) {
                await budget.output("tar: removing leading '/' from member names\n", true);
                warnedAbsolute = true;
            }
            if (relative === undefined) {
                await reader.discard(entry.size);
                await reader.padding(entry.size);
                continue;
            }
            const path = resolvePath(root, relative);
            if (path === root && entry.type !== "5")
                fail("non-directory entry would replace extraction root");
            let hardTarget;
            if (entry.type === "2") {
                await parents(context, root, path, false, true);
                checkPath(entry.linkname, budget.limits);
                await checkSymlinkTarget(context, root, path, entry.linkname, budget);
                if (!context.fs.symlink || context.fs.capabilities.symlinks === false)
                    fail("filesystem does not support symbolic links");
            }
            else if (entry.type === "1") {
                checkPath(entry.linkname, budget.limits);
                const targetName = relativeName(entry.linkname, options.strip);
                if (targetName === undefined)
                    fail("hardlink target removed by strip-components");
                hardTarget = resolvePath(root, targetName);
                if (hardTarget === path)
                    fail("self-referential hardlink entry is unsupported");
                if (!published.has(hardTarget))
                    fail(`hardlink target was not previously extracted (forward or unselected target): ${display(entry.linkname)}`);
                await parents(context, root, hardTarget, false);
                const targetStat = await operation(context, () => context.fs.lstat(hardTarget, { signal: context.signal }));
                if (targetStat.type !== "file" || (published.get(hardTarget).identityScope !== undefined && !sameIdentity(published.get(hardTarget), targetStat)))
                    fail("hardlink target changed or is not a regular file");
                if (!context.fs.link || context.fs.capabilities.hardlinks === false)
                    fail("filesystem does not support hardlinks");
            }
            await parents(context, root, path, true);
            const existing = await maybeStat(context, path);
            if (archivePath && (path === archivePath || (existing && archiveStat && sameIdentity(existing, archiveStat))))
                fail("entry would overwrite the input archive");
            if (existing?.type === "file" && archiveStat && (!hasIdentity(existing) || !hasIdentity(archiveStat)))
                fail("cannot replace an existing file with unknown input-archive/destination backing identity");
            if (entry.type === "2") {
                await removeExisting(context, path, existing);
                published.delete(path);
                directories.delete(path);
                await operation(context, () => context.fs.symlink(entry.linkname, path, { signal: context.signal }));
            }
            else if (entry.type === "1") {
                await removeExisting(context, path, existing);
                published.delete(path);
                directories.delete(path);
                await operation(context, () => context.fs.link(hardTarget, path, { signal: context.signal }));
                published.set(path, await operation(context, () => context.fs.lstat(path, { signal: context.signal })));
            }
            else if (entry.type === "5") {
                if (existing?.type !== "directory") {
                    await removeExisting(context, path, existing);
                    await operation(context, () => context.fs.mkdir(path, { signal: context.signal, mode: 0o700 }));
                }
                published.delete(path);
                directories.set(path, { root, entry });
            }
            else {
                await removeExisting(context, path, existing);
                published.delete(path);
                directories.delete(path);
                await publish(context, path, reader.body(entry.size));
                await metadata(context, path, entry);
                published.set(path, await operation(context, () => context.fs.lstat(path, { signal: context.signal })));
            }
            await reader.padding(entry.size);
            if (options.verbose)
                await budget.output(`${display(entry.name)}\n`);
        }
        for (let index = 0; index < options.operands.length; index++)
            if (!matched.has(index))
                fail(`member not found: ${display(options.operands[index].name)}`);
        for (const [path, value] of [...directories].sort(([first], [second]) => second.length - first.length)) {
            await parents(context, value.root, path, false);
            const stat = await operation(context, () => context.fs.lstat(path, { signal: context.signal }));
            if (stat.type !== "directory")
                fail("directory changed before metadata restoration");
            await metadata(context, path, value.entry);
        }
    }
    finally {
        void reader.close().catch(() => { });
    }
}
//# sourceMappingURL=extract.js.map