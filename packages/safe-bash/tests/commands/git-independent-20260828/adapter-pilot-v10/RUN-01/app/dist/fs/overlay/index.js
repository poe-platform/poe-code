import { randomUUID } from "node:crypto";
import { collectBytes, dirname, FsError, isPathWithin, normalizePath, readBytes, toFsError, validatePath, } from "../../contracts/index.js";
import { compareIdentity } from "../mount/identity.js";
import { compareEntries, registerEntryView } from "../mount/comparison.js";
function snapshotStat(stat) {
    const { type, size, allocatedBytes, mode, mtimeMs, atimeMs, ctimeMs, birthtimeMs, identityScope, ino, dev, nlink, uid, gid } = stat;
    return {
        type, size, mode, mtimeMs, atimeMs, ctimeMs,
        ...(allocatedBytes === undefined ? {} : { allocatedBytes }),
        ...(birthtimeMs === undefined ? {} : { birthtimeMs }),
        ...(identityScope === undefined ? {} : { identityScope }),
        ...(ino === undefined ? {} : { ino }),
        ...(dev === undefined ? {} : { dev }),
        ...(nlink === undefined ? {} : { nlink }),
        ...(uid === undefined ? {} : { uid }),
        ...(gid === undefined ? {} : { gid }),
    };
}
function hasCode(error, code) {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
function fail(code, path, message) {
    throw new FsError(code, { syscall: "overlay", path, ...(message === undefined ? {} : { message }) });
}
function integer(value, path) {
    if (!Number.isSafeInteger(value) || value < 0)
        fail("EINVAL", path);
}
function mode(value, path) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 0o7777))
        fail("EINVAL", path);
}
function movedPath(path, moves) {
    for (const move of moves) {
        if (isPathWithin(move.source, path))
            path = move.destination + path.slice(move.source.length);
    }
    return path;
}
async function waitForTurn(previous, signal) {
    signal?.throwIfAborted();
    if (!signal)
        return previous;
    return new Promise((resolve, reject) => {
        const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
        signal.addEventListener("abort", abort, { once: true });
        void previous.then(() => { signal.removeEventListener("abort", abort); resolve(); });
    });
}
export class OverlayFileSystem {
    capabilities;
    #upper;
    #lower;
    maxBufferBytes;
    whiteouts = new Set();
    opaque = new Set();
    garbage = new Set();
    activeStages = new Set();
    linkMetadata = new Map();
    linkOrigins = new Map();
    queue = Promise.resolve();
    constructor(options) {
        if (options.upper === options.lower)
            throw new TypeError("Overlay upper and lower must be distinct backends");
        this.#upper = options.upper;
        this.#lower = options.lower;
        registerEntryView(this, (path, options) => this.run(options, async () => {
            const entry = await this.required(path, options);
            return { filesystem: entry.backend, path: entry.path, readOnly: this.capabilities.readOnly === true };
        }, false));
        this.maxBufferBytes = options.maxBufferBytes ?? 64 * 1024 * 1024;
        integer(this.maxBufferBytes, "/");
        const writable = !this.#upper.capabilities.readOnly && this.#upper.capabilities.atomicRename === true;
        const readable = [this.#upper, this.#lower].map((backend) => typeof backend.readStream === "function" ? backend.capabilities.streamingRead : false);
        const streamingRead = readable.every((capability) => capability === true) ? true
            : readable.every((capability) => capability === false) ? false : undefined;
        const streamingWrite = writable && this.#upper.capabilities.streamingWrite === true
            && this.#upper.capabilities.streamingRead === true
            && typeof this.#upper.writeStream === "function" && typeof this.#upper.readStream === "function"
            ? readable.every((capability) => capability === true) ? true : undefined : false;
        this.capabilities = Object.freeze({
            readOnly: !writable,
            atomicRename: false,
            hardlinks: false,
            symlinks: writable && this.#upper.capabilities.symlinks === true
                && typeof this.#upper.symlink === "function" && typeof this.#upper.readlink === "function"
                && (this.#lower.capabilities.symlinks !== true || typeof this.#lower.readlink === "function"),
            permissions: writable && this.#upper.capabilities.permissions === true && typeof this.#upper.chmod === "function",
            timestamps: writable && this.#upper.capabilities.timestamps === true && typeof this.#upper.utimes === "function",
            ...(streamingRead === undefined ? {} : { streamingRead }),
            ...(streamingWrite === undefined ? {} : { streamingWrite }),
        });
        Object.defineProperty(this, "capabilities", { writable: false, configurable: false });
    }
    async run(options, operation, cleanup = true) {
        options.signal?.throwIfAborted();
        const previous = this.queue;
        let release;
        this.queue = new Promise((resolve) => { release = resolve; });
        try {
            await waitForTurn(previous, options.signal);
        }
        catch (error) {
            void previous.then(release);
            throw error;
        }
        try {
            options.signal?.throwIfAborted();
            if (cleanup)
                await this.cleanGarbage(false);
            return await operation();
        }
        finally {
            release();
        }
    }
    writable(path) {
        if (this.#upper.capabilities.readOnly)
            fail("EROFS", path);
        if (this.#upper.capabilities.atomicRename !== true)
            fail("ENOTSUP", path, "staged mutations require an atomic-rename-capable upper");
    }
    permission(entry, mask) {
        if (entry.backend.capabilities.permissions && ((entry.stat.mode >> 6) & mask) !== mask)
            fail("EACCES", entry.path);
    }
    async maybeStat(backend, path, options) {
        options.signal?.throwIfAborted();
        let stat;
        try {
            stat = await backend.lstat(path, options);
        }
        catch (error) {
            options.signal?.throwIfAborted();
            if (hasCode(error, "ENOENT"))
                return undefined;
            throw error;
        }
        return snapshotStat(stat);
    }
    hidden(path) {
        return [...this.garbage, ...this.activeStages].some((root) => isPathWithin(root, path));
    }
    async lowerVisible(path, options) {
        for (const root of this.whiteouts)
            if (isPathWithin(root, path))
                return false;
        for (const root of this.opaque)
            if (root !== path && isPathWithin(root, path))
                return false;
        const ancestors = path.split("/").filter(Boolean).slice(0, -1);
        let parent = "";
        for (const component of ancestors) {
            parent += `/${component}`;
            const stat = await this.maybeStat(this.#lower, parent, options);
            if (!stat || stat.type !== "directory")
                return false;
        }
        return true;
    }
    async lookup(path, options) {
        if (this.hidden(path))
            return undefined;
        const upper = await this.maybeStat(this.#upper, path, options);
        if (upper)
            return { path, backend: this.#upper, stat: { ...upper, ...(upper.type === "symlink" ? this.linkMetadata.get(path) : {}) } };
        if (!await this.lowerVisible(path, options))
            return undefined;
        const lower = await this.maybeStat(this.#lower, path, options);
        return lower ? { path, backend: this.#lower, stat: lower } : undefined;
    }
    async resolve(path, options, followFinal = true, allowMissing = false, createMode) {
        validatePath(path);
        if (!path)
            fail("ENOENT", path);
        const pending = path.split("/").filter(Boolean);
        if (path.endsWith("/"))
            pending.push(".");
        const verifications = [];
        const verified = async (location) => {
            for (const verification of verifications) {
                const canonical = await verification.backend.realpath(verification.path, options);
                options.signal?.throwIfAborted();
                validatePath(canonical);
                if (!canonical.startsWith("/"))
                    fail("EIO", verification.path, "backend returned a nonabsolute realpath");
                if (verification.finalName !== undefined) {
                    try {
                        await verification.backend.lstat(`${verification.path}/${verification.finalName}`, options);
                    }
                    catch (error) {
                        if (location.entry || !hasCode(error, "ENOENT"))
                            throw error;
                    }
                }
                const expected = verification.finalName === undefined ? canonical
                    : `${canonical === "/" ? "" : canonical}/${verification.finalName}`;
                if (location.path !== movedPath(expected, verification.moves ?? []))
                    fail("ENOTSUP", path, "backend cannot confirm the overlay symlink namespace");
            }
            options.signal?.throwIfAborted();
            return location;
        };
        let current = "/";
        let links = 0;
        while (pending.length) {
            options.signal?.throwIfAborted();
            const parent = await this.lookup(current, options);
            if (!parent)
                fail("ENOENT", current);
            if (parent.stat.type !== "directory")
                fail("ENOTDIR", current);
            this.permission(parent, 1);
            const component = pending.shift();
            if (component === ".")
                continue;
            if (component === "..") {
                current = dirname(current);
                continue;
            }
            if (new TextEncoder().encode(component).byteLength > 255)
                fail("ENAMETOOLONG", path);
            const candidate = current === "/" ? `/${component}` : `${current}/${component}`;
            if (this.hidden(candidate))
                fail(allowMissing || createMode !== undefined ? "EBUSY" : "ENOENT", candidate);
            let entry = await this.lookup(candidate, options);
            if (!entry && createMode !== undefined) {
                if (verifications.length)
                    fail("ENOTSUP", path, "recursive creation through symlinks cannot be verified before mutation");
                await this.makeDirectory(candidate, createMode, options);
                entry = await this.lookup(candidate, options);
            }
            if (!entry) {
                if (allowMissing && pending.length === 0)
                    return verified({ path: candidate });
                fail("ENOENT", candidate);
            }
            if (entry.stat.type === "symlink" && (followFinal || pending.length > 0)) {
                if (++links > 40)
                    fail("ELOOP", path);
                const suffix = [...pending];
                const last = suffix.at(-1);
                const finalName = !followFinal && last !== undefined && last !== "." && last !== ".." ? suffix.pop() : undefined;
                verifications.push({
                    backend: entry.backend,
                    path: candidate + (suffix.length ? `/${suffix.join("/")}` : ""),
                    finalName,
                });
                const origin = entry.backend === this.#upper ? this.linkOrigins.get(candidate) : undefined;
                if (origin)
                    verifications.push({
                        backend: this.#lower,
                        path: origin.path + (suffix.length ? `/${suffix.join("/")}` : ""),
                        finalName,
                        moves: origin.moves,
                    });
                const target = await this.linkTarget(entry, options);
                const parts = target.split("/").filter(Boolean);
                if (target.endsWith("/"))
                    parts.push(".");
                pending.unshift(...parts);
                if (target.startsWith("/"))
                    current = "/";
            }
            else
                current = candidate;
        }
        const entry = await this.lookup(current, options);
        if (!entry)
            fail("ENOENT", current);
        return verified({ path: current, entry });
    }
    async linkTarget(entry, options) {
        if (!entry.backend.readlink)
            fail("ENOTSUP", entry.path);
        const target = await entry.backend.readlink(entry.path, options);
        options.signal?.throwIfAborted();
        validatePath(target);
        if (!target)
            fail("ENOENT", entry.path);
        return target;
    }
    async movableLinkTarget(entry, options) {
        const target = await this.linkTarget(entry, options);
        const canonical = await entry.backend.realpath(entry.path, options);
        options.signal?.throwIfAborted();
        const parts = target.split("/").filter(Boolean);
        if (target.endsWith("/"))
            parts.push(".");
        let current = target.startsWith("/") ? "/" : dirname(entry.path);
        let stat = await this.maybeStat(entry.backend, current, options);
        for (const part of parts) {
            if (!stat)
                fail("ENOENT", current);
            if (stat.type !== "directory")
                fail("ENOTSUP", entry.path, "symlink copy-up requires an alias-free target path");
            if (part === ".")
                continue;
            current = part === ".." ? dirname(current) : `${current === "/" ? "" : current}/${part}`;
            stat = await this.maybeStat(entry.backend, current, options);
            if (stat?.type === "symlink")
                fail("ENOTSUP", entry.path, "symlink copy-up cannot preserve an ambiguous target alias");
        }
        if (!stat)
            fail("ENOENT", current);
        if (canonical !== current)
            fail("ENOTSUP", entry.path, "backend cannot prove symlink semantics survive copy-up");
        return target;
    }
    async required(path, options, followFinal = true) {
        return (await this.resolve(path, options, followFinal)).entry;
    }
    async listing(entry, options) {
        if (entry.stat.type !== "directory")
            fail("ENOTDIR", entry.path);
        this.permission(entry, 4);
        const names = new Set();
        const upper = await this.maybeStat(this.#upper, entry.path, options);
        if (upper?.type === "directory") {
            for (const child of await this.#upper.readdir(entry.path, options))
                names.add(child.name);
        }
        if (await this.lowerVisible(entry.path, options) && !this.opaque.has(entry.path)) {
            const lower = await this.maybeStat(this.#lower, entry.path, options);
            if (lower?.type === "directory") {
                for (const child of await this.#lower.readdir(entry.path, options))
                    names.add(child.name);
            }
        }
        const entries = [];
        for (const name of [...names].sort()) {
            if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\0"))
                fail("EIO", entry.path, "invalid backend directory entry");
            const child = await this.lookup(entry.path === "/" ? `/${name}` : `${entry.path}/${name}`, options);
            if (child)
                entries.push({ name, type: child.stat.type });
        }
        return entries;
    }
    async bytes(entry, options) {
        if (entry.stat.type !== "file")
            fail("EISDIR", entry.path);
        this.permission(entry, 4);
        if (options.maxBytes !== undefined)
            integer(options.maxBytes, entry.path);
        const limit = Math.min(options.maxBytes ?? this.maxBufferBytes, this.maxBufferBytes);
        if (entry.stat.size > limit)
            fail("EFBIG", entry.path);
        const result = await entry.backend.readFile(entry.path, { ...options, maxBytes: limit });
        options.signal?.throwIfAborted();
        if (!(result instanceof Uint8Array))
            fail("EIO", entry.path, "backend returned non-byte data");
        if (result.byteLength > limit)
            fail("EFBIG", entry.path);
        return new Uint8Array(result);
    }
    async cleanGarbage(strict) {
        const failures = [];
        for (const path of this.garbage) {
            try {
                await this.#upper.rm(path, { recursive: true, force: true });
                this.garbage.delete(path);
            }
            catch (error) {
                failures.push(error);
            }
        }
        if (strict && failures.length)
            throw new AggregateError(failures, "Overlay staging cleanup failed");
    }
    async cleanup(options = {}) {
        return this.run(options, () => this.cleanGarbage(true));
    }
    async staged(options, operation) {
        const root = `/.virtual-bash-overlay-${randomUUID()}`;
        if (await this.maybeStat(this.#upper, root, options) || await this.maybeStat(this.#lower, root, options))
            fail("EEXIST", root);
        this.activeStages.add(root);
        try {
            await this.#upper.mkdir(root, { ...options, mode: 0o700 });
            return await operation(`${root}/entry`);
        }
        finally {
            this.activeStages.delete(root);
            this.garbage.add(root);
            await this.cleanGarbage(false);
        }
    }
    async preserve(path, stat, options) {
        if (this.#upper.chmod)
            await this.#upper.chmod(path, stat.mode & 0o7777, options);
        else if (((await this.#upper.lstat(path, options)).mode & 0o7777) !== (stat.mode & 0o7777))
            fail("ENOTSUP", path, "upper cannot preserve modes");
        if (!this.#upper.utimes)
            fail("ENOTSUP", path, "upper cannot preserve timestamps during copy-up");
        await this.#upper.utimes(path, stat.atimeMs, stat.mtimeMs, options);
    }
    async clone(entry, destination, options, streaming = false) {
        if (entry.stat.type !== "directory" && ((entry.stat.nlink ?? 1) > 1
            || (entry.backend.capabilities.hardlinks === true && entry.stat.nlink === undefined))) {
            fail("ENOTSUP", entry.path, "copy-up cannot preserve hardlink identity");
        }
        if (entry.stat.type === "symlink") {
            if (!this.capabilities.symlinks || !entry.backend.readlink || !this.#upper.symlink)
                fail("ENOTSUP", entry.path);
            await this.#upper.symlink(await this.movableLinkTarget(entry, options), destination, options);
            return;
        }
        if (entry.stat.type === "directory")
            await this.#upper.mkdir(destination, { ...options, mode: entry.stat.mode & 0o7777 });
        else if (streaming && entry.backend.readStream && entry.backend.capabilities.streamingRead !== false && this.#upper.writeStream) {
            this.permission(entry, 4);
            if (entry.stat.size > this.maxBufferBytes)
                fail("EFBIG", entry.path);
            const source = this.bounded(entry.backend.readStream(entry.path, options), entry.path, options);
            await this.streamToUpper(destination, source, { ...options, mode: 0o600, flag: "wx" });
        }
        else
            await this.#upper.writeFile(destination, await this.bytes(entry, options), { ...options, mode: 0o600, flag: "wx" });
        await this.preserve(destination, entry.stat, options);
    }
    rememberLink(entry, destination) {
        this.linkMetadata.delete(destination);
        if (entry.stat.type === "symlink") {
            this.linkMetadata.set(destination, { mode: entry.stat.mode, atimeMs: entry.stat.atimeMs, mtimeMs: entry.stat.mtimeMs });
        }
    }
    async ensureDirectory(path, options) {
        const entry = await this.lookup(path, options);
        if (!entry)
            fail("ENOENT", path);
        if (entry.stat.type !== "directory")
            fail("ENOTDIR", path);
        if (entry.backend === this.#upper)
            return;
        await this.copyUp(entry, options);
    }
    async copyUp(entry, options) {
        if (entry.backend === this.#upper)
            return;
        if (entry.path === "/")
            fail("ENOTSUP", entry.path, "upper must have a directory root");
        let origin;
        if (entry.stat.type === "symlink") {
            const target = await this.movableLinkTarget(entry, options);
            origin = { path: entry.path, target, canonical: normalizePath(target, dirname(entry.path)), moves: [] };
        }
        await this.ensureDirectory(dirname(entry.path), options);
        await this.staged(options, async (temporary) => {
            await this.clone(entry, temporary, options);
            options.signal?.throwIfAborted();
            await this.#upper.rename(temporary, entry.path, options);
            this.rememberLink(entry, entry.path);
            if (origin)
                this.linkOrigins.set(entry.path, origin);
        });
    }
    async parent(path, options) {
        const parent = await this.lookup(dirname(path), options);
        if (!parent)
            fail("ENOENT", dirname(path));
        if (parent.stat.type !== "directory")
            fail("ENOTDIR", dirname(path));
        this.permission(parent, 3);
        await this.ensureDirectory(parent.path, options);
    }
    async makeDirectory(path, permissions, options) {
        await this.parent(path, options);
        await this.staged(options, async (temporary) => {
            await this.#upper.mkdir(temporary, { ...options, mode: permissions });
            options.signal?.throwIfAborted();
            await this.#upper.rename(temporary, path, options);
            this.opaque.add(path);
            this.linkMetadata.delete(path);
            this.linkOrigins.delete(path);
        });
    }
    writeOptions(path, options) {
        this.writable(path);
        mode(options.mode, path);
        if (!["w", "wx", "a", "ax"].includes(options.flag ?? "w"))
            fail("EINVAL", path);
    }
    async writeLocation(path, options) {
        const exclusive = options.flag === "wx" || options.flag === "ax";
        const location = await this.resolve(path, options, !exclusive, true);
        if (exclusive && location.entry)
            fail("EEXIST", path);
        if (location.entry) {
            if (location.entry.stat.type !== "file")
                fail("EISDIR", path);
            this.permission(location.entry, 2);
        }
        return location;
    }
    async replace(location, options, operation, streaming = false) {
        await this.parent(location.path, options);
        await this.staged(options, async (temporary) => {
            if (location.entry)
                await this.clone(location.entry, temporary, options, streaming);
            await operation(temporary);
            options.signal?.throwIfAborted();
            await this.#upper.rename(temporary, location.path, options);
            this.linkMetadata.delete(location.path);
            this.linkOrigins.delete(location.path);
        });
    }
    async readFile(path, options = {}) {
        return this.run(options, async () => this.bytes(await this.required(path, options), options));
    }
    async writeFile(path, data, options = {}) {
        options.signal?.throwIfAborted();
        this.writeOptions(path, options);
        if (!(data instanceof Uint8Array))
            throw new TypeError("Overlay files require Uint8Array data");
        if (data.byteLength > this.maxBufferBytes)
            fail("EFBIG", path);
        const bytes = new Uint8Array(data);
        return this.run(options, async () => {
            const location = await this.writeLocation(path, options);
            const append = options.flag === "a" || options.flag === "ax";
            if (append && (location.entry?.stat.size ?? 0) + bytes.byteLength > this.maxBufferBytes)
                fail("EFBIG", path);
            await this.replace(location, options, async (temporary) => {
                await this.#upper.writeFile(temporary, bytes, { ...options, flag: append ? "a" : "w" });
            });
        });
    }
    async appendFile(path, data, options = {}) {
        return this.writeFile(path, data, { ...options, flag: "a" });
    }
    async stat(path, options = {}) {
        return this.run(options, async () => snapshotStat((await this.required(path, options)).stat), false);
    }
    async lstat(path, options = {}) {
        return this.run(options, async () => snapshotStat((await this.required(path, options, false)).stat), false);
    }
    compareEntry(path, peer, peerPath, options = {}) {
        return compareEntries(this, path, peer, peerPath, options);
    }
    async readdir(path, options = {}) {
        return this.run(options, async () => this.listing(await this.required(path, options), options), false);
    }
    async realpath(path, options = {}) {
        return this.run(options, async () => (await this.required(path, options)).path, false);
    }
    async access(path, requestedMode = 0, options = {}) {
        return this.run(options, async () => {
            if (!Number.isInteger(requestedMode) || requestedMode < 0 || requestedMode > 7)
                fail("EINVAL", path);
            const entry = await this.required(path, options);
            if (requestedMode & 2)
                this.writable(path);
            this.permission(entry, requestedMode);
            await entry.backend.access(entry.path, requestedMode & ~2, options);
        }, false);
    }
    async mkdir(path, options = {}) {
        return this.run(options, async () => {
            this.writable(path);
            mode(options.mode, path);
            validatePath(path);
            if (options.recursive) {
                const entry = (await this.resolve(path, options, true, false, options.mode ?? 0o777)).entry;
                if (entry.stat.type !== "directory")
                    fail("EEXIST", path);
            }
            else {
                const location = await this.resolve(path.replace(/\/+$/, "") || (path ? "/" : ""), options, false, true);
                if (location.entry)
                    fail("EEXIST", path);
                await this.makeDirectory(location.path, options.mode ?? 0o777, options);
            }
        });
    }
    async rmdir(path, options = {}) {
        try {
            await this.run(options, async () => {
                this.writable(path);
                validatePath(path);
                const entry = await this.required(path.replace(/\/+$/, "") || (path ? "/" : ""), options, false);
                if (/(?:^|\/)\.{1,2}\/*$/.test(path))
                    fail("EINVAL", path);
                if (entry.path === "/")
                    fail("EBUSY", path);
                if (entry.stat.type !== "directory")
                    fail("ENOTDIR", path);
                const parent = await this.required(dirname(entry.path), options);
                this.permission(parent, 3);
                if ((await this.listing(entry, options)).length)
                    fail("ENOTEMPTY", path);
                options.signal?.throwIfAborted();
                if (this.#upper.capabilities.snapshotRmdir === true) {
                    fail("ENOTSUP", path, "snapshot-marker upper removal cannot safely publish an overlay whiteout");
                }
                if (entry.backend === this.#upper) {
                    if (!this.#upper.rmdir)
                        fail("ENOTSUP", path);
                    await this.#upper.rmdir(entry.path, options);
                }
                this.whiteouts.add(entry.path);
                for (const key of this.linkMetadata.keys())
                    if (isPathWithin(entry.path, key))
                        this.linkMetadata.delete(key);
                for (const key of this.linkOrigins.keys())
                    if (isPathWithin(entry.path, key))
                        this.linkOrigins.delete(key);
            }, false);
        }
        catch (error) {
            options.signal?.throwIfAborted();
            throw new FsError(toFsError(error).code, { syscall: "rmdir", path, cause: error });
        }
    }
    async rm(path, options = {}) {
        return this.run(options, async () => {
            this.writable(path);
            let entry;
            try {
                entry = await this.required(path, options, false);
            }
            catch (error) {
                if (options.force && hasCode(error, "ENOENT"))
                    return;
                throw error;
            }
            if (entry.path === "/")
                fail("EBUSY", path);
            if (entry.stat.type === "directory" && !options.recursive && (await this.listing(entry, options)).length)
                fail("ENOTEMPTY", path);
            await this.parent(entry.path, options);
            if (entry.backend === this.#upper) {
                await this.staged(options, async (temporary) => {
                    options.signal?.throwIfAborted();
                    await this.#upper.rename(entry.path, temporary, options);
                    this.whiteouts.add(entry.path);
                });
            }
            else {
                options.signal?.throwIfAborted();
                this.whiteouts.add(entry.path);
            }
            for (const key of this.linkMetadata.keys())
                if (isPathWithin(entry.path, key))
                    this.linkMetadata.delete(key);
            for (const key of this.linkOrigins.keys())
                if (isPathWithin(entry.path, key))
                    this.linkOrigins.delete(key);
        });
    }
    async materialize(entry, options) {
        if (entry.stat.type === "symlink" && entry.backend === this.#upper)
            await this.movableLinkTarget(entry, options);
        const children = entry.stat.type === "directory" ? await this.listing(entry, options) : [];
        await this.copyUp(entry, options);
        for (const child of children) {
            const path = `${entry.path}/${child.name}`;
            const visible = await this.lookup(path, options);
            if (!visible)
                fail("EIO", path, "visible tree changed during materialization");
            await this.materialize(visible, options);
        }
        if (entry.stat.type === "directory")
            await this.preserve(entry.path, entry.stat, options);
    }
    async rename(source, destination, options = {}) {
        return this.run(options, async () => {
            this.writable(source);
            const original = await this.required(source, options, false);
            const target = await this.resolve(destination, options, false, true);
            if (original.path === target.path)
                return;
            if (original.path === "/" || target.path === "/")
                fail("EBUSY", source);
            if (original.stat.type === "directory" && isPathWithin(original.path, target.path))
                fail("EINVAL", destination);
            if (target.entry) {
                if (original.stat.type === "directory" && target.entry.stat.type !== "directory")
                    fail("ENOTDIR", destination);
                if (original.stat.type !== "directory" && target.entry.stat.type === "directory")
                    fail("EISDIR", destination);
                if (target.entry.stat.type === "directory" && (await this.listing(target.entry, options)).length)
                    fail("ENOTEMPTY", destination);
            }
            await this.parent(original.path, options);
            await this.parent(target.path, options);
            await this.materialize(original, options);
            options.signal?.throwIfAborted();
            const move = { source: original.path, destination: target.path };
            const movedOrigins = [];
            for (const [path, origin] of this.linkOrigins) {
                if (!isPathWithin(original.path, path))
                    continue;
                const destination = movedPath(path, [move]);
                const moves = origin.target.startsWith("/") ? origin.moves : [...origin.moves, move];
                if (normalizePath(origin.target, dirname(destination)) !== movedPath(origin.canonical, moves)) {
                    fail("ENOTSUP", path, "relocation changes an unprovable relative symlink target");
                }
                movedOrigins.push([destination, { ...origin, moves }]);
            }
            options.signal?.throwIfAborted();
            await this.#upper.rename(original.path, target.path, options);
            this.whiteouts.add(original.path);
            if (original.stat.type === "directory")
                this.opaque.add(target.path);
            const moved = [...this.linkMetadata].filter(([path]) => isPathWithin(original.path, path));
            for (const path of this.linkMetadata.keys()) {
                if (isPathWithin(original.path, path) || isPathWithin(target.path, path))
                    this.linkMetadata.delete(path);
            }
            for (const [path, metadata] of moved)
                this.linkMetadata.set(target.path + path.slice(original.path.length), metadata);
            for (const path of this.linkOrigins.keys()) {
                if (isPathWithin(original.path, path) || isPathWithin(target.path, path))
                    this.linkOrigins.delete(path);
            }
            for (const [path, origin] of movedOrigins)
                this.linkOrigins.set(path, origin);
        });
    }
    async copyFile(source, destination, options = {}) {
        return this.run(options, async () => {
            this.writable(destination);
            const original = await this.required(source, options);
            const target = await this.writeLocation(destination, { ...options, flag: options.exclusive ? "wx" : "w" });
            if (original.path === target.path)
                fail("EINVAL", destination, "source and destination are the same file");
            if (target.entry) {
                let identity = compareIdentity(original.stat, target.entry.stat);
                if (identity === "unknown")
                    identity = await compareEntries(original.backend, original.path, target.entry.backend, target.entry.path, options);
                if (identity === "same")
                    fail("EINVAL", destination, "source and destination are the same file");
                if (identity === "unknown")
                    fail("ENOTSUP", destination, "backing-entry identity is unknown");
            }
            if (target.entry?.backend !== this.#upper) {
                const upper = await this.maybeStat(this.#upper, target.path, options);
                if (upper) {
                    let identity = compareIdentity(original.stat, upper);
                    if (identity === "unknown")
                        identity = await compareEntries(original.backend, original.path, this.#upper, target.path, options);
                    if (identity === "same")
                        fail("EINVAL", destination, "source and destination are the same file");
                    if (identity === "unknown")
                        fail("ENOTSUP", destination, "upper backing-entry identity is unknown");
                }
            }
            await this.cleanGarbage(false);
            const bytes = await this.bytes(original, options);
            await this.replace(target, options, async (temporary) => {
                await this.#upper.writeFile(temporary, bytes, { ...options, mode: original.stat.mode & 0o7777, flag: "w" });
                if (this.#upper.chmod)
                    await this.#upper.chmod(temporary, original.stat.mode & 0o7777, options);
                else if (((await this.#upper.lstat(temporary, options)).mode & 0o7777) !== (original.stat.mode & 0o7777))
                    fail("ENOTSUP", destination);
            });
        }, false);
    }
    async readlink(path, options = {}) {
        return this.run(options, async () => {
            const entry = await this.required(path, options, false);
            if (entry.stat.type !== "symlink")
                fail("EINVAL", path);
            if (!entry.backend.readlink)
                fail("ENOTSUP", path);
            return entry.backend.readlink(entry.path, options);
        }, false);
    }
    async symlink(target, path, options = {}) {
        return this.run(options, async () => {
            this.writable(path);
            if (!this.capabilities.symlinks || !this.#upper.symlink)
                fail("ENOTSUP", path);
            validatePath(target);
            if (!target)
                fail("ENOENT", path);
            const location = await this.resolve(path, options, false, true);
            if (location.entry)
                fail("EEXIST", path);
            await this.replace(location, options, (temporary) => this.#upper.symlink(target, temporary, options));
        });
    }
    async link(_existingPath, newPath, options = {}) {
        options.signal?.throwIfAborted();
        fail("ENOTSUP", newPath, "overlay hardlinks are not supported");
    }
    async metadata(path, capability, options, operation) {
        return this.run(options, async () => {
            this.writable(path);
            if (!this.capabilities[capability])
                fail("ENOTSUP", path);
            const entry = await this.required(path, options);
            if (entry.stat.type === "directory") {
                await this.copyUp(entry, options);
                await operation(entry.path);
            }
            else
                await this.replace({ path: entry.path, entry }, options, operation);
        });
    }
    async chmod(path, permissions, options = {}) {
        options.signal?.throwIfAborted();
        if (permissions === undefined)
            fail("EINVAL", path);
        mode(permissions, path);
        return this.metadata(path, "permissions", options, (target) => this.#upper.chmod(target, permissions, options));
    }
    async utimes(path, atimeMs, mtimeMs, options = {}) {
        options.signal?.throwIfAborted();
        if (!Number.isFinite(atimeMs) || !Number.isFinite(mtimeMs))
            fail("EINVAL", path);
        return this.metadata(path, "timestamps", options, (target) => this.#upper.utimes(target, atimeMs, mtimeMs, options));
    }
    async truncate(path, length = 0, options = {}) {
        integer(length, path);
        return this.run(options, async () => {
            this.writable(path);
            if (length > this.maxBufferBytes)
                fail("EFBIG", path);
            const entry = await this.required(path, options);
            if (entry.stat.type !== "file")
                fail("EISDIR", path);
            this.permission(entry, 2);
            await this.replace({ path: entry.path, entry }, options, async (temporary) => {
                if (this.#upper.truncate)
                    await this.#upper.truncate(temporary, length, options);
                else {
                    const previous = await this.#upper.readFile(temporary, { ...options, maxBytes: this.maxBufferBytes });
                    const bytes = new Uint8Array(length);
                    bytes.set(previous.subarray(0, length));
                    await this.#upper.writeFile(temporary, bytes, options);
                }
            });
        });
    }
    async *readStream(path, options = {}) {
        options.signal?.throwIfAborted();
        const start = options.start ?? 0;
        const chunkSize = options.chunkSize ?? 64 * 1024;
        integer(start, path);
        integer(chunkSize, path);
        if (!chunkSize)
            fail("EINVAL", path);
        if (options.endExclusive !== undefined) {
            integer(options.endExclusive, path);
            if (options.endExclusive < start)
                fail("EINVAL", path);
        }
        const entry = await this.run(options, async () => {
            const entry = await this.required(path, options);
            if (entry.stat.type !== "file")
                fail("EISDIR", path);
            this.permission(entry, 4);
            return entry;
        });
        if (entry.backend.readStream && entry.backend.capabilities.streamingRead !== false) {
            for await (const chunk of readBytes(entry.backend.readStream(entry.path, options), options.signal)) {
                yield new Uint8Array(chunk);
            }
            options.signal?.throwIfAborted();
            return;
        }
        const bytes = await this.bytes(entry, options);
        const end = Math.min(bytes.byteLength, options.endExclusive ?? bytes.byteLength);
        for (let offset = start; offset < end; offset += chunkSize) {
            options.signal?.throwIfAborted();
            yield bytes.slice(offset, Math.min(end, offset + chunkSize));
        }
        options.signal?.throwIfAborted();
    }
    async *bounded(source, path, options) {
        let size = 0;
        for await (const chunk of readBytes(source, options.signal)) {
            if (chunk.byteLength > this.maxBufferBytes - size)
                fail("EFBIG", path);
            size += chunk.byteLength;
            yield new Uint8Array(chunk);
        }
    }
    async streamToUpper(path, source, options) {
        if (!this.#upper.writeStream)
            fail("ENOTSUP", path);
        const input = readBytes(source, options.signal);
        let failed = false;
        try {
            await this.#upper.writeStream(path, input, options);
        }
        catch (error) {
            failed = true;
            throw error;
        }
        finally {
            try {
                await input.return(undefined);
            }
            catch (error) {
                if (!failed)
                    throw error;
            }
        }
    }
    async writeStream(path, source, options = {}) {
        options.signal?.throwIfAborted();
        this.writeOptions(path, options);
        await this.run(options, () => this.writeLocation(path, options));
        if (this.capabilities.streamingWrite !== false) {
            await this.staged(options, async (incoming) => {
                const bounded = this.bounded(source, path, options);
                await this.streamToUpper(incoming, bounded, { ...options, flag: "wx", mode: 0o600 });
                const size = (await this.#upper.stat(incoming, options)).size;
                await this.run(options, async () => {
                    const location = await this.writeLocation(path, options);
                    const append = options.flag === "a" || options.flag === "ax";
                    if (append && (location.entry?.stat.size ?? 0) + size > this.maxBufferBytes)
                        fail("EFBIG", path);
                    await this.replace(location, options, async (temporary) => {
                        await this.streamToUpper(temporary, this.#upper.readStream(incoming, options), { ...options, flag: append ? "a" : "w" });
                    }, true);
                });
            });
            return;
        }
        const bytes = await collectBytes(source, { maxBytes: this.maxBufferBytes, ...(options.signal ? { signal: options.signal } : {}) });
        await this.writeFile(path, bytes, options);
    }
}
export function createOverlayFileSystem(options) {
    return new OverlayFileSystem(options);
}
//# sourceMappingURL=index.js.map