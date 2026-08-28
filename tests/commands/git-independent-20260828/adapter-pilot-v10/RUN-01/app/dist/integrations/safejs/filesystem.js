import { randomBytes } from "node:crypto";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import { nodeDirent, nodeStats } from "./stats.js";
import { booleanValue, checkSignal, onlyKeys, record, withSignal } from "./values.js";
function fsError(code, syscall, path) {
    return Object.assign(new Error(`${code}: ${syscall}${path === undefined ? "" : ` '${path}'`}`), {
        code,
        syscall,
        ...(path === undefined ? {} : { path }),
    });
}
function unsupported(operation) {
    throw fsError("ENOTSUP", operation);
}
function hasCode(error, code) {
    return error instanceof Error && "code" in error && error.code === code;
}
function childPath(parent, name) {
    return `${parent.replace(/\/$/u, "")}/${name}`;
}
function optionsRecord(value, allowed) {
    const options = value == null ? {} : typeof value === "string" ? { encoding: value } : record(value, "options");
    onlyKeys(options, allowed);
    return options;
}
function encoding(value, fallback) {
    if (value == null)
        return fallback;
    if (value === "buffer")
        return value;
    if (typeof value !== "string" || !Buffer.isEncoding(value)) {
        throw new TypeError("Invalid encoding");
    }
    return value;
}
function modeValue(value, fallback) {
    if (value === undefined)
        return fallback;
    const parsed = typeof value === "string" && /^[0-7]+$/u.test(value) ? Number.parseInt(value, 8) : value;
    if (typeof parsed !== "number" || !Number.isInteger(parsed) || parsed < 0 || parsed > 0o7777) {
        throw new TypeError("Invalid file mode");
    }
    return parsed;
}
function timeValue(value) {
    const number = value instanceof Date ? value.getTime() : Number(value) * 1000;
    if ((typeof value !== "string" && typeof value !== "number" && !(value instanceof Date)) || !Number.isFinite(number)) {
        throw new TypeError("Invalid timestamp");
    }
    return number;
}
class NodeFsBridge {
    #fs;
    #cwd;
    #signal;
    constructor(fs, options) {
        if (fs === undefined)
            throw new TypeError("An explicit filesystem is required");
        const cwd = options.cwd ?? "/";
        if (!posix.isAbsolute(cwd) || cwd.includes("\0"))
            throw new TypeError("cwd must be an absolute virtual path");
        this.#fs = fs;
        this.#cwd = cwd;
        this.#signal = options.signal;
    }
    #path(value) {
        const path = value instanceof URL ? fileURLToPath(value) : Buffer.isBuffer(value) ? value.toString("utf8") : value;
        if (typeof path !== "string" || path.includes("\0"))
            throw new TypeError("Expected a path without NUL bytes; file handles are unsupported");
        if (path.length === 0)
            throw fsError("ENOENT", "path", path);
        return posix.isAbsolute(path) ? path : childPath(this.#cwd, path);
    }
    #options(signal) {
        if (signal !== undefined && !(signal instanceof AbortSignal))
            throw new TypeError("Invalid AbortSignal");
        const combined = signal === undefined ? this.#signal : this.#signal === undefined || signal === this.#signal ? signal : AbortSignal.any([signal, this.#signal]);
        checkSignal(combined);
        return combined === undefined ? {} : { signal: combined };
    }
    #call(operation, signal) {
        const options = this.#options(signal);
        return withSignal(options.signal, () => operation(options));
    }
    async readFile(path, value) {
        const options = optionsRecord(value, ["encoding", "flag", "signal"]);
        if (options.flag !== undefined && options.flag !== "r")
            unsupported("readFile flag");
        if (options.encoding === "buffer")
            throw new TypeError("Invalid read encoding");
        const codec = encoding(options.encoding, "buffer");
        const bytes = await this.#call((signal) => this.#fs.readFile(this.#path(path), signal), options.signal);
        const buffer = Buffer.from(bytes);
        return codec === "buffer" ? buffer : buffer.toString(codec);
    }
    async #write(path, data, value, fallback) {
        const options = optionsRecord(value, ["encoding", "flag", "mode", "flush", "signal"]);
        if (booleanValue(options.flush))
            unsupported("writeFile flush");
        const codec = encoding(options.encoding, "utf8");
        if (codec === "buffer")
            throw new TypeError("Invalid write encoding");
        const flag = options.flag ?? fallback;
        if (flag !== "w" && flag !== "wx" && flag !== "a" && flag !== "ax")
            unsupported("writeFile flag");
        const mode = modeValue(options.mode, 0o666);
        let bytes;
        if (typeof data === "string")
            bytes = Buffer.from(data, codec);
        else if (ArrayBuffer.isView(data))
            bytes = Buffer.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        else
            throw new TypeError("writeFile accepts a string or ArrayBuffer view; streams and file handles are unsupported");
        await this.#call((signal) => this.#fs.writeFile(this.#path(path), bytes, { ...signal, flag, mode }), options.signal);
    }
    async writeFile(path, data, options) {
        await this.#write(path, data, options, "w");
    }
    async appendFile(path, data, options) {
        await this.#write(path, data, options, "a");
    }
    async stat(path, value) {
        const options = optionsRecord(value, ["bigint"]);
        if (booleanValue(options.bigint))
            unsupported("stat bigint");
        return nodeStats(await this.#call((signal) => this.#fs.stat(this.#path(path), signal)));
    }
    async lstat(path, value) {
        const options = optionsRecord(value, ["bigint"]);
        if (booleanValue(options.bigint))
            unsupported("lstat bigint");
        return nodeStats(await this.#call((signal) => this.#fs.lstat(this.#path(path), signal)));
    }
    async readdir(path, value) {
        const options = optionsRecord(value, ["encoding", "withFileTypes", "recursive"]);
        const codec = encoding(options.encoding, "utf8");
        const withFileTypes = booleanValue(options.withFileTypes);
        const recursive = booleanValue(options.recursive);
        const root = this.#path(path);
        const entries = [];
        const pending = [root];
        while (pending.length > 0) {
            const directory = pending.shift();
            if (directory === undefined)
                break;
            for (const entry of await this.#call((signal) => this.#fs.readdir(directory, signal))) {
                if (entry.name === "" || entry.name === "." || entry.name === ".." || entry.name.includes("/") || entry.name.includes("\0")) {
                    throw new TypeError("Invalid directory entry from filesystem");
                }
                const fullPath = childPath(directory, entry.name);
                entries.push({ ...entry, parentPath: directory, relative: posix.relative(root, fullPath) });
                if (recursive && entry.type === "directory")
                    pending.push(fullPath);
            }
        }
        if (withFileTypes) {
            return codec === "buffer"
                ? entries.map((entry) => nodeDirent(Buffer.from(entry.name), entry.parentPath, entry.type))
                : entries.map((entry) => nodeDirent(Buffer.from(entry.name).toString(codec), entry.parentPath, entry.type));
        }
        return codec === "buffer"
            ? entries.map((entry) => Buffer.from(entry.relative))
            : entries.map((entry) => Buffer.from(entry.relative).toString(codec));
    }
    async mkdir(path, value) {
        const options = typeof value === "number" || typeof value === "string" ? { mode: value } : optionsRecord(value, ["mode", "recursive"]);
        const mode = modeValue(options.mode, 0o777);
        const recursive = booleanValue(options.recursive);
        const target = this.#path(path);
        let firstCreated;
        if (recursive) {
            let candidate = target;
            while (true) {
                try {
                    await this.#call((signal) => this.#fs.stat(candidate, signal));
                    break;
                }
                catch (error) {
                    if (!hasCode(error, "ENOENT"))
                        throw error;
                    firstCreated = candidate;
                    const parent = posix.dirname(candidate);
                    if (parent === candidate)
                        break;
                    candidate = parent;
                }
            }
        }
        await this.#call((signal) => this.#fs.mkdir(target, { ...signal, mode, recursive }));
        return firstCreated;
    }
    async access(path, mode = 0) {
        if (!Number.isInteger(mode) || mode < 0 || mode > 7)
            throw new TypeError("Invalid access mode");
        await this.#call((signal) => this.#fs.access(this.#path(path), mode, signal));
    }
    async rm(path, value) {
        const options = optionsRecord(value, ["force", "recursive", "maxRetries", "retryDelay"]);
        if (options.maxRetries !== undefined && options.maxRetries !== 0)
            unsupported("rm retries");
        if (options.retryDelay !== undefined)
            unsupported("rm retryDelay");
        const recursive = booleanValue(options.recursive);
        const force = booleanValue(options.force);
        await this.#call((signal) => this.#fs.rm(this.#path(path), { ...signal, recursive, force }));
    }
    async rmdir(path, value) {
        const options = optionsRecord(value, ["recursive", "maxRetries", "retryDelay"]);
        const stat = await this.lstat(path);
        if (!stat.isDirectory())
            throw fsError("ENOTDIR", "rmdir", this.#path(path));
        if (!booleanValue(options.recursive)) {
            if ((await this.readdir(path)).length > 0)
                throw fsError("ENOTEMPTY", "rmdir", this.#path(path));
            if (options.maxRetries !== undefined && options.maxRetries !== 0)
                unsupported("rmdir retries");
            if (options.retryDelay !== undefined)
                unsupported("rmdir retryDelay");
            const method = this.#fs.rmdir;
            if (method === undefined)
                unsupported("atomic rmdir");
            await this.#call((signal) => method.call(this.#fs, this.#path(path), signal));
        }
        else
            await this.rm(path, options);
    }
    async rename(source, destination) {
        await this.#call((signal) => this.#fs.rename(this.#path(source), this.#path(destination), signal));
    }
    async copyFile(source, destination, mode = 0) {
        if (mode !== 0 && mode !== 1)
            unsupported("copyFile mode");
        await this.#call((signal) => this.#fs.copyFile(this.#path(source), this.#path(destination), { ...signal, exclusive: mode === 1 }));
    }
    async cp(source, destination, value) {
        const options = optionsRecord(value, ["recursive", "force", "errorOnExist", "mode", "dereference", "preserveTimestamps", "verbatimSymlinks"]);
        if (booleanValue(options.dereference) || booleanValue(options.preserveTimestamps) || booleanValue(options.verbatimSymlinks))
            unsupported("cp options");
        const recursive = booleanValue(options.recursive);
        const force = booleanValue(options.force, true);
        const errorOnExist = booleanValue(options.errorOnExist);
        if (options.mode !== undefined && options.mode !== 0 && options.mode !== 1)
            unsupported("cp mode");
        const from = this.#path(source);
        const to = this.#path(destination);
        const canonicalFrom = await this.realpath(from);
        let ancestor = posix.dirname(to);
        let canonicalAncestor;
        while (true) {
            try {
                canonicalAncestor = await this.realpath(ancestor);
                break;
            }
            catch (error) {
                if (!hasCode(error, "ENOENT"))
                    throw error;
                const parent = posix.dirname(ancestor);
                if (parent === ancestor)
                    throw error;
                ancestor = parent;
            }
        }
        const canonicalTo = posix.resolve(canonicalAncestor, posix.relative(ancestor, to));
        if (canonicalFrom === "/" || canonicalTo === canonicalFrom || canonicalTo.startsWith(`${canonicalFrom}/`))
            throw fsError("EINVAL", "cp", to);
        const copy = async (current, target) => {
            const sourceStat = await this.lstat(current);
            if (sourceStat.isSymbolicLink())
                unsupported("cp symlink");
            let destinationStat;
            try {
                destinationStat = await this.lstat(target);
            }
            catch (error) {
                if (!hasCode(error, "ENOENT"))
                    throw error;
            }
            if (destinationStat?.isSymbolicLink())
                unsupported("cp destination symlink");
            if (sourceStat.isDirectory()) {
                if (!recursive)
                    throw fsError("EISDIR", "cp", current);
                if (destinationStat !== undefined && !destinationStat.isDirectory())
                    throw fsError("ENOTDIR", "cp", target);
                await this.mkdir(target, { recursive: true, mode: sourceStat.mode & 0o7777 });
                for (const entry of await this.readdir(current))
                    await copy(childPath(current, entry), childPath(target, entry));
            }
            else {
                if (destinationStat?.isDirectory())
                    throw fsError("EISDIR", "cp", target);
                if (destinationStat !== undefined && !force) {
                    if (errorOnExist)
                        throw fsError("EEXIST", "cp", target);
                    return;
                }
                await this.mkdir(posix.dirname(target), { recursive: true });
                await this.copyFile(current, target, options.mode === 1 || !force ? 1 : 0);
            }
        };
        await copy(from, to);
    }
    async readlink(path, value) {
        const codec = encoding(optionsRecord(value, ["encoding"]).encoding, "utf8");
        const method = this.#fs.readlink;
        if (method === undefined)
            unsupported("readlink");
        const target = await this.#call((signal) => method.call(this.#fs, this.#path(path), signal));
        return codec === "buffer" ? Buffer.from(target) : Buffer.from(target).toString(codec);
    }
    async realpath(path, value) {
        const codec = encoding(optionsRecord(value, ["encoding"]).encoding, "utf8");
        const target = await this.#call((signal) => this.#fs.realpath(this.#path(path), signal));
        return codec === "buffer" ? Buffer.from(target) : Buffer.from(target).toString(codec);
    }
    async mkdtemp(prefix, value) {
        if (typeof prefix !== "string" || prefix.includes("\0"))
            throw new TypeError("Invalid mkdtemp prefix");
        const codec = encoding(optionsRecord(value, ["encoding"]).encoding, "utf8");
        for (let attempt = 0; attempt < 10; attempt += 1) {
            const path = prefix + randomBytes(6).toString("hex").slice(0, 6);
            try {
                await this.mkdir(path, { mode: 0o700 });
                return codec === "buffer" ? Buffer.from(path) : Buffer.from(path).toString(codec);
            }
            catch (error) {
                if (!hasCode(error, "EEXIST"))
                    throw error;
            }
        }
        throw fsError("EEXIST", "mkdtemp", prefix);
    }
    async symlink(target, path, type) {
        if (type !== undefined && type !== null && type !== "file" && type !== "dir")
            unsupported("symlink type");
        const linkTarget = target instanceof URL ? fileURLToPath(target) : Buffer.isBuffer(target) ? target.toString("utf8") : target;
        if (typeof linkTarget !== "string" || linkTarget.includes("\0"))
            throw new TypeError("Invalid symlink target");
        const method = this.#fs.symlink;
        if (method === undefined)
            unsupported("symlink");
        await this.#call((signal) => method.call(this.#fs, linkTarget, this.#path(path), signal));
    }
    async link(existing, path) {
        const method = this.#fs.link;
        if (method === undefined)
            unsupported("link");
        await this.#call((signal) => method.call(this.#fs, this.#path(existing), this.#path(path), signal));
    }
    async chmod(path, value) {
        const mode = modeValue(value, 0);
        const method = this.#fs.chmod;
        if (method === undefined)
            unsupported("chmod");
        await this.#call((signal) => method.call(this.#fs, this.#path(path), mode, signal));
    }
    async utimes(path, atime, mtime) {
        const accessTime = timeValue(atime);
        const modificationTime = timeValue(mtime);
        const method = this.#fs.utimes;
        if (method === undefined)
            unsupported("utimes");
        await this.#call((signal) => method.call(this.#fs, this.#path(path), accessTime, modificationTime, signal));
    }
    async truncate(path, length = 0) {
        if (!Number.isInteger(length))
            throw new TypeError("Invalid truncate length");
        const method = this.#fs.truncate;
        if (method === undefined)
            unsupported("truncate");
        await this.#call((signal) => method.call(this.#fs, this.#path(path), Math.max(0, length), signal));
    }
}
export function createNodeFsBridge(fs, options = {}) {
    return new NodeFsBridge(fs, options);
}
export function makeSafeJsFsModule(makeFsModule, fs, options = {}) {
    return makeFsModule({ fs: createNodeFsBridge(fs, options) });
}
//# sourceMappingURL=filesystem.js.map