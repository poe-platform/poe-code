export interface FileEntry {
  path: string;
  name: string;
  kind: "file" | "directory";
  size: number;
}

export interface FileNode extends FileEntry {
  children: FileNode[];
}

export function uploadToastLabel(paths: readonly string[]): { text: string; title: string } | null {
  if (!paths.length) return null;
  const path = paths[0]!;
  const title =
    paths.length === 1 ? path.slice(path.lastIndexOf("/") + 1) : `${paths.length} files uploaded`;
  const characters = Array.from(title);
  const text =
    characters.length > 24
      ? `${characters.slice(0, 13).join("")}…${characters.slice(-10).join("")}`
      : title;
  return { text, title };
}

export class ToastTimer {
  private remaining = 5000;
  private started = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private finished = false;

  constructor(private readonly dismiss: () => void) {
    this.resume();
  }

  pause(): void {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.remaining = Math.max(0, this.remaining - (Date.now() - this.started));
  }

  resume(): void {
    if (this.finished || this.timer !== undefined) return;
    this.started = Date.now();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.finished = true;
      this.dismiss();
    }, this.remaining);
  }

  cancel(): void {
    this.pause();
    this.finished = true;
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / 1024 ** Math.max(0, unit);
  return `${Number(amount.toFixed(unit > 0 ? 1 : 0))} ${units[Math.max(0, unit)]}`;
}

export function labelPath(path: string): string {
  return path === "/home" ? "~" : path.startsWith("/home/") ? `~${path.slice(5)}` : path;
}

export function resolveFilePath(input: string, cwd: string): string {
  if (!input.trim()) throw new Error("Enter a file name.");
  const expanded = input.startsWith("~/") ? `/home/${input.slice(2)}` : input;
  const parts: string[] = [];
  for (const part of (expanded.startsWith("/") ? expanded : `${cwd}/${expanded}`).split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  const path = `/${parts.join("/")}`;
  if (!path.startsWith("/home/")) throw new Error("Choose a file path inside /home.");
  return path;
}

export function uploadError(
  files: readonly { name: string; size: number }[],
  usedBytes: number,
  limits: { maxFileBytes: number; maxTotalBytes: number }
): string | null {
  const oversized = files.find((file) => file.size > limits.maxFileBytes);
  if (oversized)
    return `${oversized.name} exceeds the ${formatBytes(limits.maxFileBytes)} per-file limit.`;
  if (usedBytes + files.reduce((sum, file) => sum + file.size, 0) > limits.maxTotalBytes) {
    return `These files exceed the ${formatBytes(limits.maxTotalBytes)} workspace limit. Delete files or upload fewer files.`;
  }
  return null;
}

export function fileLanguage(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  const languages: Record<string, string> = {
    ts: "TypeScript",
    tsx: "TypeScript",
    js: "JavaScript",
    jsx: "JavaScript",
    mjs: "JavaScript",
    cjs: "JavaScript",
    json: "JSON",
    md: "Markdown",
    sh: "Shell",
    bash: "Shell",
    bashrc: "Shell",
    zshrc: "Shell",
    yaml: "YAML",
    yml: "YAML",
    css: "CSS",
    html: "HTML",
    htm: "HTML",
    csv: "CSV",
    tsv: "TSV",
    py: "Python",
    c: "C",
    go: "Go",
    java: "Java",
    rb: "Ruby",
    rs: "Rust",
    sql: "SQL",
    xml: "XML"
  };
  return Object.hasOwn(languages, extension) ? languages[extension]! : "Plain text";
}

export class CommandHistory {
  private commands: string[] = [];
  private cursor = 0;
  private draft = "";

  record(command: string): void {
    if (command.trim() && this.commands.at(-1) !== command) this.commands.push(command);
    this.resetNavigation();
  }

  resetNavigation(): void {
    this.cursor = this.commands.length;
    this.draft = "";
  }

  previous(input: string): string {
    if (!this.commands.length) return input;
    if (this.cursor === this.commands.length) this.draft = input;
    this.cursor = Math.max(0, this.cursor - 1);
    return this.commands[this.cursor]!;
  }

  next(input: string): string {
    if (this.cursor === this.commands.length) return input;
    this.cursor += 1;
    return this.cursor === this.commands.length ? this.draft : this.commands[this.cursor]!;
  }
}

export class CommandCompletion {
  private revision = 0;
  private cycle: { input: string; candidates: string[]; index: number } | null = null;

  reset(): void {
    this.revision += 1;
    this.cycle = null;
  }

  async next(
    input: string,
    complete: (input: string) => Promise<string[]>
  ): Promise<{ value: string; count: number } | null> {
    const revision = ++this.revision;
    const cycle = this.cycle?.input === input ? this.cycle : null;
    try {
      const candidates = cycle?.candidates ?? (await complete(input));
      if (revision !== this.revision) return null;
      if (!candidates.length) {
        this.cycle = null;
        return { value: input, count: 0 };
      }
      const index = cycle ? (cycle.index + 1) % candidates.length : 0;
      const value = candidates[index]!;
      this.cycle = { input: value, candidates, index };
      return { value, count: candidates.length };
    } catch (error) {
      if (revision !== this.revision) return null;
      throw error;
    }
  }
}

export function buildFileTree(entries: readonly FileEntry[], query = ""): FileNode[] {
  const nodes = new Map<string, FileNode>();
  const ensureDirectory = (path: string): void => {
    if (path === "/home" || nodes.has(path)) return;
    nodes.set(path, {
      path,
      name: path.slice(path.lastIndexOf("/") + 1),
      kind: "directory",
      size: 0,
      children: []
    });
    ensureDirectory(path.slice(0, path.lastIndexOf("/")));
  };
  for (const entry of entries) {
    if (!entry.path.startsWith("/home/")) continue;
    ensureDirectory(entry.path.slice(0, entry.path.lastIndexOf("/")));
    nodes.set(entry.path, { ...entry, children: [] });
  }
  const roots: FileNode[] = [];
  for (const node of nodes.values()) {
    const parent = nodes.get(node.path.slice(0, node.path.lastIndexOf("/")));
    (parent?.children ?? roots).push(node);
  }
  const search = query.trim().toLowerCase();
  const filter = (children: FileNode[]): FileNode[] =>
    children
      .map((node) => ({ ...node, children: filter(node.children) }))
      .filter((node) => !search || node.path.toLowerCase().includes(search) || node.children.length)
      .sort((left, right) => {
        if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
        return left.name.localeCompare(right.name);
      });
  return filter(roots);
}
