import { ACCESS_MODES, FsError, readBytes } from "../../contracts/index.js";
import { compareEntries, registerEntryView } from "../mount/comparison.js";
function readOnly(syscall, path, dest) {
    throw new FsError("EROFS", { syscall, path, ...(dest === undefined ? {} : { dest }) });
}
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
export class ReadOnlyFileSystem {
    #filesystem;
    #capabilities;
    constructor(filesystem) {
        this.#filesystem = filesystem;
        registerEntryView(this, async (path) => ({ filesystem: this.#filesystem, path, readOnly: true }));
        const streamingRead = typeof filesystem.readStream === "function" ? filesystem.capabilities.streamingRead : false;
        this.#capabilities = Object.freeze({
            readOnly: true,
            symlinks: filesystem.capabilities.symlinks === true && typeof filesystem.readlink === "function",
            hardlinks: false,
            permissions: false,
            timestamps: false,
            atomicRename: false,
            ...(streamingRead === undefined ? {} : { streamingRead }),
            streamingWrite: false,
        });
    }
    get capabilities() {
        return this.#capabilities;
    }
    async readFile(path, options) {
        return new Uint8Array(await this.#filesystem.readFile(path, options));
    }
    async stat(path, options) {
        return snapshotStat(await this.#filesystem.stat(path, options));
    }
    async lstat(path, options) {
        return snapshotStat(await this.#filesystem.lstat(path, options));
    }
    compareEntry(path, peer, peerPath, options = {}) {
        return compareEntries(this, path, peer, peerPath, options);
    }
    async readdir(path, options) {
        return (await this.#filesystem.readdir(path, options)).map((entry) => ({ name: entry.name, type: entry.type }));
    }
    async realpath(path, options) {
        return this.#filesystem.realpath(path, options);
    }
    async access(path, mode = ACCESS_MODES.F_OK, options) {
        if (!Number.isInteger(mode) || mode < 0 || mode > 7) {
            throw new FsError("EINVAL", { syscall: "access", path });
        }
        if ((mode & ACCESS_MODES.W_OK) !== 0)
            readOnly("access", path);
        return this.#filesystem.access(path, mode, options);
    }
    async readlink(path, options) {
        if (typeof this.#filesystem.readlink !== "function") {
            throw new FsError("ENOTSUP", { syscall: "readlink", path });
        }
        return this.#filesystem.readlink(path, options);
    }
    async *readStream(path, options) {
        if (typeof this.#filesystem.readStream !== "function") {
            throw new FsError("ENOTSUP", { syscall: "readStream", path });
        }
        for await (const chunk of readBytes(this.#filesystem.readStream(path, options), options?.signal)) {
            yield new Uint8Array(chunk);
        }
    }
    async writeFile(path, _data, _options) {
        readOnly("writeFile", path);
    }
    async appendFile(path, _data, _options) {
        readOnly("appendFile", path);
    }
    async writeStream(path, _source, _options) {
        readOnly("writeStream", path);
    }
    async mkdir(path, _options) {
        readOnly("mkdir", path);
    }
    async rm(path, _options) {
        readOnly("rm", path);
    }
    async unlink(path, _options) {
        readOnly("unlink", path);
    }
    async rmdir(path, _options) {
        readOnly("rmdir", path);
    }
    async rename(source, destination, _options) {
        readOnly("rename", source, destination);
    }
    async copyFile(source, destination, _options) {
        readOnly("copyFile", source, destination);
    }
    async symlink(target, path, _options) {
        readOnly("symlink", target, path);
    }
    async link(existingPath, newPath, _options) {
        readOnly("link", existingPath, newPath);
    }
    async chmod(path, _mode, _options) {
        readOnly("chmod", path);
    }
    async utimes(path, _atimeMs, _mtimeMs, _options) {
        readOnly("utimes", path);
    }
    async truncate(path, _length, _options) {
        readOnly("truncate", path);
    }
}
export function createReadOnlyFileSystem(filesystem) {
    return new ReadOnlyFileSystem(filesystem);
}
//# sourceMappingURL=index.js.map