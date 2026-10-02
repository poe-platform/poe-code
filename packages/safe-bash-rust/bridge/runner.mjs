import { Buffer } from "node:buffer";
import path from "node:path";
import {
  Shell,
  agentCommands,
  createMemoryFileSystem,
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

async function collectFiles(fs, dirPath, out) {
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
    if (kind === "directory" || (typeof stat?.isDirectory === "function" && stat.isDirectory())) {
      out.push({
        path: fullPath,
        kind: "directory",
        dataBase64: "",
        mode: stat.mode ?? 0o40755,
      });
      await collectFiles(fs, fullPath, out);
    } else if (
      kind === "symlink" ||
      (typeof stat?.isSymbolicLink === "function" && stat.isSymbolicLink())
    ) {
      const target = await fs.readlink(fullPath);
      out.push({
        path: fullPath,
        kind: "symlink",
        symlinkTarget:
          typeof target === "string" ? target : Buffer.from(target).toString("utf8"),
        dataBase64: "",
        mode: stat.mode ?? 0o120777,
      });
    } else if (kind === "file" || (typeof stat?.isFile === "function" && stat.isFile())) {
      const bytes = await fs.readFile(fullPath);
      out.push({
        path: fullPath,
        kind: "file",
        dataBase64: Buffer.from(bytes).toString("base64"),
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

  for (const entry of req.files ?? []) {
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

  const shell = new Shell({
    fs,
    cwd: req.cwd || "/",
    env: req.env || {},
  }).use(agentCommands());

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
        stdin: req.stdin ?? "",
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
        const files = [];
        await collectFiles(fs, "/", files);
        process.stdout.write(
          JSON.stringify({
            stdout: "",
            stderr: `${err.message || String(err)}\n`,
            exitCode: err.exitCode,
            cwd: req.cwd || "/",
            env: req.env || {},
            files,
          }),
        );
        return;
      }
      throw err;
    }

    const files = [];
    await collectFiles(fs, "/", files);

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
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.exitCode,
      cwd: state?.cwd || req.cwd || "/",
      env: nextEnv,
      files,
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
