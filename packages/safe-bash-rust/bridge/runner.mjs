import { Buffer } from "node:buffer";
import path from "node:path";
import {
  Shell,
  agentCommands,
  createMemoryFileSystem,
  rsvgConvertCommands,
} from "../../safe-bash/dist/index.js";

async function readAllStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function ensureParentDirs(fs, filePath) {
  const dir = path.posix.dirname(filePath);
  if (dir && dir !== "/") {
    await fs.mkdir(dir, { recursive: true });
  }
}

async function collectFiles(fs, dirPath, out, inspect, emitted = new Set()) {
  // The command has finished. Read the entire result for transfer, including
  // inaccessible entries, while returning their original permission bits.
  const directoryStat = await fs.lstat(dirPath);
  await fs.chmod(dirPath, (directoryStat.mode & 0o7777) | 0o500);
  let entries = [];
  try {
    entries = await fs.readdir(dirPath);
  } catch {
    return;
  }
  for (const entry of entries) {
    const name = typeof entry === "string" ? entry : entry.name;
    const entryType = typeof entry === "string" ? undefined : entry.type;
    const fullPath = dirPath === "/" ? `/${name}` : `${dirPath}/${name}`;
    if (fullPath === "/dev" || fullPath.startsWith("/dev/")) {
      continue;
    }
    let stat;
    try {
      stat = await fs.lstat(fullPath);
    } catch {
      continue;
    }
    const kind = entryType ?? stat?.type;
    const linkGroup = stat.nlink > 1 && kind !== "directory" ? String(stat.ino) : undefined;
    inspect(fullPath, stat, emitted.has(linkGroup));
    if (kind === "directory" || (typeof stat?.isDirectory === "function" && stat.isDirectory())) {
      out.push({
        path: fullPath,
        kind: "directory",
        dataBase64: "",
        mode: stat.mode ?? 0o40755,
      });
      await collectFiles(fs, fullPath, out, inspect, emitted);
    } else if (
      kind === "symlink" ||
      (typeof stat?.isSymbolicLink === "function" && stat.isSymbolicLink())
    ) {
      const target = await fs.readlink(fullPath);
      out.push({
        path: fullPath,
        kind: "symlink",
        linkGroup,
        symlinkTarget:
          typeof target === "string" ? target : Buffer.from(target).toString("utf8"),
        dataBase64: "",
        mode: stat.mode ?? 0o120777,
      });
    } else if (kind === "file" || (typeof stat?.isFile === "function" && stat.isFile())) {
      await fs.chmod(fullPath, (stat.mode & 0o7777) | 0o400);
      const bytes = linkGroup !== undefined && emitted.has(linkGroup) ? undefined : await fs.readFile(fullPath);
      if (linkGroup !== undefined) emitted.add(linkGroup);
      out.push({
        path: fullPath,
        kind: "file",
        linkGroup,
        dataBase64: bytes === undefined ? "" : Buffer.from(bytes).toString("base64"),
        mode: stat.mode ?? 0o100644,
      });
    }
  }
}

async function main() {
  const raw = await readAllStdin();
  const req = JSON.parse(raw);
  const fs = createMemoryFileSystem();

  if (req.cwd && req.cwd !== "/") {
    await fs.mkdir(req.cwd, { recursive: true });
  }

  const linked = new Map();
  for (const entry of req.files ?? []) {
    if (entry.linkGroup !== undefined) {
      if (linked.has(entry.linkGroup)) {
        await ensureParentDirs(fs, entry.path);
        await fs.link(linked.get(entry.linkGroup), entry.path);
        continue;
      }
      linked.set(entry.linkGroup, entry.path);
    }
    if (entry.kind === "directory") {
      await fs.mkdir(entry.path, { recursive: true });
    } else if (entry.kind === "symlink" && typeof entry.symlinkTarget === "string") {
      await ensureParentDirs(fs, entry.path);
      await fs.symlink(entry.symlinkTarget, entry.path);
    } else {
      await ensureParentDirs(fs, entry.path);
      const bytes = Buffer.from(entry.dataBase64 || "", "base64");
      await fs.writeFile(entry.path, new Uint8Array(bytes));
    }
  }
  const imported = new Map(), revisions = new Map();
  // Materialize children before applying restrictive parent permissions.
  for (const entry of [...(req.files ?? [])].sort((left, right) => right.path.length - left.path.length)) {
    if (entry.kind !== "symlink") await fs.chmod(entry.path, entry.mode & 0o7777);
    const stat = await fs.lstat(entry.path);
    imported.set(entry.path, stat.ino);
    revisions.set(stat.ino, stat.revision);
  }

  const shell = new Shell({
    fs,
    cwd: req.cwd || "/",
    env: req.env || {},
  }).use(agentCommands()).use(rsvgConvertCommands());

  // The host explicitly supplies the trusted Pyodide runtime; never use host Python.
  const runtimeModuleURL = process.env.SAFE_BASH_PYODIDE_MODULE_URL;
  if (runtimeModuleURL) {
    const { pythonExecutorCommands } = await import('../../safe-bash/dist/commands/python/executor.js');
    const { createNodePythonWorker } = await import('../../safe-bash/dist/commands/python/node.js');
    shell.use(pythonExecutorCommands({
      createWorker: () => createNodePythonWorker({ runtimeModuleURL, trustedPython: true }),
    }));
  }

  // Preserve Rust's open file descriptions when the command only read the VFS.
  async function changedFiles() {
    const files = [];
    let changed = false;
    await collectFiles(fs, "/", files, (path, stat, alias) => {
      if (imported.get(path) !== stat.ino || (!alias && revisions.get(stat.ino) !== stat.revision)) changed = true;
    });
    return changed || files.length !== imported.size ? files : undefined;
  }
  const session = shell.createSession();
  const controller = new AbortController();
  let timer;
  if (typeof req.timeoutMs === "number" && req.timeoutMs > 0) {
    timer = setTimeout(() => controller.abort(), req.timeoutMs);
  }

  try {
    let result;
    try {
      result = await session.exec(req.script, {
        cwd: req.cwd || "/",
        env: req.env || {},
        stdin: Buffer.from(req.stdinBase64 ?? "", "base64"),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        process.stdout.write(
          JSON.stringify({
            timedOut: true,
            stdout: "",
            stderr: "Command timed out\n",
            exitCode: 124,
            cwd: req.cwd || "/",
            env: req.env || {},
            files: [],
          }),
        );
        return;
      }
      if (typeof err?.exitCode === "number") {
        process.stdout.write(
          JSON.stringify({
            stdout: "",
            stderr: `${err.message || String(err)}\n`,
            exitCode: err.exitCode,
            cwd: req.cwd || "/",
            env: req.env || {},
            files: await changedFiles(),
          }),
        );
        return;
      }
      throw err;
    }

    const state = session.state;
    const nextEnv = {};
    if (state?.variables) {
      for (const [k, v] of Object.entries(state.variables)) {
        nextEnv[k] = String(v);
      }
    } else if (req.env) {
      Object.assign(nextEnv, req.env);
    }

    const response = {
      stdoutBase64: Buffer.from(result.stdoutBytes).toString("base64"),
      stderr: result.stderr ?? "",
      exitCode: result.exitCode,
      cwd: state?.cwd || req.cwd || "/",
      env: nextEnv,
      files: await changedFiles(),
    };
    process.stdout.write(JSON.stringify(response));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

main().catch((err) => {
  process.stderr.write(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
