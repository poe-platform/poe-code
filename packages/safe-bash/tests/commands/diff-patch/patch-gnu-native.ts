import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Files } from "./helpers.js";
import { nativeGnuBinding } from "../../native-profile.js";
import { oracleIdentity } from "../diff-patch-stress/gnu-target/oracle.js";

export const gnuPatch = "/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/src/patch";
export const gnuDiff = "/tmp/safe-bash-gnu-oracle.Yg2F0W/diffutils-3.12/src/diff";

export async function nativeGNU(args: readonly string[], files: Files = {}, input = "", tool = gnuPatch) {
  assert(tool === gnuPatch || tool === gnuDiff);
  assert(Buffer.byteLength(input) <= 1024 * 1024);
  for (const arg of args) {
    assert(!arg.includes("\0") && !arg.startsWith("/") && !arg.split(/[=/]/u).includes(".."), "host argv must remain fixture-relative or use $ROOT");
    assert(!arg.includes("=/"), "absolute option paths must use $ROOT");
  }
  const name = tool === gnuDiff ? "diff" : "patch";
  const selected = nativeGnuBinding(name) ? oracleIdentity(name).path : tool;
  const boundary = await mkdtemp(join(process.cwd(), "tests/commands/diff-patch/patch-gnu-native-"));
  const root = join(boundary, "work");
  try {
    await mkdir(root);
    await writeFile(join(boundary, "boundary"), "fixture boundary\n", { flag: "wx" });
    for (const [path, text] of Object.entries(files)) {
      assert(path && !path.startsWith("/") && !path.split("/").includes(".."));
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    }
    const result = spawnSync(selected, args.map(arg => arg.replaceAll("$ROOT", root)), {
      cwd: root, input: input.replaceAll("$ROOT", root), encoding: "utf8", timeout: 3000,
      killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
      env: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", HOME: root, TMPDIR: root },
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.notEqual(result.status, null);
    const final: Record<string, string> = {};
    const directories: string[] = [];
    const visit = async (relative: string) => {
      for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
        const path = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) { directories.push(path); await visit(path); }
        else if (entry.isFile()) final[path] = await readFile(join(root, path), "utf8");
        else throw new Error(`unexpected native entry: ${path}`);
      }
    };
    let rootExists = true;
    try { await visit(""); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      rootExists = false;
    }
    return { exitCode: result.status!, stdout: result.stdout.replaceAll(root, "$ROOT"),
      stderr: result.stderr.replaceAll(root, "$ROOT"), files: final, directories: directories.sort(), rootExists };
  } finally { await rm(boundary, { recursive: true, force: true }); }
}
