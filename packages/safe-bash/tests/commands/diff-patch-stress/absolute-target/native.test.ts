import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { oraclePath } from "../gnu-target/oracle.js";

const executable = oraclePath("patch");
const directory = dirname(fileURLToPath(import.meta.url));

async function invoke(path: string, args: string[], cwd: string, input = "") {
  return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = execFile(path, args, {
      cwd, timeout: 3000, maxBuffer: 65536, killSignal: "SIGKILL", encoding: "utf8",
      env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", HOME: cwd, TMPDIR: cwd },
    }, (error, stdout, stderr) => {
      if (error && (typeof error.code !== "number" || error.killed)) reject(error);
      else resolve({ exitCode: typeof error?.code === "number" ? error.code : 0, stdout, stderr });
    });
    child.stdin!.on("error", error => { if ((error as NodeJS.ErrnoException).code !== "EPIPE") reject(error); });
    child.stdin!.end(input);
  });
}

for (const absoluteTarget of [false, true]) {
  test(`GNU 2.8 literal argv: ${absoluteTarget ? "absolute target outside cwd" : "relative target overrides absolute headers and -p999"}`, { timeout: 10000 }, async context => {
    const root = await mkdtemp(join(directory, ".native-"));
    try {
      const cwd = join(root, "cwd");
      await mkdir(cwd);
      await mkdir(join(root, "outside"));
      const target = absoluteTarget ? join(root, "outside/target") : "target";
      const targetPath = absoluteTarget ? target : join(cwd, target);
      const oldHeader = absoluteTarget ? "old-header" : join(root, "outside/old-header");
      const newHeader = absoluteTarget ? "new-header" : join(root, "outside/new-header");
      const input = `--- ${oldHeader}\n+++ ${newHeader}\n@@ -1,3 +1,3 @@\n anchor\n-before\n+after\n end\n`;
      const files: Record<string, string> = {
        [targetPath]: "anchor\nbefore\nend\n",
        [join(root, "outside/old-header")]: "anchor\nbefore\nend\n",
        [join(root, "outside/new-header")]: "unchanged new header\n",
        [join(cwd, "sentinel")]: "untouched\n",
      };
      for (const [path, value] of Object.entries(files)) await writeFile(path, value);
      const version = await invoke(executable!, ["--version"], cwd);
      assert.equal(version.exitCode, 0);
      assert.match(version.stdout, /^GNU patch 2\.8\n/u);
      const args = ["--batch", "--no-backup-if-mismatch", "-p999", target];
      const result = await invoke(executable!, args, cwd, input);
      assert.deepEqual(result, { exitCode: 0, stdout: `patching file ${target}\n`, stderr: "" });
      files[targetPath] = "anchor\nafter\nend\n";
      const actual: Record<string, string> = {};
      const visit = async (path: string): Promise<void> => {
        for (const name of await readdir(path)) {
          const entry = join(path, name);
          const stat = await lstat(entry);
          if (stat.isDirectory()) await visit(entry);
          else { assert(stat.isFile()); actual[entry] = await readFile(entry, "utf8"); }
        }
      };
      await visit(root);
      assert.deepEqual(actual, files);
      context.diagnostic(JSON.stringify({ executable, binarySha256: createHash("sha256").update(await readFile(executable!)).digest("hex"), version: version.stdout.split("\n")[0], args, cwd, input, result, files: actual }));
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
