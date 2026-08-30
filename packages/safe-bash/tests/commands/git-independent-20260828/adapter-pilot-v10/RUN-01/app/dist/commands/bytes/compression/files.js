import { randomUUID } from "node:crypto";
import { dirname, FsError, joinPath, } from "../../../contracts/index.js";
import { codeOf, pathOf } from "../../internal.js";
import { chunkBytes, stagingLimit, transform } from "./stream.js";
function sameIdentity(first, second) {
    return first.ino !== undefined && second.ino !== undefined
        && first.ino === second.ino && first.dev === second.dev;
}
function sameSnapshot(first, second) {
    return first.type === second.type && first.size === second.size && first.mode === second.mode
        && first.mtimeMs === second.mtimeMs && first.ctimeMs === second.ctimeMs
        && first.ino === second.ino && first.dev === second.dev && first.nlink === second.nlink
        && first.birthtimeMs === second.birthtimeMs && first.uid === second.uid && first.gid === second.gid;
}
function sameEntry(first, second) {
    return first.type === second.type && first.ino === second.ino && first.dev === second.dev
        && first.birthtimeMs === second.birthtimeMs;
}
async function existing(context, path) {
    try {
        return await context.fs.lstat(path, { signal: context.signal });
    }
    catch (error) {
        if (codeOf(error) === "ENOENT")
            return undefined;
        throw error;
    }
}
function outputPath(source, options) {
    if (options.decompress) {
        if (/\.(?:tgz|taz)$/iu.test(source))
            return source.slice(0, -4) + ".tar";
        const suffix = /(?:\.gz|\.z|-gz|-z|_z)$/iu.exec(source);
        if (!suffix)
            throw new FsError("EINVAL", { path: source, message: "unknown gzip suffix (use -c for stdout)" });
        const destination = source.slice(0, -suffix[0].length);
        if (destination === dirname(source) || destination.endsWith("/"))
            throw new FsError("EINVAL", { path: source, message: "empty output filename" });
        return destination;
    }
    if (!options.force && /(?:\.gz|\.z|-gz|-z|_z|\.tgz|\.taz)$/iu.test(source)) {
        throw new FsError("EINVAL", { path: source, message: "already has a gzip suffix (use -f to compress again)" });
    }
    return source + ".gz";
}
export async function planOperands(context, options) {
    const plans = [];
    for (const name of options.operands) {
        context.signal.throwIfAborted();
        if (name === "-") {
            plans.push({ source: "-" });
            continue;
        }
        if (!name)
            throw new FsError("ENOENT", { path: name });
        if (!context.fs.readStream || context.fs.capabilities.streamingRead === false) {
            throw new FsError("ENOTSUP", { message: "named input requires VFS streaming reads; no readFile fallback" });
        }
        const source = pathOf(context, name);
        const sourceStat = await context.fs.lstat(source, { signal: context.signal });
        if (sourceStat.type !== "file")
            throw new FsError("EINVAL", { path: source, message: "input must be a regular, non-symlink file" });
        const realSource = await context.fs.realpath(source, { signal: context.signal });
        if (options.stdout || options.test) {
            plans.push({ source, sourceStat, realSource });
            continue;
        }
        if (context.fs.capabilities.readOnly === true) {
            throw new FsError("EROFS", { syscall: context.command, path: realSource });
        }
        if (!context.fs.writeStream || context.fs.capabilities.streamingWrite === false) {
            throw new FsError("ENOTSUP", { message: "file output requires VFS streaming writes (use -c for stdout)" });
        }
        if (!options.keep && !options.force && (sourceStat.nlink ?? 1) > 1) {
            throw new FsError("EINVAL", { path: source, message: "input has multiple links (use -k or -f)" });
        }
        const destination = outputPath(realSource, options);
        const destinationStat = await existing(context, destination);
        if (destinationStat) {
            if (destinationStat.type !== "file" || sameIdentity(sourceStat, destinationStat)
                || realSource === await context.fs.realpath(destination, { signal: context.signal })) {
                throw new FsError("EINVAL", { path: destination, message: "destination is not a distinct regular file" });
            }
            if (!options.force)
                throw new FsError("EEXIST", { path: destination });
            if (context.fs.capabilities.atomicRename !== true) {
                throw new FsError("ENOTSUP", { path: destination, message: "forced replacement requires VFS atomicRename" });
            }
        }
        plans.push({ source, sourceStat, realSource, destination, ...(destinationStat ? { destinationStat } : {}) });
    }
    const destinations = new Set();
    for (const plan of plans) {
        if (!plan.destination)
            continue;
        const parent = await context.fs.realpath(dirname(plan.destination), { signal: context.signal });
        const realDestination = joinPath(parent, plan.destination.slice(plan.destination.lastIndexOf("/") + 1));
        if (destinations.has(realDestination) || plans.some((other) => other.realSource === realDestination
            || (plan.destinationStat && other.sourceStat && sameIdentity(plan.destinationStat, other.sourceStat)))) {
            throw new FsError("EINVAL", { path: plan.destination, message: "overlapping input/output operands" });
        }
        destinations.add(realDestination);
    }
    return plans;
}
export async function unchangedSource(context, plan) {
    if (!plan.sourceStat)
        return;
    const current = await context.fs.lstat(plan.source, { signal: context.signal });
    if (!sameSnapshot(plan.sourceStat, current)
        || await context.fs.realpath(plan.source, { signal: context.signal }) !== plan.realSource) {
        throw new FsError("EBUSY", { path: plan.source, message: "input identity or metadata changed; input retained" });
    }
}
async function temporaryDirectory(context, destination) {
    for (let attempt = 0; attempt < 16; attempt++) {
        const path = joinPath(dirname(destination), `.virtual-bash-gzip-${randomUUID()}`);
        try {
            await context.fs.mkdir(path, { mode: 0o700, signal: context.signal });
            return path;
        }
        catch (error) {
            if (codeOf(error) !== "EEXIST")
                throw error;
        }
    }
    throw new FsError("EEXIST", { message: "unable to allocate a private gzip staging directory" });
}
export async function writeFileOperand(context, plan, options) {
    const destination = plan.destination;
    await unchangedSource(context, plan);
    const directory = await temporaryDirectory(context, destination);
    const staged = joinPath(directory, "data");
    let directoryStat;
    let stageStat;
    let stageOwned = false;
    let moved = false;
    let failure;
    let failed = false;
    let warned = false;
    try {
        directoryStat = await context.fs.lstat(directory, { signal: context.signal });
        if (directoryStat.type !== "directory")
            throw new FsError("EBUSY", { path: directory });
        await context.fs.writeFile(staged, new Uint8Array(), { flag: "wx", mode: 0o600, signal: context.signal });
        stageOwned = true;
        stageStat = await context.fs.lstat(staged, { signal: context.signal });
        if (stageStat.type !== "file" || stageStat.size !== 0)
            throw new FsError("EBUSY", { path: staged });
        warned = await transform((signal) => context.fs.readStream(plan.source, { signal, chunkSize: chunkBytes }), async (output, signal) => {
            await context.fs.writeStream(staged, output, { flag: "w", mode: 0o600, signal });
        }, { ...options, force: false }, context.signal, stagingLimit);
        await unchangedSource(context, plan);
        const target = await existing(context, destination);
        if (plan.destinationStat ? !target || !sameSnapshot(plan.destinationStat, target) : target !== undefined) {
            throw new FsError("EBUSY", { path: destination, message: "destination changed during compression" });
        }
        if (!sameEntry(stageStat, await context.fs.lstat(staged, { signal: context.signal }))) {
            throw new FsError("EBUSY", { path: staged, message: "staging identity changed" });
        }
        if (plan.destinationStat) {
            await context.fs.rename(staged, destination, { signal: context.signal });
            moved = true;
        }
        else
            await context.fs.copyFile(staged, destination, { exclusive: true, signal: context.signal });
        context.signal.throwIfAborted();
    }
    catch (error) {
        failed = true;
        failure = error;
    }
    try {
        const signal = AbortSignal.timeout(5_000);
        const currentDirectory = await context.fs.lstat(directory, { signal });
        if (directoryStat && !sameEntry(directoryStat, currentDirectory)) {
            throw new FsError("EBUSY", { path: directory, message: "staging directory identity changed; refusing cleanup" });
        }
        if (stageOwned && !moved) {
            let currentStage;
            try {
                currentStage = await context.fs.lstat(staged, { signal });
            }
            catch (error) {
                if (codeOf(error) !== "ENOENT")
                    throw error;
            }
            if (currentStage) {
                if (!stageStat || !sameEntry(stageStat, currentStage)) {
                    throw new FsError("EBUSY", { path: staged, message: "staging file identity changed; refusing cleanup" });
                }
                await context.fs.rm(staged, { signal });
            }
        }
        if ((await context.fs.readdir(directory, { signal })).length) {
            throw new FsError("ENOTEMPTY", { path: directory, message: "unexpected staging entries; refusing recursive cleanup" });
        }
        await context.fs.rm(directory, { recursive: true, signal });
    }
    catch (error) {
        if (failed)
            throw new AggregateError([failure, error], "compression failed and staging cleanup failed; input retained");
        throw error;
    }
    if (failed)
        throw failure;
    if (!options.keep) {
        await unchangedSource(context, plan);
        await context.fs.rm(plan.source, { signal: context.signal });
    }
    return warned;
}
//# sourceMappingURL=files.js.map