import { ACCESS_MODES, isAbsolutePath, isFsError, validatePath, writeBytes, } from "../../contracts/index.js";
import { settings } from "./options.js";
const USAGE = "usage: which [-as] program ...\n";
const encoder = new TextEncoder();
const descriptions = {
    EACCES: "permission denied",
    EAGAIN: "resource temporarily unavailable",
    EBADF: "bad file descriptor",
    EBUSY: "resource busy or locked",
    ECANCELED: "operation canceled",
    EEXIST: "file already exists",
    EFBIG: "file too large",
    EINTR: "interrupted system call",
    EINVAL: "invalid argument",
    EIO: "input/output error",
    EISDIR: "illegal operation on a directory",
    ELOOP: "too many symbolic links encountered",
    EMFILE: "too many open files",
    ENAMETOOLONG: "name too long",
    ENFILE: "file table overflow",
    ENOENT: "no such file or directory",
    ENOMEM: "not enough memory",
    ENOSPC: "no space left on device",
    ENOSYS: "function not implemented",
    ENOTDIR: "not a directory",
    ENOTEMPTY: "directory not empty",
    ENOTSUP: "operation not supported",
    EOPNOTSUPP: "operation not supported",
    EPERM: "operation not permitted",
    EPIPE: "broken pipe",
    EROFS: "read-only file system",
    ETIMEDOUT: "operation timed out",
    EXDEV: "cross-device link not permitted",
};
const misses = new Set([
    "ENOENT", "ENOTDIR", "EACCES", "EPERM", "ELOOP", "ENAMETOOLONG",
]);
class Diagnostic extends Error {
}
class Invocation {
    context;
    limits;
    hasNul = false;
    probes = 0;
    outputBytes = 0;
    all = false;
    quiet = false;
    cwd = "";
    cwdBytes = 0;
    constructor(context, limits) {
        this.context = context;
        this.limits = limits;
    }
    check() {
        this.context.signal.throwIfAborted();
    }
    limit(key) {
        throw new Diagnostic(`which: ${key} limit exceeded\n`);
    }
    add(current, increment, maximum, key) {
        if (increment > maximum - current)
            this.limit(key);
        return current + increment;
    }
    bytes(text, maximum, key, start = 0, end = text.length) {
        this.check();
        if (end - start > maximum)
            this.limit(key);
        let count = 0;
        let checkpoint = start;
        for (let cursor = start; cursor < end; cursor++) {
            if (cursor >= checkpoint) {
                this.check();
                checkpoint = cursor + 4096;
            }
            const code = text.charCodeAt(cursor);
            let width = code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
            if (code === 0)
                this.hasNul = true;
            if (code >= 0xd800 && code <= 0xdbff && cursor + 1 < end) {
                const next = text.charCodeAt(cursor + 1);
                if (next >= 0xdc00 && next <= 0xdfff) {
                    width = 4;
                    cursor++;
                }
            }
            count = this.add(count, width, maximum, key);
        }
        this.check();
        return count;
    }
    parse() {
        const args = this.context.args;
        let operand = 0;
        for (; operand < args.length; operand++) {
            this.check();
            const argument = args[operand];
            if (argument === "--") {
                operand++;
                break;
            }
            if (argument === "-" || !argument.startsWith("-"))
                break;
            for (let cursor = 1; cursor < argument.length; cursor++) {
                if ((cursor - 1) % 4096 === 0)
                    this.check();
                const flag = argument.charAt(cursor);
                if (flag === "a")
                    this.all = true;
                else if (flag === "s")
                    this.quiet = true;
                else
                    throw new Diagnostic(`which: illegal option -- ${String.fromCodePoint(argument.codePointAt(cursor))}\n${USAGE}`);
            }
        }
        this.check();
        if (operand === args.length)
            throw new Diagnostic(USAGE);
        return operand;
    }
    async write(sink, text) {
        this.check();
        const bytes = encoder.encode(text);
        this.check();
        try {
            await writeBytes(sink, bytes, this.context.signal);
        }
        catch (error) {
            this.check();
            throw error;
        }
        this.check();
    }
    async probe(name, nameBytes, path, start = 0, end = 0) {
        this.check();
        this.probes = this.add(this.probes, 1, this.limits.maxProbes, "maxProbes");
        let displayBytes = nameBytes;
        if (path !== undefined) {
            const componentBytes = start === end ? 1 : this.bytes(path, this.limits.maxPathBytes, "maxPathBytes", start, end);
            displayBytes = this.add(componentBytes, 1, this.limits.maxPathBytes, "maxPathBytes");
            displayBytes = this.add(displayBytes, nameBytes, this.limits.maxPathBytes, "maxPathBytes");
        }
        else if (displayBytes > this.limits.maxPathBytes)
            this.limit("maxPathBytes");
        const absolute = path === undefined ? isAbsolutePath(name) : path.charAt(start) === "/";
        if (!absolute) {
            const prefixBytes = this.cwd === "/" ? 0 : this.cwdBytes;
            const lookupPrefixBytes = this.add(prefixBytes, 1, this.limits.maxPathBytes, "maxPathBytes");
            this.add(lookupPrefixBytes, displayBytes, this.limits.maxPathBytes, "maxPathBytes");
        }
        this.check();
        const display = path === undefined ? name : `${start === end ? "." : path.slice(start, end)}/${name}`;
        const lookup = absolute ? display : `${this.cwd === "/" ? "" : this.cwd}/${display}`;
        validatePath(lookup);
        this.check();
        if (display.endsWith("/") || display.endsWith("/.") || display.endsWith("/.."))
            return false;
        try {
            this.check();
            const stat = await this.context.fs.stat(lookup, { signal: this.context.signal });
            this.check();
            if (stat.type !== "file")
                return false;
            this.check();
            await this.context.fs.access(lookup, ACCESS_MODES.X_OK, { signal: this.context.signal });
            this.check();
        }
        catch (error) {
            this.check();
            if (isFsError(error) && misses.has(error.code))
                return false;
            const description = isFsError(error) ? descriptions[error.code] : "filesystem operation failed";
            throw new Diagnostic(`which: ${display}: ${description}\n`);
        }
        this.check();
        if (!this.quiet) {
            const lineBytes = this.add(displayBytes, 1, this.limits.maxOutputBytes - this.outputBytes, "maxOutputBytes");
            this.outputBytes += lineBytes;
            this.check();
            await this.write(this.context.stdout, `${display}\n`);
        }
        this.check();
        return true;
    }
    async search() {
        this.check();
        const { args } = this.context;
        if (args.length > this.limits.maxArguments)
            this.limit("maxArguments");
        const path = this.context.env.PATH;
        this.cwd = this.context.cwd;
        let argumentBytes = 0;
        for (const argument of args) {
            this.check();
            argumentBytes += this.bytes(argument, this.limits.maxArgumentBytes - argumentBytes, "maxArgumentBytes");
        }
        if (path !== undefined) {
            this.bytes(path, this.limits.maxPathEnvBytes, "maxPathEnvBytes");
            let components = 1;
            for (let cursor = 0; cursor < path.length; cursor++) {
                if (cursor % 4096 === 0)
                    this.check();
                if (path.charAt(cursor) === ":")
                    components = this.add(components, 1, this.limits.maxPathComponents, "maxPathComponents");
            }
        }
        this.cwdBytes = this.bytes(this.cwd, this.limits.maxPathBytes, "maxPathBytes");
        if (this.hasNul)
            throw new Diagnostic("which: invalid argument: NUL byte\n");
        const firstOperand = this.parse();
        if (!isAbsolutePath(this.cwd))
            throw new Diagnostic("which: cwd must be an absolute virtual path\n");
        validatePath(this.cwd);
        this.check();
        if (path === undefined)
            return { exitCode: 1 };
        let everyFound = true;
        for (let operand = firstOperand; operand < args.length; operand++) {
            this.check();
            const name = args[operand];
            if (name === "") {
                everyFound = false;
                continue;
            }
            const nameBytes = this.bytes(name, this.limits.maxArgumentBytes, "maxArgumentBytes");
            let slash = false;
            for (let cursor = 0; cursor < name.length; cursor++) {
                if (cursor % 4096 === 0)
                    this.check();
                if (name.charAt(cursor) === "/") {
                    slash = true;
                    break;
                }
            }
            let found = false;
            if (slash)
                found = await this.probe(name, nameBytes);
            else {
                let start = 0;
                for (let cursor = 0; cursor <= path.length; cursor++) {
                    if (cursor % 4096 === 0)
                        this.check();
                    if (cursor === path.length || path.charAt(cursor) === ":") {
                        if (await this.probe(name, nameBytes, path, start, cursor)) {
                            found = true;
                            if (!this.all)
                                break;
                        }
                        start = cursor + 1;
                    }
                }
            }
            if (!found)
                everyFound = false;
        }
        this.check();
        return { exitCode: everyFound ? 0 : 1 };
    }
    async execute() {
        this.check();
        try {
            const result = await this.search();
            this.check();
            return result;
        }
        catch (error) {
            this.check();
            if (!(error instanceof Diagnostic))
                throw error;
            this.bytes(error.message, this.limits.maxPathBytes + 256, "maxPathBytes");
            await this.write(this.context.stderr, error.message);
            this.check();
            return { exitCode: 1 };
        }
    }
}
export function createWhichCommand(options = {}) {
    const limits = settings(options);
    return Object.freeze({
        name: "which",
        execute(context) { return new Invocation(context, limits).execute(); },
    });
}
//# sourceMappingURL=which.js.map