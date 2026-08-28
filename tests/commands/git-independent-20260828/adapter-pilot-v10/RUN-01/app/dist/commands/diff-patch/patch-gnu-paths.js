import { FsError, basename, dirname, isFsError, resolvePath } from "../../contracts/index.js";
import { safeTarget } from "./patch-path.js";
import { Budget, ToolError, host, inspect } from "./shared.js";
export function regular(stat, path) {
    if (stat && stat.type !== "file")
        throw new ToolError(`patch target is not a regular file: ${path}`);
    if (stat && (stat.nlink ?? 1) > 1)
        throw new ToolError(`hard-linked patch targets are unsupported: ${path}`);
}
function headerName(path, options) {
    const safe = safeTarget(path, 0, options.explicit !== undefined);
    if (safe === undefined)
        return undefined;
    if (options.explicit !== undefined)
        return safe;
    if (options.strip === undefined)
        return safe.split("/").at(-1);
    if (path.split(/\/+/u).filter(Boolean).length <= options.strip)
        return undefined;
    return safeTarget(path, options.strip);
}
export function rejectName(target, options) {
    return options.reject === "-" ? undefined : options.reject ?? `${target}.rej`;
}
export function pruneParents(target, cwd) {
    const stop = target.startsWith("/") ? "/" : resolvePath(cwd, ".");
    const parents = [];
    for (let path = dirname(resolvePath(cwd, target)); path !== stop && path !== "/"; path = dirname(path))
        parents.push(path);
    return parents;
}
export async function authorizePaths(patches, options, budget, state) {
    const result = [];
    for (const patch of patches) {
        budget.step();
        await budget.checkpoint();
        if (patch.unlocated) {
            result.push({ patch, oldName: undefined, newName: undefined, indexName: undefined, candidates: [] });
            continue;
        }
        if (patch.oldPath === "/dev/null" && patch.newPath === "/dev/null")
            throw new ToolError("both patch filenames are /dev/null");
        const oldName = headerName(patch.oldPath, options);
        const newName = headerName(patch.newPath, options);
        const indexHeader = patch.indexPath === undefined ? undefined : headerName(patch.indexPath, options);
        const indexName = patch.format === "normal" || (oldName === undefined && newName === undefined) ? indexHeader : undefined;
        const candidates = options.explicit === undefined ? [...new Set([oldName, newName, indexName].filter((name) => name !== undefined))] : [options.explicit];
        if (!candidates.length)
            throw new ToolError("strip count removes every patch filename");
        result.push({ patch, oldName, newName, indexName, candidates });
    }
    const order = result.map((_patch, index) => index);
    if (state?.reverse)
        order.reverse();
    budget.step(order.length);
    const lastChoice = order.findLastIndex(index => result[index].candidates.length > 1);
    for (const [position, index] of order.entries()) {
        const authorized = result[index];
        if (authorized.patch.unlocated)
            continue;
        const selected = await selectTarget(authorized, state?.exists ?? (async (path) => await candidateStat(path, budget) !== undefined), budget);
        const path = resolvePath(budget.context.cwd, selected);
        if (path === options.input)
            throw new ToolError(`patch target aliases patch input: ${path}`);
        regular(await inspect(budget, path), path);
        result[index] = { ...authorized, selected };
        if (position < lastChoice)
            await state?.advance(result[index]);
    }
    return result;
}
export async function backupName(path, budget) {
    const parent = dirname(path);
    if (!await inspect(budget, parent))
        return `${path}.orig`;
    const prefix = `${basename(path)}.~`;
    const entries = await host(budget.context, () => budget.context.fs.readdir(parent, { signal: budget.context.signal }));
    let maximum = 0n;
    for (const entry of entries) {
        budget.file();
        await budget.checkpoint();
        if (!entry.name || /[/\0]/u.test(entry.name) || entry.name === "." || entry.name === "..")
            throw new ToolError("unsafe directory entry in backup directory");
        if (!entry.name.startsWith(prefix) || !entry.name.endsWith("~"))
            continue;
        const version = entry.name.slice(prefix.length, -1);
        if (version.length > 4096)
            throw new ToolError("backup version length limit exceeded");
        if (!/^[1-9]\d*$/u.test(version))
            continue;
        const number = BigInt(version);
        if (number > maximum)
            maximum = number;
    }
    return maximum ? `${path}.~${maximum + 1n}~` : `${path}.orig`;
}
export async function authorizeOutputs(paths, targets, input, budget) {
    const outputs = new Set();
    for (const path of paths) {
        if (path === undefined)
            continue;
        budget.step();
        if (targets.has(path) || outputs.has(path) || path === input)
            throw new ToolError(`patch output aliases a target, input, or another output: ${path}`);
        outputs.add(path);
        regular(await inspect(budget, path), path);
    }
}
function rank(name) {
    return [name.split("/").length, Buffer.byteLength(name.split("/").at(-1)), Buffer.byteLength(name)];
}
export async function candidateStat(path, budget) {
    budget.step();
    await budget.checkpoint();
    try {
        return await host(budget.context, () => budget.context.fs.stat(path, { signal: budget.context.signal }));
    }
    catch (error) {
        if (isFsError(error, "ENOENT") || isFsError(error, "ENOTDIR") || isFsError(error, "ELOOP"))
            return undefined;
        throw error;
    }
}
export async function selectTarget(authorized, exists, budget) {
    const present = [];
    for (const candidate of authorized.candidates) {
        budget.step();
        if (await exists(resolvePath(budget.context.cwd, candidate)))
            present.push(candidate);
    }
    const candidates = present.length ? present : [...authorized.candidates];
    const missingParents = new Map();
    if (!present.length)
        for (const candidate of candidates) {
            let missing = 0;
            for (let parent = dirname(resolvePath(budget.context.cwd, candidate)); parent !== "/"; parent = dirname(parent)) {
                if (await exists(parent))
                    break;
                missing++;
            }
            missingParents.set(candidate, missing);
        }
    candidates.sort((left, right) => {
        const missing = (missingParents.get(left) ?? 0) - (missingParents.get(right) ?? 0);
        if (missing)
            return missing;
        const leftRank = rank(left);
        const rightRank = rank(right);
        for (let index = 0; index < leftRank.length; index++) {
            const order = leftRank[index] - rightRank[index];
            if (order)
                return order;
        }
        return 0;
    });
    return candidates[0];
}
export async function ensureParents(path, budget) {
    const missing = [];
    for (let parent = dirname(path);; parent = dirname(parent)) {
        const stat = await inspect(budget, parent);
        if (stat) {
            if (stat.type !== "directory")
                throw new ToolError(`not a directory: ${parent}`);
            break;
        }
        if (parent === "/")
            throw new ToolError("filesystem root does not exist");
        missing.push(parent);
    }
    for (const parent of missing.reverse()) {
        budget.step();
        await budget.checkpoint();
        await inspect(budget, parent);
        await host(budget.context, () => budget.context.fs.mkdir(parent, { signal: budget.context.signal }));
    }
}
export async function pruneDirectories(parents, budget) {
    for (const parent of [...parents].sort((left, right) => right.split("/").length - left.split("/").length)) {
        budget.step();
        await budget.checkpoint();
        const stat = await inspect(budget, parent);
        budget.context.signal.throwIfAborted();
        if (!stat)
            continue;
        if (stat.type !== "directory")
            throw new ToolError(`pruning path changed type: ${parent}`);
        try {
            const entries = await host(budget.context, () => budget.context.fs.readdir(parent, { signal: budget.context.signal }));
            budget.step(entries.length);
            if (entries.length)
                continue;
            const rmdir = budget.context.fs.rmdir;
            if (!rmdir)
                throw new FsError("ENOTSUP", { syscall: "rmdir", path: parent });
            try {
                await host(budget.context, () => rmdir.call(budget.context.fs, parent, { signal: budget.context.signal }));
            }
            catch (error) {
                budget.context.signal.throwIfAborted();
                if (!isFsError(error, "ENOTEMPTY"))
                    throw error;
            }
        }
        catch (error) {
            budget.context.signal.throwIfAborted();
            if (isFsError(error, "ENOENT"))
                continue;
            if (isFsError(error) || error instanceof ToolError)
                throw error;
            throw new ToolError(`cannot prune directory ${parent}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
//# sourceMappingURL=patch-gnu-paths.js.map