import { configuration, environment } from "./config.js";
import { inflateObject } from "./codec.js";
import { compare, component, objectPath, parent } from "./io.js";
import { GIT_LIMITS, GitFailure, demand } from "./limits.js";
const oidPattern = /^[0-9a-f]{40}$/;
const modes = new Set([0o100644, 0o100755, 0o120000]);
export function refName(name) {
    demand(name.startsWith("refs/") && !name.endsWith(".") && !name.includes("..") && !name.includes("@{") && !/[\x00-\x20\x7f~^:?*\[\\]/.test(name), "invalid Git ref name");
    for (const part of name.split("/")) {
        component(part);
        demand(!part.startsWith(".") && !part.endsWith(".lock"), "invalid Git ref component");
    }
}
export class Repository {
    session;
    gitdir;
    root;
    cwd;
    refs = new Map();
    peeled = new Map();
    objects = new Map();
    commits = new Map();
    indexData;
    names = [];
    config;
    constructor(session, gitdir, root, cwd) {
        this.session = session;
        this.gitdir = gitdir;
        this.root = root;
        this.cwd = cwd;
    }
    static async discover(session, cwd) {
        environment(session.context.env);
        let cursor = session.path("/", cwd);
        for (let depth = 0; depth <= GIT_LIMITS.maxDepth; depth++) {
            await session.safe(cursor);
            demand((await session.stat(cursor))?.type === "directory", "Git cwd is not a directory");
            const marker = session.path(cursor, ".git");
            const git = await session.stat(marker);
            if (git) {
                demand(git.type === "directory", "M1A gitfile/symlink routing unsupported");
                const repository = new Repository(session, marker, cursor, cwd);
                await repository.admit();
                return repository;
            }
            if (await session.stat(session.path(cursor, "HEAD")) && await session.stat(session.path(cursor, "objects"))) {
                const repository = new Repository(session, cursor, undefined, cwd);
                await repository.admit();
                return repository;
            }
            if (cursor === session.boundary || cursor === "/")
                break;
            cursor = parent(cursor);
        }
        throw new GitFailure("not a supported Git repository");
    }
    async admit() {
        const session = this.session;
        await session.safe(this.gitdir);
        demand((await session.stat(session.path(this.gitdir, "HEAD")))?.type === "file", "missing/invalid Git HEAD");
        for (const name of ["commondir", "gitdir", "config.worktree", "worktrees", "shallow", "info/grafts", "objects/info/alternates", "objects/info/http-alternates", "refs/replace", "reftable"]) {
            demand(!(await session.stat(session.path(this.gitdir, name))), `M1A unsupported storage: ${name}`);
        }
        this.config = await configuration(session, this.gitdir, this.root === undefined);
        const objects = session.path(this.gitdir, "objects");
        for (const entry of await session.list(objects)) {
            const directory = session.path(objects, entry.name);
            demand(entry.type === "directory", "M1A unsupported object storage");
            const children = await session.list(directory);
            if (entry.name === "pack" || entry.name === "info") {
                demand(children.length === 0, `M1A nonempty objects/${entry.name} unsupported`);
                continue;
            }
            demand(/^[0-9a-f]{2}$/.test(entry.name), "M1A unsupported object directory");
            for (const child of children) {
                demand(child.type === "file" && /^[0-9a-f]{38}$/.test(child.name), "M1A pack/idx/promisor or invalid loose object member");
                session.charge("maxObjects", 1);
                session.reserve(80);
                this.names.push(entry.name + child.name);
            }
        }
        const packed = await session.read(session.path(this.gitdir, "packed-refs"), GIT_LIMITS.maxMetadataBytes, true, true);
        if (packed) {
            try {
                let preceding;
                for (const line of session.text(packed).split("\n")) {
                    await session.step(line.length + 1);
                    if (!line || line.startsWith("#"))
                        continue;
                    if (line.startsWith("^")) {
                        demand(preceding && !this.peeled.has(preceding) && oidPattern.test(line.slice(1)), "invalid peeled packed ref");
                        this.peeled.set(preceding, line.slice(1));
                        continue;
                    }
                    demand(line.length > 41 && line[40] === " " && oidPattern.test(line.slice(0, 40)), "invalid packed ref");
                    const name = line.slice(41);
                    refName(name);
                    demand(!name.startsWith("refs/replace/") && !this.refs.has(name), "unsupported/duplicate packed ref");
                    session.charge("maxEntries", 1);
                    this.refs.set(name, line.slice(0, 40));
                    preceding = name;
                }
            }
            finally {
                session.release(packed);
            }
        }
        const walkRefs = async (prefix, depth) => {
            demand(depth <= GIT_LIMITS.maxDepth, "Git ref depth exceeded");
            const path = session.path(this.gitdir, prefix);
            const stat = await session.stat(path);
            if (!stat)
                return;
            if (stat.type === "directory") {
                for (const entry of await session.list(path))
                    await walkRefs(`${prefix}/${entry.name}`, depth + 1);
            }
            else {
                demand(stat.type === "file", "Git ref symlink refused");
                refName(prefix);
                demand(!prefix.startsWith("refs/replace/"), "replace refs unsupported");
                this.refs.set(prefix, await this.refFile(path));
            }
        };
        await walkRefs("refs", 0);
        this.refs.set("HEAD", await this.refFile(session.path(this.gitdir, "HEAD")));
        for (const name of this.refs.keys())
            await this.resolveRef(name, name === "HEAD");
    }
    async refFile(path) {
        const bytes = (await this.session.read(path, GIT_LIMITS.maxMetadataBytes, false, true));
        try {
            const value = this.session.text(bytes).trim();
            if (value.startsWith("ref: "))
                refName(value.slice(5));
            else
                demand(oidPattern.test(value), "invalid loose Git ref");
            return value;
        }
        finally {
            this.session.release(bytes);
        }
    }
    async resolveRef(name, unborn = false) {
        const visited = new Set();
        for (let depth = 0; depth < GIT_LIMITS.maxRefDepth; depth++) {
            await this.session.step();
            demand(!visited.has(name), "cyclic Git symbolic ref");
            visited.add(name);
            const value = this.refs.get(name);
            if (!value) {
                demand(unborn && name.startsWith("refs/heads/"), "missing Git ref");
                return undefined;
            }
            if (value.startsWith("ref: ")) {
                name = value.slice(5);
                continue;
            }
            return value;
        }
        throw new GitFailure("Git ref chain limit exceeded");
    }
    async object(oid) {
        demand(oidPattern.test(oid), "invalid Git object ID");
        const cached = this.objects.get(oid);
        if (cached) {
            await this.session.step();
            return cached;
        }
        const path = this.session.path(this.gitdir, `objects/${oid.slice(0, 2)}/${oid.slice(2)}`);
        const compressed = (await this.session.read(path, GIT_LIMITS.maxReadBytes));
        try {
            const object = await inflateObject(this.session, compressed, oid);
            this.objects.set(oid, object);
            return object;
        }
        finally {
            this.session.release(compressed);
        }
    }
    async headers(oid, type) {
        const object = await this.object(oid);
        demand(object.type === type, `Git object is not ${type}`);
        const separator = object.bytes.indexOf("\n\n");
        demand(separator >= 0 && separator <= GIT_LIMITS.maxMetadataBytes, "invalid Git object headers");
        const text = this.session.text(object.bytes.subarray(0, separator));
        demand(!text.includes("\0"), "invalid Git object headers");
        const values = new Map();
        for (const line of text.split("\n")) {
            await this.session.step(line.length + 1);
            const split = line.indexOf(" ");
            demand(split > 0, "invalid/continued Git header");
            const key = line.slice(0, split), value = line.slice(split + 1);
            const allowed = type === "commit" ? ["tree", "parent", "author", "committer"] : ["object", "type", "tag", "tagger"];
            demand(allowed.includes(key), `unsupported Git header: ${key}`);
            const previous = values.get(key) ?? [];
            demand(key === "parent" || previous.length === 0, "duplicate Git object header");
            previous.push(value);
            values.set(key, previous);
        }
        return { values, message: object.bytes.subarray(separator + 2) };
    }
    async peel(oid, expected) {
        const seen = new Set();
        for (let depth = 0; depth < GIT_LIMITS.maxRefDepth; depth++) {
            await this.session.step();
            demand(!seen.has(oid), "cyclic Git tag");
            seen.add(oid);
            const object = await this.object(oid);
            if (object.type !== "tag") {
                demand(!expected || object.type === expected, `Git object type must be ${expected}`);
                return oid;
            }
            const { values } = await this.headers(oid, "tag");
            const target = values.get("object")?.[0], type = values.get("type")?.[0], tag = values.get("tag")?.[0];
            demand(target && oidPattern.test(target) && type && ["blob", "tree", "commit", "tag"].includes(type) && tag && !/[\x00-\x20\x7f]/.test(tag), "invalid annotated Git tag");
            if (values.has("tagger"))
                identity(values.get("tagger")[0]);
            demand((await this.object(target)).type === type, "Git tag target type mismatch");
            oid = target;
        }
        throw new GitFailure("Git tag depth exceeded");
    }
    async commit(oid) {
        oid = await this.peel(oid, "commit");
        const cached = this.commits.get(oid);
        if (cached)
            return cached;
        this.session.charge("maxCommits", 1);
        const { values, message } = await this.headers(oid, "commit");
        const tree = values.get("tree")?.[0], author = values.get("author")?.[0], committer = values.get("committer")?.[0];
        demand(tree && oidPattern.test(tree) && author && committer, "missing Git commit headers");
        identity(author);
        identity(committer);
        const parents = values.get("parent") ?? [];
        demand(parents.every(parent => oidPattern.test(parent)), "invalid Git parent ID");
        demand((await this.object(tree)).type === "tree", "commit tree type mismatch");
        const result = { tree, parents, message };
        this.commits.set(oid, result);
        return result;
    }
    async revision(expression, unborn = false) {
        const split = expression.search(/[~^]/);
        const name = split < 0 ? expression : expression.slice(0, split);
        demand(name.length > 0 && !name.includes("@{") && !name.includes(":"), "unsupported Git revision");
        let oid;
        if (oidPattern.test(name))
            oid = name;
        else if (name === "HEAD" || name.startsWith("refs/")) {
            if (name !== "HEAD")
                refName(name);
            oid = await this.resolveRef(name, unborn && name === "HEAD");
        }
        else {
            const choices = [`refs/heads/${name}`, `refs/tags/${name}`].filter(ref => this.refs.has(ref));
            demand(choices.length === 1, "unknown/ambiguous Git revision");
            oid = await this.resolveRef(choices[0]);
        }
        if (!oid) {
            demand(split < 0, "unborn HEAD has no ancestry");
            return undefined;
        }
        await this.object(oid);
        let offset = split < 0 ? expression.length : split;
        while (offset < expression.length) {
            const operator = expression[offset++];
            demand(operator === "^" || operator === "~", "unsupported Git revision suffix");
            const start = offset;
            while (offset < expression.length && expression.charCodeAt(offset) >= 48 && expression.charCodeAt(offset) <= 57)
                offset++;
            const text = expression.slice(start, offset);
            demand(text.length <= 4, "Git ancestry count exceeded");
            const count = text ? Number(text) : 1;
            demand(count <= GIT_LIMITS.maxCommits, "Git ancestry count exceeded");
            oid = await this.peel(oid, "commit");
            if (operator === "^") {
                const commit = await this.commit(oid);
                if (count) {
                    demand(commit.parents[count - 1], "missing Git parent");
                    oid = commit.parents[count - 1];
                    await this.peel(oid, "commit");
                }
            }
            else
                for (let turn = 0; turn < count; turn++) {
                    const commit = await this.commit(oid);
                    demand(commit.parents[0], "missing Git first parent");
                    oid = commit.parents[0];
                }
        }
        await this.object(oid);
        return oid;
    }
    async tree(oid) {
        const result = new Map();
        if (!oid)
            return result;
        oid = await this.peel(oid);
        if ((await this.object(oid)).type === "commit")
            oid = (await this.commit(oid)).tree;
        const visit = async (treeId, prefix, depth, ancestors) => {
            demand(depth <= GIT_LIMITS.maxDepth && !ancestors.has(treeId), "Git tree cycle/depth exceeded");
            const object = await this.object(treeId);
            demand(object.type === "tree", "Git tree type mismatch");
            const next = new Set(ancestors);
            next.add(treeId);
            let offset = 0, previous;
            const siblings = new Set();
            while (offset < object.bytes.length) {
                const space = object.bytes.indexOf(32, offset), zero = object.bytes.indexOf(0, space + 1);
                demand(space > offset && space - offset <= 6 && zero > space && zero + 21 <= object.bytes.length, "truncated Git tree record");
                const rawMode = object.bytes.subarray(offset, space).toString("ascii");
                demand(["40000", "100644", "100755", "120000"].includes(rawMode), "unsupported Git tree mode/submodule");
                const mode = Number.parseInt(rawMode, 8), name = this.session.text(object.bytes.subarray(space + 1, zero));
                component(name);
                objectPath(name);
                demand(!siblings.has(name), "duplicate Git tree name");
                siblings.add(name);
                const ordering = Buffer.from(name + (mode === 0o40000 ? "/" : "\0"));
                demand(!previous || Buffer.compare(previous, ordering) < 0, "unsorted Git tree");
                previous = ordering;
                const childId = object.bytes.subarray(zero + 1, zero + 21).toString("hex");
                const path = prefix + name;
                this.session.charge("maxEntries", 1);
                this.session.reserve(80 + Buffer.byteLength(path) * 2);
                await this.session.step(zero + 21 - offset);
                offset = zero + 21;
                demand((await this.object(childId)).type === (mode === 0o40000 ? "tree" : "blob"), "Git tree entry target type mismatch");
                if (mode === 0o40000)
                    await visit(childId, path + "/", depth + 1, next);
                else
                    result.set(path, { path, mode, oid: childId, stage: 0 });
            }
        };
        await visit(oid, "", 0, new Set());
        return result;
    }
    async index() {
        demand(this.root, "Git index/worktree unavailable in bare repository");
        if (this.indexData)
            return this.indexData;
        const bytes = await this.session.read(this.session.path(this.gitdir, "index"), GIT_LIMITS.maxIndexBytes, true, true);
        if (!bytes)
            return this.indexData = [];
        try {
            demand(bytes.length >= 32 && bytes.subarray(0, 4).toString() === "DIRC", "invalid Git index header");
            const version = bytes.readUInt32BE(4), count = bytes.readUInt32BE(8), end = bytes.length - 20;
            demand(version === 2 || version === 3, "unsupported Git index version");
            demand(await this.session.hash(bytes.subarray(0, end)) === bytes.subarray(end).toString("hex"), "Git index checksum mismatch");
            demand(count <= Math.floor((end - 12) / 64), "invalid Git index count");
            this.session.charge("maxEntries", count);
            this.session.reserve(count * 80);
            const entries = [];
            let offset = 12;
            let previous;
            for (let index = 0; index < count; index++) {
                const start = offset;
                demand(offset + 62 <= end, "truncated Git index entry");
                const mode = bytes.readUInt32BE(offset + 24), oid = bytes.subarray(offset + 40, offset + 60).toString("hex"), flags = bytes.readUInt16BE(offset + 60);
                demand(modes.has(mode), "unsupported Git index mode/submodule");
                demand(!(flags & 0x8000), "assume-valid index entries unsupported");
                offset += 62;
                if (flags & 0x4000) {
                    demand(version === 3 && offset + 2 <= end && bytes.readUInt16BE(offset) === 0, "unsupported Git extended index flags");
                    offset += 2;
                }
                const zero = bytes.indexOf(0, offset);
                demand(zero >= offset && zero < end && zero - offset <= GIT_LIMITS.maxPathBytes, "invalid Git index path");
                const encodedLength = flags & 0xfff;
                demand(encodedLength === Math.min(zero - offset, 0xfff), "Git index path length mismatch");
                const path = this.session.text(bytes.subarray(offset, zero));
                objectPath(path);
                const stage = (flags >>> 12) & 3;
                const entry = { path, mode, oid, stage };
                if (previous)
                    demand(compare(previous.path, path) < 0 || previous.path === path && previous.stage > 0 && stage > previous.stage, "unsorted/duplicate/mixed-stage Git index");
                entries.push(entry);
                previous = entry;
                offset = start + Math.ceil((zero - start + 1) / 8) * 8;
                demand(offset <= end && bytes.subarray(zero, offset).every(byte => byte === 0), "invalid Git index padding");
                await this.session.step(offset - start);
            }
            while (offset < end) {
                demand(offset + 8 <= end, "truncated Git index extension");
                const signature = bytes.subarray(offset, offset + 4).toString("ascii"), size = bytes.readUInt32BE(offset + 4);
                demand(/^[A-Z][A-Za-z0-9]{3}$/.test(signature), "unsupported mandatory Git index extension");
                demand(size <= end - offset - 8, "truncated Git index extension body");
                offset += 8 + size;
                await this.session.step(size + 8);
            }
            const paths = new Set(entries.map(entry => entry.path));
            for (const path of paths) {
                let directory = parent(path);
                while (directory !== "." && directory !== "/") {
                    demand(!paths.has(directory), "Git index file/directory collision");
                    directory = parent(directory);
                }
            }
            return this.indexData = entries;
        }
        finally {
            this.session.release(bytes);
        }
    }
    async working(entry) {
        demand(this.root, "bare Git repository has no working files");
        const path = this.session.path(this.root, entry.path);
        let ancestor = this.root;
        for (const name of entry.path.split("/").slice(0, -1)) {
            ancestor = this.session.path(ancestor, name);
            const stat = await this.session.stat(ancestor);
            if (!stat || stat.type === "file")
                return undefined;
            demand(stat.type === "directory", "Git working path ancestor symlink refused");
        }
        await this.session.safe(path, true);
        const stat = await this.session.stat(path);
        if (!stat || stat.type === "directory")
            return undefined;
        this.session.charge("maxEntries", 1);
        let bytes, mode;
        if (stat.type === "symlink") {
            demand(this.session.context.fs.readlink, "Git symlink text unavailable");
            const text = await this.session.call(() => this.session.context.fs.readlink(path, { signal: this.session.operation.signal }));
            demand(Buffer.from(text).toString("utf8") === text && Buffer.byteLength(text) <= GIT_LIMITS.maxWorkingFileBytes, "invalid Git symlink text");
            this.session.charge("maxReadBytes", Buffer.byteLength(text));
            bytes = this.session.copy(Buffer.from(text));
            mode = 0o120000;
        }
        else {
            demand(!this.config.fileMode || this.session.context.fs.capabilities.permissions === true, "Git executable-mode metadata unavailable; core.fileMode=false required");
            bytes = (await this.session.read(path, GIT_LIMITS.maxWorkingFileBytes));
            mode = this.config.fileMode ? stat.mode & 0o111 ? 0o100755 : 0o100644 : entry.mode === 0o120000 ? 0o100644 : entry.mode;
        }
        return { bytes, mode, oid: await this.session.hash(bytes, "blob") };
    }
    async abbreviation(oid) {
        for (let length = 7; length <= 40; length++) {
            const prefix = oid.slice(0, length);
            let matches = 0;
            for (const name of this.names) {
                await this.session.step();
                if (name !== oid && name.startsWith(prefix))
                    matches++;
            }
            if (matches === 0)
                return prefix;
        }
        throw new GitFailure("Git abbreviation census conflict");
    }
}
function identity(value) {
    const split = value.lastIndexOf("> "), bracket = value.lastIndexOf(" <", split);
    demand(bracket > 0 && split > bracket && !/[\x00-\x1f\x7f]/.test(value), "invalid Git identity");
    const parts = value.slice(split + 2).split(" ");
    demand(parts.length === 2 && /^-?(0|[1-9][0-9]{0,15})$/.test(parts[0]) && Number.isSafeInteger(Number(parts[0])), "invalid Git timestamp");
    demand(/^[+-][0-9]{4}$/.test(parts[1]) && Number(parts[1].slice(1, 3)) <= 23 && Number(parts[1].slice(3)) <= 59, "invalid Git timezone");
}
//# sourceMappingURL=repository.js.map