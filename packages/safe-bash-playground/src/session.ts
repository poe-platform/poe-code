import { Shell, browserCommands, browserLimits, createMemoryFileSystem } from "./engine/index.js";
import type { FileSystem } from "./engine/index.js";
import { sampleFiles } from "./samples.js";

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_WORKSPACE_BYTES = 16 * 1024 * 1024;
export const SESSION_LIMITS = Object.freeze({
  maxFileBytes: MAX_FILE_BYTES,
  maxTotalBytes: MAX_WORKSPACE_BYTES
});
const shellBuiltins =
  ": true false pwd cd set shift export local unset read exit return break continue command builtin type readonly . source eval getopts let pushd dirs popd shopt".split(
    " "
  );

export interface FileEntry {
  path: string;
  name: string;
  kind: "file" | "directory";
  size: number;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface PlaygroundSession {
  readonly cwd: string;
  run(command: string): Promise<RunResult>;
  entries(): Promise<FileEntry[]>;
  readFile(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  writeFile(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
  isBinary(path: string): Promise<boolean>;
  upload(files: { name: string; data: Uint8Array }[]): Promise<string[]>;
  complete(input: string): Promise<string[]>;
}

function hasControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0)!;
    return code < 32 || (code >= 127 && code <= 159);
  });
}

function resolvePath(cwd: string, input: string): string {
  if (!input || hasControl(input)) throw new Error("Invalid file path");
  const expanded =
    input === "~" ? "/home" : input.startsWith("~/") ? `/home/${input.slice(2)}` : input;
  const parts: string[] = [];
  for (const part of (expanded.startsWith("/") ? expanded : `${cwd}/${expanded}`).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

function uploadName(input: string): string {
  const basename = input.split("\\").join("/").split("/").at(-1) ?? "";
  const cleaned = Array.from(basename)
    .filter((character) => !hasControl(character))
    .join("")
    .trim();
  return !cleaned || cleaned === "." || cleaned === ".." ? "upload" : cleaned;
}

function checkFileSize(size: number): void {
  if (size > MAX_FILE_BYTES) throw new Error("Files must not exceed 2 MiB");
}

function completionToken(input: string) {
  let start = 0;
  let value = "";
  let quote = "";
  let openingQuote = "";
  let escaped = false;
  let commandPosition = true;
  for (let index = 0; index < input.length; index++) {
    const character = input[index]!;
    if (escaped) {
      value += character;
      escaped = false;
    } else if (character === "\\" && quote !== "'") {
      if (quote === '"' && !'\\"$`\n'.includes(input[index + 1] ?? "")) value += character;
      else escaped = true;
    } else if (quote) {
      if (character === quote) quote = "";
      else value += character;
    } else if (character === "'" || character === '"') {
      quote = character;
      if (index === start) openingQuote = character;
    } else if (character.trim() === "" || ";|&<>()".includes(character)) {
      if (value) commandPosition = false;
      if (";|&()\n".includes(character)) commandPosition = true;
      if ("<>".includes(character)) commandPosition = false;
      start = index + 1;
      value = "";
      openingQuote = "";
    } else {
      value += character;
    }
  }
  return { start, value, quote: openingQuote, commandPosition };
}

function quoteCompletion(value: string, quote: string): string {
  if (quote === "'") return `'${value.split("'").join("'\\''")}'`;
  if (quote === '"') {
    return `"${Array.from(value)
      .map((character) => ('\\"$`'.includes(character) ? `\\${character}` : character))
      .join("")}"`;
  }
  return Array.from(value)
    .map((character) =>
      character.trim() === "" || "\\'\"$`;|&<>(){}[]*?!#".includes(character)
        ? `\\${character}`
        : character
    )
    .join("");
}

export async function createSession(): Promise<PlaygroundSession> {
  const fs = createMemoryFileSystem();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  let cwd = "/home";
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const result = queue.then(operation);
    queue = result.catch(() => undefined);
    return result;
  };
  for (const directory of ["/home", "/home/examples", "/home/data", "/home/uploads"]) {
    await fs.mkdir(directory, { recursive: true });
  }
  for (const [path, text] of Object.entries(sampleFiles))
    await fs.writeFile(path, encoder.encode(text));

  let mutationQueue: Promise<unknown> = Promise.resolve();
  const mutate = (operation: () => Promise<void>): Promise<void> => {
    const result = mutationQueue.then(operation);
    mutationQueue = result.catch(() => undefined);
    return result;
  };
  async function checkCapacity(path: string, size: number, append = false): Promise<void> {
    let previousSize = 0;
    let links = 1;
    try {
      const stat = await fs.stat(path);
      previousSize = stat.type === "file" ? stat.size : 0;
      links = stat.nlink ?? 1;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }
    const total = (await entries()).reduce((sum, entry) => sum + entry.size, 0);
    if (total + (append ? size : size - previousSize) * links > MAX_WORKSPACE_BYTES) {
      throw new Error("Workspace must not exceed 16 MiB");
    }
  }
  const mutations: Partial<FileSystem> = {
    writeFile(path, data, options) {
      return mutate(async () => {
        await checkCapacity(path, data.length, options?.flag === "a" || options?.flag === "ax");
        await fs.writeFile(path, data, options);
      });
    },
    appendFile(path, data, options) {
      return mutate(async () => {
        await checkCapacity(path, data.length, true);
        await fs.appendFile(path, data, options);
      });
    },
    copyFile(source, destination, options) {
      return mutate(async () => {
        await checkCapacity(destination, (await fs.stat(source)).size);
        await fs.copyFile(source, destination, options);
      });
    },
    truncate(path, length = 0, options) {
      return mutate(async () => {
        await checkCapacity(path, length);
        await fs.truncate!(path, length, options);
      });
    },
    link(source, destination, options) {
      return mutate(async () => {
        await checkCapacity(destination, (await fs.stat(source)).size);
        await fs.link!(source, destination, options);
      });
    },
    symlink(target, path, options) {
      return mutate(async () => {
        await checkCapacity(path, encoder.encode(target).length);
        await fs.symlink!(target, path, options);
      });
    },
    async writeStream(path, source, options) {
      await guardedFs.writeFile(path, new Uint8Array(), options);
      for await (const chunk of source) await guardedFs.appendFile(path, chunk, options);
    }
  };
  const guardedFs: FileSystem = new Proxy(fs, {
    get(target, property) {
      const replacement = Reflect.get(mutations, property);
      if (replacement) return replacement;
      const original = Reflect.get(target, property);
      return typeof original === "function" ? original.bind(target) : original;
    }
  });
  const shell = new Shell({
    fs: guardedFs,
    cwd,
    env: { HOME: "/home" },
    limits: browserLimits
  }).use(browserCommands());
  shell.register({
    name: "help",
    description: "Show playground commands, examples, and resource limits",
    async execute(context) {
      const commands = shell.commands
        .list()
        .map((command) => command.name)
        .filter((name) => name !== "help")
        .sort();
      const tasks = sampleFiles["/home/WELCOME.md"]!.split("\n")
        .filter((line) => line.startsWith("  "))
        .join("\n");
      await context.stdout.write(
        encoder.encode(`Safe Bash playground

Engine / Registered commands:
${commands.join(" ")}

Shell builtins:
${shellBuiltins.join(" ")}
Shell script interpreters: sh, bash.
Pipelines, redirection, substitutions, functions, and loops use the real shell.

Playground command:
  help — this reference; supports pipelines and redirection.

UI-only controls:
  clear — clear output when entered alone (not a pipeline command).
  Reset button — restore the workspace; Upload/Download buttons — transfer files.
  Tab — completion; Up/Down — history; Ctrl/Cmd+L — clear output.

Try:
  cd /home
${tasks}
  bash examples/hello.sh

Limits:
  Uploaded/edited files: ${MAX_FILE_BYTES / 1024 ** 2} MiB each (UTF-8 bytes for text).
  Workspace: ${MAX_WORKSPACE_BYTES / 1024 ** 2} MiB logical file bytes, including shell writes.
  Shell files may exceed the upload/edit limit within the workspace budget.
  Output: ${browserLimits.maxOutputBytes! / 1024} KiB; source: ${browserLimits.maxSourceBytes! / 1024} KiB.
  Commands: ${browserLimits.maxCommands}; loop iterations: ${browserLimits.maxLoopIterations}.
  A 5-second timeout requests cooperative cancellation, not a hard CPU/heap limit.

Cwd and files persist between commands; variables and functions do not.
Uploads are saved under /home/uploads. Reload/Reset discards the workspace.
Download anything you want to keep. Tab completes commands and paths.
Python, Node.js, TypeScript, Rust, Go, C, Ruby, and Java runtimes are not installed.
All ${commands.length} agent commands are available, including grep, rg, sed, awk, jq, and find.
Regex searches and [[ =~ ]] run in Web Workers. Network/OS commands remain unavailable.
`)
      );
      return { exitCode: 0 };
    }
  });

  async function entries(): Promise<FileEntry[]> {
    const result: FileEntry[] = [];
    const pending = ["/"];
    while (pending.length) {
      const directory = pending.pop()!;
      for (const entry of await fs.readdir(directory)) {
        const path = `${directory === "/" ? "" : directory}/${entry.name}`;
        const stat = await fs.lstat(path);
        const kind = stat.type === "directory" ? "directory" : "file";
        result.push({ path, name: entry.name, kind, size: kind === "directory" ? 0 : stat.size });
        if (kind === "directory") pending.push(path);
      }
    }
    return result.sort((left, right) => left.path.localeCompare(right.path));
  }

  async function recoverCwd(): Promise<void> {
    while (cwd !== "/") {
      try {
        if ((await fs.stat(cwd)).type === "directory") return;
      } catch {
        cwd = resolvePath(cwd, "..");
        continue;
      }
      cwd = resolvePath(cwd, "..");
    }
  }

  const session: PlaygroundSession = {
    get cwd() {
      return cwd;
    },
    run(command) {
      return serial(async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
          const result = await shell.exec(command, {
            cwd,
            signal: controller.signal,
            onState(state) {
              cwd = state.cwd;
            }
          });
          return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
        } catch (error) {
          return {
            stdout: "",
            stderr: `${error instanceof Error ? error.message : String(error)}\n`,
            exitCode: controller.signal.aborted ? 124 : 1
          };
        } finally {
          clearTimeout(timeout);
          await recoverCwd();
        }
      });
    },
    entries,
    async readFile(path) {
      return decoder.decode(await fs.readFile(resolvePath(cwd, path)));
    },
    async readBytes(path) {
      return (await fs.readFile(resolvePath(cwd, path))).slice();
    },
    writeFile(path, text) {
      return serial(async () => {
        let resolved = resolvePath(cwd, path);
        const data = encoder.encode(text);
        checkFileSize(data.length);
        try {
          resolved = await fs.realpath(resolved);
        } catch (error) {
          if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT")
            throw error;
        }
        await checkCapacity(resolved, data.length);
        await fs.writeFile(resolved, data);
      });
    },
    remove(path) {
      return serial(async () => {
        const resolved = resolvePath(cwd, path);
        if (resolved === "/" || resolved === "/home") {
          throw new Error("Cannot remove the workspace root");
        }
        await fs.rm(resolved, { recursive: true });
        await recoverCwd();
      });
    },
    async isBinary(path) {
      const data = await fs.readFile(resolvePath(cwd, path));
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(data);
      } catch {
        return true;
      }
      return data.some((byte) => byte === 0 || byte < 9 || (byte > 13 && byte < 32));
    },
    async upload(files) {
      let incomingBytes = 0;
      for (const file of files) {
        checkFileSize(file.data.length);
        incomingBytes += file.data.length;
      }
      if (incomingBytes > MAX_WORKSPACE_BYTES) throw new Error("Workspace must not exceed 16 MiB");
      const incoming = files.map((file) => ({
        name: uploadName(file.name),
        data: file.data.slice()
      }));
      return serial(async () => {
        const current = await entries();
        const directory = current.find((entry) => entry.path === "/home/uploads");
        if (
          (directory && directory.kind !== "directory") ||
          (await fs.realpath("/home")) !== "/home"
        ) {
          throw new Error("Uploads require a real /home/uploads directory");
        }
        let total = current.reduce((sum, entry) => sum + entry.size, 0);
        const occupied = new Set(current.map((entry) => entry.path));
        const prepared = incoming.map(({ name, data }) => {
          checkFileSize(data.length);
          total += data.length;
          if (total > MAX_WORKSPACE_BYTES) throw new Error("Workspace must not exceed 16 MiB");
          const dot = name.lastIndexOf(".");
          const stem = dot > 0 ? name.slice(0, dot) : name;
          const extension = dot > 0 ? name.slice(dot) : "";
          let path = `/home/uploads/${name}`;
          for (let suffix = 2; occupied.has(path); suffix++)
            path = `/home/uploads/${stem}-${suffix}${extension}`;
          occupied.add(path);
          return { path, data };
        });
        if (!prepared.length) return [];
        await fs.mkdir("/home/uploads", { recursive: true });
        const created: string[] = [];
        try {
          for (const file of prepared) {
            await fs.writeFile(file.path, file.data, { flag: "wx" });
            created.push(file.path);
          }
        } catch (error) {
          for (const path of created) await fs.rm(path);
          throw error;
        }
        return created;
      });
    },
    async complete(input) {
      const token = completionToken(input);
      const prefix = input.slice(0, token.start);
      const candidates = new Set<string>();
      if (token.commandPosition && !token.value.includes("/")) {
        for (const command of [
          ...shell.commands.list().map((command) => command.name),
          ...shellBuiltins,
          "sh",
          "bash"
        ]) {
          if (command.startsWith(token.value)) candidates.add(prefix + command);
        }
      }
      const slash = token.value.lastIndexOf("/");
      const directory = slash < 0 ? "" : token.value.slice(0, slash + 1);
      const name = token.value.slice(slash + 1);
      try {
        const resolved = resolvePath(cwd, directory || ".");
        for (const entry of await fs.readdir(resolved)) {
          if (!entry.name.startsWith(name) || (name === "" && entry.name.startsWith("."))) continue;
          const value = directory + entry.name + (entry.type === "directory" ? "/" : "");
          candidates.add(prefix + quoteCompletion(value, token.quote));
        }
      } catch {
        return [...candidates].sort();
      }
      return [...candidates].sort();
    }
  };
  return session;
}
