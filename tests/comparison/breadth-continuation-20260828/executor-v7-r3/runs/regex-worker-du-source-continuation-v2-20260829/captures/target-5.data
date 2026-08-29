import { FsError } from "../../contracts/errors.js";
import { compareEntries, registerEntryAuthority } from "../mount/comparison.js";
import { getOwnedS3Entry } from "../s3/authority.js";
import { getOwnedWebDavEntry } from "../webdav/resource-id.js";
const typeModes = { file: 0o100000, directory: 0o040000, symlink: 0o120000 };
const ownedStats = new WeakMap();
const ownedStores = new WeakMap();
const registeredAuthorities = new WeakSet();
const compareOwnedMemory = async (own, peer, options) => {
    options.signal?.throwIfAborted();
    let explicit = false;
    let answer = "unknown";
    const visited = new Set();
    for (const [left, right] of [[own, peer], [peer, own]]) {
        if (!registeredAuthorities.has(left.filesystem) || visited.has(left.filesystem))
            continue;
        visited.add(left.filesystem);
        const comparison = left.filesystem.compareEntry;
        if (comparison === memoryImplementation.compareEntry?.value)
            continue;
        explicit = true;
        if (!comparison)
            continue;
        options.signal?.throwIfAborted();
        const result = await comparison.call(left.filesystem, left.path, right.filesystem, right.path, options);
        options.signal?.throwIfAborted();
        if (result !== "same" && result !== "distinct" && result !== "unknown") {
            throw new FsError("EIO", { path: own.path, dest: peer.path, message: "invalid explicit Memory comparison" });
        }
        if (result === "unknown")
            continue;
        if (answer !== "unknown" && answer !== result) {
            throw new FsError("EIO", { path: own.path, dest: peer.path, message: "conflicting explicit Memory comparisons" });
        }
        answer = result;
    }
    if (explicit)
        return answer;
    const owner = ownedStores.get(own.filesystem);
    const observation = ownedStats.get(own.stat);
    if (!owner?.intact() || observation?.filesystem !== own.filesystem || observation.path !== own.path
        || observation.root !== owner.root)
        return "unknown";
    const qualified = getOwnedS3Entry(peer) ?? getOwnedWebDavEntry(peer);
    options.signal?.throwIfAborted();
    return qualified ? "distinct" : "unknown";
};
export class MemoryFileSystem {
    capabilities = Object.freeze({
        readOnly: false,
        symlinks: true,
        hardlinks: true,
        permissions: true,
        timestamps: true,
        atomicRename: true,
        streamingRead: true,
        streamingWrite: true,
    });
    identityScope = Symbol();
    nextInode = 1;
    root = this.directory(0o755);
    constructor() {
        const root = this.root;
        ownedStores.set(this, {
            root,
            intact: () => this.root === root,
        });
        if (this.compareEntry === memoryImplementation.compareEntry?.value) {
            registeredAuthorities.add(this);
            registerEntryAuthority(this, compareOwnedMemory);
        }
    }
    compareEntry(path, peer, peerPath, options = {}) {
        return compareEntries(this, path, peer, peerPath, options);
    }
    metadata(mode) {
        const now = Date.now();
        return {
            mode, ino: this.nextInode++, nlink: 1,
            atimeMs: now, mtimeMs: now, ctimeMs: now, birthtimeMs: now,
        };
    }
    directory(mode) {
        return { ...this.metadata(typeModes.directory | mode), type: "directory", entries: new Map() };
    }
    fail(code, syscall, path, dest) {
        throw new FsError(code, { syscall, path, ...(dest === undefined ? {} : { dest }) });
    }
    validatePath(path, syscall) {
        if (typeof path !== "string" || path.includes("\0"))
            this.fail("EINVAL", syscall, path);
        if (path.length === 0)
            this.fail("ENOENT", syscall, path);
    }
    permission(node, mask, syscall, path) {
        if (((node.mode >> 6) & mask) !== mask)
            this.fail("EACCES", syscall, path);
    }
    mode(mode, fallback, syscall, path) {
        const value = mode ?? fallback;
        if (!Number.isInteger(value) || value < 0 || value > 0o7777)
            this.fail("EINVAL", syscall, path);
        return value;
    }
    integer(value, syscall, path) {
        if (!Number.isSafeInteger(value) || value < 0)
            this.fail("EINVAL", syscall, path);
    }
    changed(node) {
        node.mtimeMs = node.ctimeMs = Date.now();
    }
    resolve(path, syscall, options = {}) {
        this.validatePath(path, syscall);
        const pending = path.split("/").filter(Boolean);
        if (path.endsWith("/"))
            pending.push(".");
        const stack = [{ node: this.root, name: "" }];
        let links = 0;
        while (pending.length > 0) {
            const component = pending.shift();
            const current = stack[stack.length - 1].node;
            if (current.type !== "directory")
                this.fail("ENOTDIR", syscall, path);
            this.permission(current, 1, syscall, path);
            if (component === ".")
                continue;
            if (component === "..") {
                if (stack.length > 1)
                    stack.pop();
                continue;
            }
            if (new TextEncoder().encode(component).byteLength > 255)
                this.fail("ENAMETOOLONG", syscall, path);
            let node = current.entries.get(component);
            if (!node && options.createDirectories !== undefined) {
                this.permission(current, 3, syscall, path);
                node = this.directory(options.createDirectories);
                current.entries.set(component, node);
                this.changed(current);
            }
            if (!node) {
                if (options.allowMissing && pending.length === 0) {
                    return { node, parent: current, name: component, path: [...stack.map((entry) => entry.name), component].join("/") };
                }
                this.fail("ENOENT", syscall, path);
            }
            if (node.type === "symlink" && (options.followFinal !== false || pending.length > 0)) {
                if (++links > 40)
                    this.fail("ELOOP", syscall, path);
                const target = node.target.split("/").filter(Boolean);
                if (node.target.endsWith("/"))
                    target.push(".");
                pending.unshift(...target);
                if (node.target.startsWith("/"))
                    stack.splice(1);
                continue;
            }
            stack.push({ node, name: component });
        }
        const entry = stack[stack.length - 1];
        return {
            node: entry.node,
            parent: (stack[stack.length - 2]?.node ?? this.root),
            name: entry.name,
            path: stack.map((part) => part.name).join("/") || "/",
        };
    }
    file(path, syscall) {
        const node = this.resolve(path, syscall).node;
        if (node.type !== "file")
            this.fail("EISDIR", syscall, path);
        return node;
    }
    entry(path, syscall, allowMissing = false) {
        this.validatePath(path, syscall);
        const location = this.resolve(path.replace(/\/+$/, "") || "/", syscall, { followFinal: false, allowMissing });
        if (path.endsWith("/") && location.node && location.node.type !== "directory")
            this.fail("ENOTDIR", syscall, path);
        return location;
    }
    terminalDot(path) {
        return /(?:^|\/)\.{1,2}\/*$/.test(path);
    }
    snapshot(node) {
        return {
            type: node.type,
            size: node.type === "file" ? node.data.byteLength
                : node.type === "symlink" ? new TextEncoder().encode(node.target).byteLength : 0,
            mode: node.mode, ...(ownedStores.get(this)?.intact() ? { identityScope: this.identityScope } : {}),
            ino: node.ino, dev: 0, uid: 0, gid: 0,
            nlink: node.type === "directory"
                ? 2 + [...node.entries.values()].filter((entry) => entry.type === "directory").length : node.nlink,
            atimeMs: node.atimeMs, mtimeMs: node.mtimeMs, ctimeMs: node.ctimeMs, birthtimeMs: node.birthtimeMs,
        };
    }
    bytes(data) {
        if (!(data instanceof Uint8Array))
            throw new TypeError("Memory files require Uint8Array data");
        return new Uint8Array(data);
    }
    allocate(length, syscall, path) {
        try {
            return new Uint8Array(length);
        }
        catch (cause) {
            throw new FsError("EFBIG", { syscall, path, cause });
        }
    }
    openWrite(path, options, syscall) {
        const flag = options.flag ?? "w";
        if (!["w", "wx", "a", "ax"].includes(flag))
            this.fail("EINVAL", syscall, path);
        const mode = this.mode(options.mode, 0o666, syscall, path);
        const exclusive = flag === "wx" || flag === "ax";
        const location = this.resolve(path, syscall, { followFinal: !exclusive, allowMissing: true });
        if (location.node) {
            if (exclusive)
                this.fail("EEXIST", syscall, path);
            if (location.node.type !== "file")
                this.fail("EISDIR", syscall, path);
            this.permission(location.node, 2, syscall, path);
            return location.node;
        }
        this.permission(location.parent, 3, syscall, path);
        const node = { ...this.metadata(typeModes.file | mode), type: "file", data: new Uint8Array() };
        location.parent.entries.set(location.name, node);
        this.changed(location.parent);
        return node;
    }
    append(node, data, syscall, path) {
        const length = node.data.byteLength + data.byteLength;
        let storage;
        if (length <= node.data.buffer.byteLength) {
            storage = new Uint8Array(node.data.buffer);
        }
        else {
            storage = this.allocate(Math.max(length, node.data.byteLength * 2, 64), syscall, path);
            storage.set(node.data);
        }
        storage.set(data, node.data.byteLength);
        node.data = storage.subarray(0, length);
        this.changed(node);
    }
    async readFile(path, options = {}) {
        options.signal?.throwIfAborted();
        if (options.maxBytes !== undefined)
            this.integer(options.maxBytes, "readFile", path);
        const node = this.file(path, "readFile");
        this.permission(node, 4, "readFile", path);
        if (options.maxBytes !== undefined && node.data.byteLength > options.maxBytes)
            this.fail("EFBIG", "readFile", path);
        node.atimeMs = Date.now();
        return new Uint8Array(node.data);
    }
    async writeFile(path, data, options = {}) {
        options.signal?.throwIfAborted();
        const copied = this.bytes(data);
        const node = this.openWrite(path, options, "writeFile");
        if (options.flag === "a" || options.flag === "ax")
            this.append(node, copied, "writeFile", path);
        else {
            node.data = copied;
            this.changed(node);
        }
    }
    async appendFile(path, data, options = {}) {
        options.signal?.throwIfAborted();
        const copied = this.bytes(data);
        this.append(this.openWrite(path, { ...options, flag: "a" }, "appendFile"), copied, "appendFile", path);
    }
    async stat(path, options = {}) {
        options.signal?.throwIfAborted();
        return this.snapshot(this.resolve(path, "stat").node);
    }
    async lstat(path, options = {}) {
        options.signal?.throwIfAborted();
        const stat = this.snapshot(this.resolve(path, "lstat", { followFinal: false }).node);
        ownedStats.set(stat, { filesystem: this, path, root: this.root });
        return stat;
    }
    async readdir(path, options = {}) {
        options.signal?.throwIfAborted();
        const node = this.resolve(path, "readdir").node;
        if (node.type !== "directory")
            this.fail("ENOTDIR", "readdir", path);
        this.permission(node, 4, "readdir", path);
        node.atimeMs = Date.now();
        return [...node.entries].map(([name, entry]) => ({ name, type: entry.type }))
            .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    }
    async mkdir(path, options = {}) {
        options.signal?.throwIfAborted();
        this.validatePath(path, "mkdir");
        const mode = this.mode(options.mode, 0o777, "mkdir", path);
        if (options.recursive) {
            const node = this.resolve(path, "mkdir", { createDirectories: mode }).node;
            if (node.type !== "directory")
                this.fail("EEXIST", "mkdir", path);
            return;
        }
        const location = this.resolve(path.replace(/\/+$/, "") || "/", "mkdir", { allowMissing: true, followFinal: false });
        if (location.node)
            this.fail("EEXIST", "mkdir", path);
        this.permission(location.parent, 3, "mkdir", path);
        location.parent.entries.set(location.name, this.directory(mode));
        this.changed(location.parent);
    }
    async rmdir(path, options = {}) {
        options.signal?.throwIfAborted();
        const location = this.entry(path, "rmdir");
        const node = location.node;
        if (this.terminalDot(path))
            this.fail("EINVAL", "rmdir", path);
        if (node === this.root)
            this.fail("EBUSY", "rmdir", path);
        if (node.type !== "directory")
            this.fail("ENOTDIR", "rmdir", path);
        this.permission(location.parent, 3, "rmdir", path);
        if (node.entries.size > 0)
            this.fail("ENOTEMPTY", "rmdir", path);
        location.parent.entries.delete(location.name);
        node.nlink = 0;
        node.ctimeMs = Date.now();
        this.changed(location.parent);
    }
    async rm(path, options = {}) {
        options.signal?.throwIfAborted();
        let location;
        try {
            location = this.entry(path, "rm");
        }
        catch (error) {
            if (options.force && error instanceof FsError && error.code === "ENOENT")
                return;
            throw error;
        }
        const node = location.node;
        if (this.terminalDot(path))
            this.fail("EINVAL", "rm", path);
        if (node === this.root)
            this.fail("EBUSY", "rm", path);
        this.permission(location.parent, 3, "rm", path);
        if (node.type === "directory" && !options.recursive)
            this.fail("EISDIR", "rm", path);
        const removed = [node];
        for (let index = 0; index < removed.length; index++) {
            const entry = removed[index];
            if (entry.type === "directory" && entry.entries.size > 0) {
                this.permission(entry, 7, "rm", path);
                for (const child of entry.entries.values())
                    removed.push(child);
            }
        }
        location.parent.entries.delete(location.name);
        for (const entry of removed) {
            entry.nlink--;
            entry.ctimeMs = Date.now();
        }
        this.changed(location.parent);
    }
    async rename(source, destination, options = {}) {
        options.signal?.throwIfAborted();
        try {
            const origin = this.entry(source, "rename");
            const target = this.entry(destination, "rename", true);
            const node = origin.node;
            if (this.terminalDot(source) || this.terminalDot(destination))
                this.fail("EINVAL", "rename", source, destination);
            if (node === this.root || target.node === this.root)
                this.fail("EBUSY", "rename", source, destination);
            if (destination.endsWith("/") && node.type !== "directory")
                this.fail("ENOTDIR", "rename", source, destination);
            if (target.node === node)
                return;
            if (node.type === "directory" && target.path.startsWith(`${origin.path}/`))
                this.fail("EINVAL", "rename", source, destination);
            this.permission(origin.parent, 3, "rename", source);
            this.permission(target.parent, 3, "rename", destination);
            if (target.node) {
                if (node.type === "directory" && target.node.type !== "directory")
                    this.fail("ENOTDIR", "rename", source, destination);
                if (node.type !== "directory" && target.node.type === "directory")
                    this.fail("EISDIR", "rename", source, destination);
                if (target.node.type === "directory" && target.node.entries.size > 0)
                    this.fail("ENOTEMPTY", "rename", source, destination);
                target.node.nlink--;
                target.node.ctimeMs = Date.now();
            }
            origin.parent.entries.delete(origin.name);
            target.parent.entries.set(target.name, node);
            this.changed(origin.parent);
            this.changed(target.parent);
            node.ctimeMs = Date.now();
        }
        catch (error) {
            if (error instanceof FsError)
                throw new FsError(error.code, { syscall: "rename", path: source, dest: destination, cause: error });
            throw error;
        }
    }
    async copyFile(source, destination, options = {}) {
        options.signal?.throwIfAborted();
        try {
            const origin = this.file(source, "copyFile");
            this.permission(origin, 4, "copyFile", source);
            const target = this.resolve(destination, "copyFile", { followFinal: !options.exclusive, allowMissing: true });
            if (target.node && options.exclusive)
                this.fail("EEXIST", "copyFile", source, destination);
            if (target.node === origin)
                this.fail("EINVAL", "copyFile", source, destination);
            const node = this.openWrite(destination, { mode: origin.mode & 0o7777, flag: options.exclusive ? "wx" : "w" }, "copyFile");
            node.data = new Uint8Array(origin.data);
            node.mode = origin.mode;
            this.changed(node);
            origin.atimeMs = Date.now();
        }
        catch (error) {
            if (error instanceof FsError)
                throw new FsError(error.code, { syscall: "copyFile", path: source, dest: destination, cause: error });
            throw error;
        }
    }
    async realpath(path, options = {}) {
        options.signal?.throwIfAborted();
        return this.resolve(path, "realpath").path;
    }
    async access(path, mode = 0, options = {}) {
        options.signal?.throwIfAborted();
        if (!Number.isInteger(mode) || mode < 0 || mode > 7)
            this.fail("EINVAL", "access", path);
        this.permission(this.resolve(path, "access").node, mode, "access", path);
    }
    async readlink(path, options = {}) {
        options.signal?.throwIfAborted();
        const node = this.resolve(path, "readlink", { followFinal: false }).node;
        if (node.type !== "symlink")
            this.fail("EINVAL", "readlink", path);
        return node.target;
    }
    async symlink(target, path, options = {}) {
        options.signal?.throwIfAborted();
        this.validatePath(target, "symlink");
        const location = this.resolve(path, "symlink", { followFinal: false, allowMissing: true });
        if (location.node)
            this.fail("EEXIST", "symlink", path);
        this.permission(location.parent, 3, "symlink", path);
        location.parent.entries.set(location.name, { ...this.metadata(typeModes.symlink | 0o777), type: "symlink", target });
        this.changed(location.parent);
    }
    async link(existingPath, newPath, options = {}) {
        options.signal?.throwIfAborted();
        const node = this.resolve(existingPath, "link", { followFinal: false }).node;
        if (node.type === "directory")
            this.fail("EPERM", "link", existingPath, newPath);
        const target = this.resolve(newPath, "link", { followFinal: false, allowMissing: true });
        if (target.node)
            this.fail("EEXIST", "link", existingPath, newPath);
        this.permission(target.parent, 3, "link", newPath);
        target.parent.entries.set(target.name, node);
        node.nlink++;
        node.ctimeMs = Date.now();
        this.changed(target.parent);
    }
    async chmod(path, mode, options = {}) {
        options.signal?.throwIfAborted();
        const permissions = this.mode(mode, 0, "chmod", path);
        const node = this.resolve(path, "chmod").node;
        node.mode = typeModes[node.type] | permissions;
        node.ctimeMs = Date.now();
    }
    async utimes(path, atimeMs, mtimeMs, options = {}) {
        options.signal?.throwIfAborted();
        if (!Number.isFinite(atimeMs) || !Number.isFinite(mtimeMs))
            this.fail("EINVAL", "utimes", path);
        const node = this.resolve(path, "utimes").node;
        node.atimeMs = atimeMs;
        node.mtimeMs = mtimeMs;
        node.ctimeMs = Date.now();
    }
    async truncate(path, length = 0, options = {}) {
        options.signal?.throwIfAborted();
        this.integer(length, "truncate", path);
        const node = this.file(path, "truncate");
        this.permission(node, 2, "truncate", path);
        const data = this.allocate(length, "truncate", path);
        data.set(node.data.subarray(0, length));
        node.data = data;
        this.changed(node);
    }
    async *readStream(path, options = {}) {
        options.signal?.throwIfAborted();
        const start = options.start ?? 0;
        const chunkSize = options.chunkSize ?? 64 * 1024;
        this.integer(start, "readStream", path);
        this.integer(chunkSize, "readStream", path);
        if (chunkSize === 0)
            this.fail("EINVAL", "readStream", path);
        if (options.endExclusive !== undefined) {
            this.integer(options.endExclusive, "readStream", path);
            if (options.endExclusive < start)
                this.fail("EINVAL", "readStream", path);
        }
        const node = this.file(path, "readStream");
        this.permission(node, 4, "readStream", path);
        const data = node.data;
        const end = Math.min(options.endExclusive ?? data.byteLength, data.byteLength);
        node.atimeMs = Date.now();
        for (let offset = start; offset < end; offset += chunkSize) {
            options.signal?.throwIfAborted();
            yield data.slice(offset, Math.min(offset + chunkSize, end));
        }
        options.signal?.throwIfAborted();
    }
    async writeStream(path, source, options = {}) {
        options.signal?.throwIfAborted();
        const node = this.openWrite(path, options, "writeStream");
        if (options.flag !== "a" && options.flag !== "ax") {
            node.data = new Uint8Array();
            this.changed(node);
        }
        for await (const chunk of source) {
            options.signal?.throwIfAborted();
            this.append(node, this.bytes(chunk), "writeStream", path);
        }
        options.signal?.throwIfAborted();
    }
}
const memoryImplementation = Object.getOwnPropertyDescriptors(MemoryFileSystem.prototype);
export function createMemoryFileSystem() {
    return new MemoryFileSystem();
}
//# sourceMappingURL=index.js.map