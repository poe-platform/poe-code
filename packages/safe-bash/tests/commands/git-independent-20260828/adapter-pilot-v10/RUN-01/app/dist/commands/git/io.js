import { createHash } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { FsError, createOutputOperation, dirname, resolvePath } from "../../contracts/index.js";
import { ConsumerClosed, GIT_LIMITS, GitFailure, demand } from "./limits.js";
export class Session {
    context;
    operation;
    boundary;
    owned = new WeakMap();
    counts = new Map();
    sinceYield = 0;
    resident = 0;
    observations = new Map();
    constructor(context, boundary) {
        this.context = context;
        this.boundary = resolvePath("/", boundary);
        this.operation = createOutputOperation(context, context.stdout);
    }
    check() {
        this.context.signal.throwIfAborted();
        if (this.operation.signal.aborted) {
            if (this.context.stdout.ownedOutput?.consumerClosed.aborted)
                throw new ConsumerClosed("Git output consumer closed");
            throw this.operation.signal.reason;
        }
    }
    charge(key, amount) {
        this.check();
        const total = (this.counts.get(key) ?? 0) + amount;
        demand(Number.isSafeInteger(amount) && amount >= 0 && Number.isSafeInteger(total) && total <= GIT_LIMITS[key], `Git ${key} exceeded`);
        this.counts.set(key, total);
    }
    async step(amount = 1) {
        this.charge("maxSteps", amount);
        this.sinceYield += amount;
        while (this.sinceYield >= 4096) {
            this.sinceYield -= 4096;
            await setImmediate();
            this.check();
        }
    }
    reserve(size) {
        demand(Number.isSafeInteger(size) && size >= 0 && size <= GIT_LIMITS.maxResidentBytes - this.resident, "Git resident reservation exceeded");
        this.resident += size;
    }
    unreserve(size) { this.resident -= size; }
    allocate(size) {
        this.reserve(size);
        const bytes = Buffer.alloc(size);
        this.owned.set(bytes, size);
        return bytes;
    }
    copy(bytes) {
        const result = this.allocate(bytes.length);
        result.set(bytes);
        return result;
    }
    release(bytes) {
        const amount = this.owned.get(bytes);
        if (amount !== undefined) {
            this.unreserve(amount);
            this.owned.delete(bytes);
        }
    }
    text(bytes) {
        this.reserve(bytes.length * 2);
        try {
            return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
        }
        catch {
            throw new GitFailure("invalid UTF-8 in Git metadata/text");
        }
    }
    async hash(bytes, type) {
        const hash = createHash("sha1");
        if (type)
            hash.update(`${type} ${bytes.length}\0`);
        for (let offset = 0; offset < bytes.length; offset += 4096) {
            const part = bytes.subarray(offset, offset + 4096);
            await this.step(part.length);
            hash.update(part);
        }
        return hash.digest("hex");
    }
    path(base, name) {
        demand(!name.includes("\0") && Buffer.byteLength(name) <= GIT_LIMITS.maxPathBytes, "invalid Git path");
        const path = resolvePath(base, name);
        demand(path === this.boundary || path.startsWith(this.boundary === "/" ? "/" : this.boundary + "/"), "Git path outside discovery boundary");
        demand(Buffer.byteLength(path) <= GIT_LIMITS.maxPathBytes, "Git path limit exceeded");
        return path;
    }
    async call(start) {
        this.check();
        try {
            const value = await start();
            this.check();
            return value;
        }
        catch (error) {
            this.context.signal.throwIfAborted();
            if (error instanceof ConsumerClosed)
                throw error;
            if (error instanceof FsError && !this.operation.signal.aborted)
                throw new GitFailure(`${error.code}: ${error.path ?? "VFS read"}`);
            throw error;
        }
    }
    async stat(path) {
        await this.step();
        this.path("/", path);
        try {
            const stat = await this.context.fs.lstat(path, { signal: this.operation.signal });
            this.check();
            return stat;
        }
        catch (error) {
            this.context.signal.throwIfAborted();
            if (error instanceof FsError && error.code === "ENOENT" && !this.operation.signal.aborted)
                return undefined;
            if (error instanceof FsError && !this.operation.signal.aborted)
                throw new GitFailure(`${error.code}: ${path}`);
            throw error;
        }
    }
    async safe(path, leafLink = false) {
        const relative = this.path("/", path).slice(this.boundary === "/" ? 1 : this.boundary.length + 1);
        let current = this.boundary;
        const root = await this.stat(current);
        demand(root?.type === "directory", "Git boundary is not a real directory");
        const parts = relative ? relative.split("/") : [];
        demand(parts.length <= GIT_LIMITS.maxDepth, "Git path depth exceeded");
        for (let index = 0; index < parts.length; index++) {
            current = this.path(current, parts[index]);
            const stat = await this.stat(current);
            if (!stat)
                return;
            demand(stat.type !== "symlink" || leafLink && index === parts.length - 1, "Git metadata/path symlink refused");
            if (index < parts.length - 1)
                demand(stat.type === "directory", "Git path obstruction");
        }
        if (!(leafLink && (await this.stat(path))?.type === "symlink")) {
            const actual = await this.call(() => this.context.fs.realpath(path, { signal: this.operation.signal }));
            demand(actual === path, "Git namespace case/normalization/alias mismatch");
        }
    }
    async list(path) {
        await this.safe(path);
        const entries = await this.call(() => this.context.fs.readdir(path, { signal: this.operation.signal }));
        demand(Array.isArray(entries), "invalid Git directory listing");
        this.charge("maxEntries", entries.length);
        this.reserve(entries.length * 64);
        const seen = new Set();
        for (const entry of entries) {
            await this.step(entry.name.length + 1);
            component(entry.name);
            this.reserve(Buffer.byteLength(entry.name) * 2);
            demand(!seen.has(entry.name), "duplicate Git directory entry");
            seen.add(entry.name);
        }
        return entries;
    }
    async read(path, maximum, optional = false, observe = false) {
        await this.safe(path);
        const before = await this.stat(path);
        if (!before) {
            if (optional)
                return undefined;
            throw new GitFailure(`missing Git file: ${path}`);
        }
        demand(before.type === "file", `Git input is not a regular file: ${path}`);
        demand(Number.isSafeInteger(before.size) && before.size >= 0 && before.size <= maximum, "Git file admission size exceeded");
        const pieces = [];
        let total = 0;
        let iterator;
        let closing;
        const close = () => closing ??= Promise.resolve().then(() => iterator?.return?.());
        let failed = false;
        try {
            if (this.context.fs.readStream) {
                await this.operation.acquire(() => iterator = this.context.fs.readStream(path, { signal: this.operation.signal, chunkSize: GIT_LIMITS.maxChunkBytes })[Symbol.asyncIterator](), async () => { await close(); });
                for (;;) {
                    const row = await this.call(() => iterator.next());
                    if (row.done)
                        break;
                    demand(row.value instanceof Uint8Array, "Git source yielded nonbytes");
                    this.charge("maxChunks", 1);
                    demand(row.value.length <= GIT_LIMITS.maxChunkBytes && row.value.length <= maximum - total, "Git read chunk/size exceeded");
                    this.charge("maxReadBytes", row.value.length);
                    await this.step(Math.max(1, row.value.length));
                    pieces.push(this.copy(row.value));
                    total += row.value.length;
                }
            }
            else {
                const bytes = await this.call(() => this.context.fs.readFile(path, { signal: this.operation.signal, maxBytes: maximum }));
                demand(bytes instanceof Uint8Array && bytes.length <= maximum, "Git bounded readFile exceeded");
                this.charge("maxReadBytes", bytes.length);
                await this.step(bytes.length);
                pieces.push(this.copy(bytes));
                total = bytes.length;
            }
            const after = await this.stat(path);
            demand(after && snapshot(before) === snapshot(after) && total === before.size, "Git input changed during read");
            const result = this.allocate(total);
            let position = 0;
            for (const piece of pieces) {
                result.set(piece, position);
                position += piece.length;
            }
            if (observe)
                this.observations.set(path, await this.hash(result));
            return result;
        }
        catch (error) {
            failed = true;
            throw error;
        }
        finally {
            for (const piece of pieces)
                this.release(piece);
            try {
                await close();
            }
            catch (error) {
                if (!failed)
                    throw error;
            }
        }
    }
    async unchanged() {
        for (const [path, hash] of this.observations) {
            const bytes = await this.read(path, GIT_LIMITS.maxIndexBytes);
            try {
                demand(await this.hash(bytes) === hash, "Git metadata changed before output");
            }
            finally {
                this.release(bytes);
            }
        }
    }
    async output(bytes) {
        const length = typeof bytes === "string" ? Buffer.byteLength(bytes) : bytes.length;
        this.charge("maxOutputBytes", length);
        if (typeof bytes === "string")
            this.reserve(length);
        const content = typeof bytes === "string" ? Buffer.from(bytes) : bytes;
        try {
            for (let offset = 0; offset < content.length; offset += GIT_LIMITS.maxChunkBytes) {
                this.check();
                await this.operation.output.write(content.subarray(offset, offset + GIT_LIMITS.maxChunkBytes));
            }
        }
        finally {
            if (typeof bytes === "string")
                this.unreserve(length);
        }
    }
    async sorted(paths) {
        const values = Array.from(paths);
        this.reserve(values.length * 16);
        for (let width = 1; width < values.length; width *= 2) {
            for (let start = 0; start < values.length; start += width * 2) {
                const middle = Math.min(start + width, values.length), end = Math.min(start + width * 2, values.length);
                const merged = [];
                let left = start, right = middle;
                while (left < middle || right < end) {
                    if (left < middle && right < end)
                        await this.step(values[left].length + values[right].length + 1);
                    merged.push(right >= end || left < middle && compare(values[left], values[right]) <= 0 ? values[left++] : values[right++]);
                }
                for (let index = 0; index < merged.length; index++)
                    values[start + index] = merged[index];
            }
        }
        return values;
    }
}
function snapshot(stat) { return `${stat.type}:${stat.size}:${stat.mode}:${stat.mtimeMs}:${stat.ctimeMs}`; }
export function component(name) {
    demand(typeof name === "string" && name.length > 0 && name !== "." && name !== ".." && !name.includes("/") && !name.includes("\0") && Buffer.byteLength(name) <= GIT_LIMITS.maxPathBytes, "invalid Git path component");
    demand(Buffer.from(name).toString("utf8") === name, "nonroundtrippable Git path");
}
export function objectPath(name) {
    demand(name.length > 0 && !name.startsWith("/") && !name.endsWith("/"), "invalid repository path");
    for (const part of name.split("/")) {
        component(part);
        demand(part.toLowerCase() !== ".git", "reserved Git path");
    }
}
export function compare(left, right) { return Buffer.compare(Buffer.from(left), Buffer.from(right)); }
export function parent(path) { return dirname(path); }
//# sourceMappingURL=io.js.map