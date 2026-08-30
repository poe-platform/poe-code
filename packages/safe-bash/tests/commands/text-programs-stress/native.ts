import { spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TextCase } from "./cases.js";
import type { Execution, Observation } from "./model.js";

export async function native(fixture: TextCase, sedExecutable = "/usr/bin/sed"): Promise<Execution> {
  const started = performance.now();
  const root = await realpath(await mkdtemp(join(tmpdir(), "virtual-text-independent-")));
  try {
    for (const [path, content] of Object.entries(fixture.files ?? {})) {
      if (!path || path.startsWith("/") || path.includes("\0") || path.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Unsafe fixture path");
      await mkdir(dirname(join(root, path)), { recursive: true, mode: 0o755 });
      await writeFile(join(root, path), Buffer.from(content, "base64"), { mode: 0o644 });
    }
    const command = "/bin/bash";
    if (!sedExecutable.startsWith("/") || sedExecutable.includes("\0")) throw new Error("Native sed executable must be an absolute path without NUL");
    const executable = fixture.tool === "sed" ? sedExecutable : "/usr/bin/awk";
    const program = fixture.tool === "pipeline" ? fixture.script! : 'exec "$@"';
    const args = ["--noprofile", "--norc", "-c", `umask 0; ${program}`, "independent-text-oracle", ...(fixture.tool === "pipeline" ? [] : [executable]), ...fixture.args];
    const output = await new Promise<{ exitCode: number; stdout: Buffer; stderr: Buffer }>((resolve, reject) => {
      const child = spawn(command, args, { cwd: root, detached: true, stdio: ["pipe", "pipe", "pipe"],
        env: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC", HOME: root, TMPDIR: root } });
      let failure: Error | undefined;
      let size = 0;
      const buffers: Record<"stdout" | "stderr", Buffer[]> = { stdout: [], stderr: [] };
      const stop = (error: Error) => {
        failure ??= error;
        if (child.pid) try { process.kill(-child.pid, "SIGKILL"); } catch {}
      };
      const timer = setTimeout(() => stop(new Error("Native oracle deadline exceeded")), 3000);
      for (const stream of ["stdout", "stderr"] as const) child[stream].on("data", (bytes: Buffer) => {
        size += bytes.length;
        if (size > 1024 * 1024) stop(new Error("Native oracle output budget exceeded"));
        else buffers[stream].push(bytes);
      });
      child.stdin.on("error", error => { if ((error as NodeJS.ErrnoException).code !== "EPIPE") stop(error); });
      child.on("error", error => { failure = error; });
      child.on("close", (exitCode, signal) => {
        clearTimeout(timer);
        if (failure) reject(failure);
        else if (exitCode === null || signal) reject(new Error(`Native oracle terminated by ${signal}`));
        else resolve({ exitCode, stdout: Buffer.concat(buffers.stdout), stderr: Buffer.concat(buffers.stderr) });
      });
      child.stdin.end(Buffer.from(fixture.stdin ?? "", "base64"));
    });
    const files: Observation["files"] = {};
    let count = 0;
    const visit = async (relative: string): Promise<void> => {
      for (const name of (await readdir(join(root, relative))).sort()) {
        const path = relative ? `${relative}/${name}` : name;
        const stat = await lstat(join(root, path));
        if (++count > 2048 || stat.size > 4 * 1024 * 1024) throw new Error("Native snapshot budget exceeded");
        if (stat.isSymbolicLink() || !stat.isDirectory() && !stat.isFile()) throw new Error("Unexpected native special entry");
        files[path] = stat.isDirectory() ? { type: "directory", mode: stat.mode & 0o777 }
          : { type: "file", bytes: (await readFile(join(root, path))).toString("base64"), mode: stat.mode & 0o777 };
        if (stat.isDirectory()) await visit(path);
      }
    };
    await visit("");
    return { status: "completed", observation: { exitCode: output.exitCode, stdout: output.stdout.toString("base64"), stderr: output.stderr.toString("base64"), files }, durationMs: performance.now() - started };
  } catch (error) {
    return { status: (error as NodeJS.ErrnoException).code === "ENOENT" ? "oracle-unavailable" : /deadline/u.test(String(error)) ? "timeout" : "error", reason: String(error), durationMs: performance.now() - started };
  } finally { await rm(root, { recursive: true, force: true }); }
}
