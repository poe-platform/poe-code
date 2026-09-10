import { FsError, dirname, resolvePath, type FileStat, type FileSystem } from "../../contracts/index.js";
import { writeFileOutput } from "../../contracts/filesystem-output.js";
import { retainFileSystemCleanup } from "poe-code/safe-fs/core";
import { LineEndingError, missing, sameIdentity, type ConversionOptions } from "./internal.js";
import { Lifecycle } from "./io.js";

export class Files {
  constructor(readonly life: Lifecycle) {}
  async call<Arguments extends unknown[], Value>(select: (fs: FileSystem) => (...args: Arguments) => Value, args: Arguments): Promise<Awaited<Value>> {
    return await this.life.operation(async () => {
      const fs = this.life.budget.context.fs;
      this.life.assertOpen();
      const method = select(fs);
      this.life.assertOpen();
      return await (Reflect.apply(method, fs, args) as Value);
    });
  }
  async stat(path: string): Promise<FileStat | undefined> {
    try { return await this.call(fs => fs.lstat, [path, { signal: this.life.budget.signal }]); }
    catch (error) { this.life.assertOpen(); if (missing(error)) return undefined; throw error; }
  }
  path(name: string): string {
    const path = resolvePath(this.life.budget.context.cwd, name);
    this.life.budget.check(path.length * 3, this.life.budget.limits.maxPathBytes, "path bytes");
    this.life.budget.check(path.split("/").length - 1, this.life.budget.limits.maxDepth, "path depth");
    return path;
  }
  async parents(path: string): Promise<{ path: string; stat: FileStat }[]> {
    const parents: { path: string; stat: FileStat }[] = [];
    let current = "/";
    for (const component of ["", ...dirname(path).split("/").filter(Boolean)]) {
      if (component) current = resolvePath(current, component);
      const stat = await this.stat(current);
      if (!stat) throw new FsError("ENOENT", { path: current });
      if (stat.type !== "directory" || !sameIdentity(stat, stat)) throw new LineEndingError("output requires stable non-symlink directory identities");
      parents.push({ path: current, stat });
    }
    return parents;
  }
}

export class Stage {
  private temporary = "";
  private identity: FileStat | undefined;
  private created = false;
  private parents: { path: string; stat: FileStat }[] = [];
  readonly cleanup: () => Promise<void>;
  constructor(readonly files: Files, readonly path: string, readonly expected: FileStat | undefined) {
    const { life } = files;
    life.assertOpen();
    this.cleanup = retainFileSystemCleanup(life.budget.context.fs, async view => {
      if (!this.created || !this.identity) return;
      try {
        for (const parent of this.parents) {
          const stat = await view.lstat(parent.path);
          if (stat.type !== "directory" || !sameIdentity(stat, parent.stat)) return;
        }
        const stat = await view.lstat(this.temporary);
        if (stat.type === "file" && sameIdentity(stat, this.identity)) await view.rm(this.temporary);
      } catch (error) { if (!missing(error)) throw error; }
    }, { maxOperations: Math.min(4096, life.budget.limits.maxDepth + 4) });
    life.cleanup(this.cleanup);
  }
  async open(): Promise<void> {
    const { life } = this.files;
    const { signal, limits } = life.budget;
    const capabilities = await life.operation(async () => {
      const fs = life.budget.context.fs;
      const query = fs.capabilitiesFor;
      life.assertOpen();
      const result = query ? await Reflect.apply(query, fs, [this.path, { signal, create: true }]) : fs.capabilities;
      life.assertOpen();
      return result;
    });
    if (capabilities.atomicRename !== true || capabilities.exclusiveCreate !== true || capabilities.permissions !== true || capabilities.append === false || capabilities.remove === false) {
      throw new LineEndingError("file conversion requires atomic rename, exclusive create, permissions, append and cleanup capabilities");
    }
    this.parents = await this.files.parents(this.path);
    for (let attempt = 0; attempt < limits.maxTempAttempts; attempt++) {
      this.temporary = resolvePath(dirname(this.path), `.line-ending-${attempt + 1}`);
      this.files.path(this.temporary);
      if (this.temporary === this.path || await this.files.stat(this.temporary)) continue;
      try {
        await this.files.call(fs => fs.writeFile, [this.temporary, new Uint8Array(), { signal, flag: "wx", mode: 0o600 }]);
      } catch (error) {
        life.assertOpen();
        if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") continue;
        throw error;
      }
      this.created = true;
      this.identity = await this.files.stat(this.temporary);
      if (!this.identity || this.identity.type !== "file" || !sameIdentity(this.identity, this.identity)) throw new LineEndingError("temporary file identity unavailable; unowned path is not removed");
      return;
    }
    throw new LineEndingError("temporary file attempts limit exceeded");
  }
  private async checked(): Promise<void> {
    for (const parent of this.parents) {
      const stat = await this.files.stat(parent.path);
      if (!stat || stat.type !== "directory" || !sameIdentity(stat, parent.stat)) throw new LineEndingError("output parent changed before mutation");
    }
    const stat = await this.files.stat(this.temporary);
    if (!this.identity || !stat || stat.type !== "file" || !sameIdentity(stat, this.identity)) throw new LineEndingError("temporary file changed before mutation");
  }
  async append(bytes: Uint8Array): Promise<void> {
    await this.checked();
    const { context, signal } = this.files.life.budget;
    await this.files.life.operation(() => writeFileOutput({ signal, ...(context.registerCleanup ? { registerCleanup: context.registerCleanup } : {}) }, bytes,
      async chunk => { await this.files.call(fs => fs.appendFile, [this.temporary, chunk, { signal }]); }));
  }
  async publish(input: FileStat, options: ConversionOptions): Promise<void> {
    const { signal } = this.files.life.budget;
    await this.checked();
    if (!options.newFile && ((input.uid !== undefined && input.uid !== this.identity!.uid) || (input.gid !== undefined && input.gid !== this.identity!.gid))) {
      throw new LineEndingError("filesystem cannot preserve input user/group ownership");
    }
    await this.files.call(fs => fs.chmod!, [this.temporary, (input.mode & 0o777) & (options.newFile ? ~0o022 : 0o777), { signal }]);
    if (options.keepDate) {
      await this.checked();
      await this.files.call(fs => fs.utimes!, [this.temporary, Math.floor(input.atimeMs / 1000) * 1000, Math.floor(input.mtimeMs / 1000) * 1000, { signal }]);
    }
    await this.checked();
    const current = await this.files.stat(this.path);
    if (current ? !this.expected || current.type !== "file" || !sameIdentity(current, this.expected) : this.expected !== undefined) throw new LineEndingError("destination changed before publication");
    await this.files.call(fs => fs.rename, [this.temporary, this.path, { signal }]);
    this.created = false;
  }
}
