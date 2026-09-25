import { FsError, createOutputOperation, type CommandDefinition, type DirectoryEntry, type FileStat, type OutputOperation } from "../../contracts/index.js";
import { pathOf } from "../internal.js";
import { PublicDiagnostic } from "../../diagnostics.js";
import { parse, helpText, type Arguments } from "./arguments.js";
import { Budget, DuLimitError } from "./budget.js";
import { formatSize } from "./format.js";
import { settings, type DuCommandsOptions } from "./options.js";
import { excluded } from "./exclude.js";
import { gnuInformation } from "../gnu-information.js";

interface Amount { readonly bytes: number; readonly complete: boolean; readonly directory?: boolean }

class Walker {
  private readonly seen = new Map<object | symbol, Map<number, Set<number>>>();
  private readonly ancestors: FileStat[] = [];
  private readonly exclusions: string[];
  private root: FileStat | undefined;
  failed = false;

  constructor(private readonly budget: Budget, private readonly args: Arguments) {
    this.exclusions = [...args.exclusions];
  }

  private duplicate(stat: FileStat): boolean {
    if (this.args.countLinks || stat.type === "directory") return false;
    const { identityScope: scope, dev, ino } = stat;
    if ((typeof scope !== "object" || scope === null) && typeof scope !== "symbol") return false;
    if (dev === undefined || ino === undefined || !Number.isSafeInteger(dev) || dev < 0 || !Number.isSafeInteger(ino) || ino < 0) return false;
    let devices = this.seen.get(scope);
    if (!devices) { devices = new Map(); this.seen.set(scope, devices); }
    let inodes = devices.get(dev);
    if (!inodes) { inodes = new Set(); devices.set(dev, inodes); }
    if (inodes.has(ino)) return true;
    inodes.add(ino);
    return false;
  }

  private async failure(error: unknown, display?: string): Promise<void> {
    this.budget.active(this.budget.caller.signal);
    if (this.budget.context.signal.aborted || error instanceof DuLimitError) throw error;
    this.failed = true;
    await this.budget.diagnostic(error, display);
  }

  private async add(left: Amount, right: Amount, display: string): Promise<Amount> {
    this.budget.step();
    if (right.bytes > Number.MAX_SAFE_INTEGER - left.bytes) {
      await this.failure(new PublicDiagnostic("aggregate exceeds safe integer range; total suppressed"), display);
      return { bytes: left.bytes, complete: false };
    }
    return { bytes: left.bytes + right.bytes, complete: left.complete && right.complete };
  }

  private async report(amount: Amount, display: string): Promise<void> {
    if (!amount.complete) return;
    if (this.args.threshold >= 0 ? amount.bytes < this.args.threshold : amount.bytes > -this.args.threshold) return;
    this.budget.step(display.length + 1);
    await this.budget.emit(this.budget.context.stdout, `${this.args.inodes ? amount.bytes : formatSize(amount.bytes, this.args.format)}\t${display}${this.args.nullOutput ? "\0" : "\n"}`);
  }

  private async children(path: string, display: string): Promise<DirectoryEntry[] | undefined> {
    const { context, limits } = this.budget;
    let entries: DirectoryEntry[];
    const maxEntries = Math.min(limits.maxDirectoryEntries, this.budget.remainingEntries);
    try { entries = await this.budget.fs(() => context.fs.readdir(path, { signal: context.signal,
      ...(Number.isFinite(maxEntries) ? { maxEntries } : {}) })); }
    catch (error) {
      if (error instanceof FsError && error.code === "EFBIG") {
        await this.failure(new DuLimitError(maxEntries === limits.maxDirectoryEntries ? "directory entry" : "entry"), display);
      }
      await this.failure(error, display); return undefined;
    }
    if (!Array.isArray(entries)) { await this.failure(new PublicDiagnostic("invalid directory listing"), display); return undefined; }
    this.budget.check(entries.length, limits.maxDirectoryEntries, "directory entry");
    this.budget.check(entries.length, this.budget.remainingEntries, "entry");
    const names = new Set<string>();
    for (const entry of entries) {
      this.budget.step();
      if (!entry || typeof entry.name !== "string") { await this.failure(new PublicDiagnostic("invalid directory entry"), display); return undefined; }
      this.budget.text(entry.name);
      if (!entry.name || entry.name === "." || entry.name === ".." || /[\/\0]/u.test(entry.name) || names.has(entry.name)) {
        await this.failure(new PublicDiagnostic("invalid or duplicate directory entry name"), display); return undefined;
      }
      names.add(entry.name);
    }
    return entries.slice().sort((left, right) => {
      this.budget.step(1 + Math.min(left.name.length, right.name.length));
      return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
    });
  }

  async walk(path: string, display: string, depth: number): Promise<Amount> {
    const { context, limits } = this.budget;
    this.budget.check(depth, limits.maxDepth, "depth");
    this.budget.entry();
    this.budget.text(path);
    this.budget.text(display);
    if (display === "") {
      await this.failure(new PublicDiagnostic("invalid zero-length file name"));
      return { bytes: 0, complete: false };
    }
    for (const pattern of this.exclusions) {
      if (excluded(pattern, display, this.budget)) return { bytes: 0, complete: true };
    }
    let stat: FileStat;
    try {
      stat = await this.budget.fs(() => context.fs.lstat(path, { signal: context.signal }));
      const following = stat.type === "symlink" && (this.args.dereference === "all" || this.args.dereference === "args" && depth === 0);
      if (following) {
        stat = await this.budget.fs(() => context.fs.stat(path, { signal: context.signal }));
      }
      if (!stat || !["file", "directory", "symlink", "character"].includes(stat.type)) throw new PublicDiagnostic("invalid entry type");
      if (depth === 0) this.root = stat;
      if (this.args.oneFileSystem && stat.type === "directory") {
        const root = this.root!;
        const validScope = (scope: FileStat["identityScope"]) => typeof scope === "symbol" || typeof scope === "object" && scope !== null;
        if (stat.dev === undefined || root.dev === undefined || !Number.isSafeInteger(stat.dev) || stat.dev < 0 || !Number.isSafeInteger(root.dev) || root.dev < 0 || !validScope(stat.identityScope) || !validScope(root.identityScope)) throw new PublicDiagnostic("device identity unknown; cannot restrict traversal to one filesystem");
        if (depth > 0 && (stat.identityScope !== root.identityScope || stat.dev !== root.dev)) return { bytes: 0, complete: true };
      }
      if (following && stat.type === "directory" && this.ancestors.some(parent => {
        this.budget.step();
        return (typeof stat.identityScope === "symbol" || typeof stat.identityScope === "object" && stat.identityScope !== null) && stat.identityScope === parent.identityScope && stat.dev !== undefined && Number.isSafeInteger(stat.dev) && stat.dev >= 0 && stat.dev === parent.dev && stat.ino !== undefined && Number.isSafeInteger(stat.ino) && stat.ino >= 0 && stat.ino === parent.ino;
      })) throw new PublicDiagnostic("directory cycle detected");
    } catch (error) { await this.failure(error, display); return { bytes: 0, complete: false }; }
    const bytes = this.args.inodes ? 1 : this.args.apparent ? stat.type === "directory" ? 0 : stat.size : stat.allocatedBytes;
    let amount: Amount;
    if (bytes === undefined || !Number.isSafeInteger(bytes) || bytes < 0) {
      await this.failure(new PublicDiagnostic(`${this.args.apparent ? "apparent size" : "allocated bytes"} ${bytes === undefined ? "unknown" : "invalid"}; total suppressed`), display);
      amount = { bytes: 0, complete: false };
    } else amount = { bytes, complete: true };
    if (this.duplicate(stat)) return { bytes: 0, complete: amount.complete };
    let own = amount;
    if (stat.type === "directory") {
      this.ancestors.push(stat);
      const entries = await this.children(path, display);
      if (entries === undefined) {
        amount = { ...amount, complete: false };
        own = { ...own, complete: false };
      }
      else for (const entry of entries) {
        this.budget.step();
        const suffix = display.endsWith("/") ? "" : "/";
        this.budget.check(path.length + entry.name.length + 1, limits.maxPathBytes, "path/name");
        this.budget.check(display.length + suffix.length + entry.name.length, limits.maxPathBytes, "path/name");
        const childPath = `${path.endsWith("/") ? path : path + "/"}${entry.name}`;
        const child = await this.walk(childPath, display + suffix + entry.name, depth + 1);
        amount = await this.add(amount, child, display);
        if (this.args.separate && !child.directory) own = await this.add(own, child, display);
      }
      this.ancestors.pop();
    }
    if (depth === 0 || (depth <= this.args.depth && (stat.type === "directory" || this.args.all))) await this.report(this.args.separate ? own : amount, display);
    return { ...amount, directory: stat.type === "directory" };
  }

  async run(): Promise<void> {
    let total: Amount = { bytes: 0, complete: true };
    const { context } = this.budget;
    for (const file of this.args.excludeFiles) {
      const path = pathOf(context, file);
      this.budget.text(path);
      const bytes = await this.budget.fs(() => context.fs.readFile(path, { signal: context.signal, ...(Number.isFinite(this.budget.limits.maxArgumentBytes) ? { maxBytes: this.budget.limits.maxArgumentBytes } : {}) }));
      this.budget.check(bytes.length, this.budget.limits.maxArgumentBytes, "exclusion file bytes");
      const text = new TextDecoder().decode(bytes);
      this.budget.step(text.length + 1);
      const patterns = text.split("\n");
      if (patterns.at(-1) === "") patterns.pop();
      for (const pattern of patterns) { this.budget.text(pattern); this.exclusions.push(pattern); }
    }
    this.budget.text(context.cwd);
    const paths = this.args.operands.map(operand => {
      const path = pathOf(context, operand === "" ? "." : operand);
      this.budget.text(path);
      return path;
    });
    for (let index = 0; index < paths.length; index++) {
      const amount = await this.walk(paths[index]!, this.args.operands[index]!, 0);
      if (this.args.total) total = await this.add(total, amount, "total");
    }
    if (this.args.total) await this.report(total, "total");
  }
}

export function createDuCommand(options: DuCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return { name: "du", description: "Bounded provider allocation or explicit apparent-size usage", async execute(context) {
    let operation: OutputOperation | undefined;
    const work = { ...context, get signal() { return operation?.signal ?? context.signal; }, get stdout() { return operation?.output ?? context.stdout; } };
    const budget = new Budget(work, limits, context);
    context.registerCleanup?.(budget.close);
    try {
      const infoPromise = gnuInformation("du", context);
      if (infoPromise) {
        const info = await infoPromise;
        if (info) return info;
      }
      const args = parse(budget);
      if (context.stdout.ownedOutput) operation = createOutputOperation(context, context.stdout);
      if (args.help) { await budget.emit(work.stdout, helpText); return { exitCode: 0 }; }
      const walker = new Walker(budget, args);
      await walker.run();
      return { exitCode: walker.failed ? 1 : 0 };
    } catch (error) {
      context.signal.throwIfAborted();
      if (operation?.signal.aborted && error === operation.signal.reason) throw error;
      budget.active(context.signal);
      try { await budget.diagnostic(error); }
      catch (diagnosticError) {
        budget.active(context.signal);
        if (!(diagnosticError instanceof DuLimitError)) throw diagnosticError;
      }
      return { exitCode: 1 };
    } finally {
      try { await budget.close(); }
      finally { await operation?.close(); }
      context.signal.throwIfAborted();
    }
  } };
}
