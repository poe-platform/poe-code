import { FsError, isFsError, type CommandContext, type FileStat, type WriteFileOptions } from "../../contracts/index.js";
import { pathOf } from "../internal.js";
import { Budget, interruptible } from "./io.js";

interface Entry { readonly path: string; readonly stat: FileStat }

function complete(stat: FileStat): boolean {
  return ((typeof stat.identityScope === "object" && stat.identityScope !== null) || typeof stat.identityScope === "symbol")
    && typeof stat.dev === "number" && Number.isSafeInteger(stat.dev) && stat.dev >= 0
    && typeof stat.ino === "number" && Number.isSafeInteger(stat.ino) && stat.ino >= 0;
}

export class Outputs {
  private input: Entry | undefined;
  private readonly published: Entry[] = [];
  constructor(private readonly context: CommandContext, private readonly budget: Budget) {}

  async prepareInput(name: string): Promise<void> {
    if (name === "-") return;
    const path = pathOf(this.context, name);
    const stat = await this.stat(path);
    if (stat.type === "directory") throw new FsError("EISDIR", { path });
    if (stat.type !== "file") throw new FsError("ENOTSUP", { path, message: "input is not a regular file" });
    this.input = { path, stat };
  }

  private stat(path: string): Promise<FileStat> {
    return interruptible(() => this.context.fs.stat(path, { signal: this.budget.signal }), this.budget.signal);
  }

  private async distinct(previous: Entry, current: Entry): Promise<void> {
    await this.budget.step();
    let relation: "same" | "distinct" | "unknown" = "unknown";
    if (previous.path === current.path) relation = "same";
    else if (complete(previous.stat) && complete(current.stat)) {
      relation = previous.stat.identityScope === current.stat.identityScope && previous.stat.dev === current.stat.dev && previous.stat.ino === current.stat.ino ? "same" : "distinct";
    } else if (this.context.fs.compareEntry) {
      relation = await interruptible(() => this.context.fs.compareEntry!(previous.path, this.context.fs, current.path, { signal: this.budget.signal }), this.budget.signal);
      if (relation !== "same" && relation !== "distinct" && relation !== "unknown") throw new FsError("EIO", { path: current.path, message: "invalid entry comparison answer" });
    }
    if (relation === "unknown") {
      const before = await interruptible(() => this.context.fs.realpath(previous.path, { signal: this.budget.signal }), this.budget.signal);
      const after = await interruptible(() => this.context.fs.realpath(current.path, { signal: this.budget.signal }), this.budget.signal);
      if (before === after) relation = "same";
    }
    if (relation === "same") throw new FsError("EINVAL", { path: current.path, message: previous === this.input ? "output would overwrite input; aborting" : "output aliases an earlier output; aborting" });
    if (relation === "unknown") throw new FsError("ENOTSUP", { path: current.path, message: "cannot establish that existing output is distinct from input or earlier output" });
  }

  private async destination(path: string, links = 0): Promise<{ path: string; stat?: FileStat }> {
    await this.budget.step();
    let entry: FileStat;
    try {
      entry = await interruptible(() => this.context.fs.lstat(path, { signal: this.budget.signal }), this.budget.signal);
    } catch (error) {
      this.budget.signal.throwIfAborted();
      if (isFsError(error, "ENOENT")) return { path };
      throw error;
    }
    if (entry.type !== "symlink") return { path, stat: entry };
    try { return { path, stat: await this.stat(path) }; }
    catch (error) {
      this.budget.signal.throwIfAborted();
      if (!isFsError(error, "ENOENT")) throw error;
    }
    if (!this.context.fs.readlink) throw new FsError("ENOTSUP", { path, message: "cannot resolve dangling output symlink without readlink" });
    if (links >= 40) throw new FsError("ELOOP", { path });
    const target = await interruptible(() => this.context.fs.readlink!(path, { signal: this.budget.signal }), this.budget.signal);
    const parent = target.startsWith("/") ? "" : await interruptible(
      () => this.context.fs.realpath(path.slice(0, path.lastIndexOf("/")) || "/", { signal: this.budget.signal }), this.budget.signal);
    return this.destination(target.startsWith("/") ? target : `${parent.replace(/\/$/u, "")}/${target}`, links + 1);
  }

  async prepare(name: string): Promise<{ path: string; flag: NonNullable<WriteFileOptions["flag"]> }> {
    const { path, stat } = await this.destination(pathOf(this.context, name));
    if (!stat) return { path, flag: "wx" };
    if (stat.type === "directory") throw new FsError("EISDIR", { path });
    if (stat.type !== "file") throw new FsError("ENOTSUP", { path, message: "output is not a regular file" });
    const current = { path, stat };
    if (this.input) await this.distinct(this.input, current);
    for (const previous of this.published) await this.distinct(previous, current);
    return { path, flag: "w" };
  }

  async remember(path: string): Promise<void> {
    this.published.push({ path, stat: await this.stat(path) });
  }
}
