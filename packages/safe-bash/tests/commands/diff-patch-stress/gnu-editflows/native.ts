import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Fixture } from "./fixtures.js";

export const binary = "/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/src/patch";
export const binarySha256 = "c060444da0e547de6f17594baf0b5015a04f5b3277131ca12b1da27c621aee00";
export const scope = fileURLToPath(new URL(".", import.meta.url));
export type Entry = { readonly kind: "directory" } | { readonly kind: "file"; readonly hex: string } | { readonly kind: "symlink"; readonly target: string };
export type Namespace = Record<string, Entry>;
export interface Observation { readonly args: readonly string[]; readonly status: number; readonly stdout: string; readonly stderr: string; readonly namespace: Namespace }
export interface Evidence { readonly version: string; readonly binary: string; readonly binarySha256: string; readonly fixtureSha256: string; readonly cases: Record<string, readonly Observation[]> }

export function digest(bytes: string | Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

export async function proof(): Promise<string> {
  assert.equal(digest(await readFile(binary)), binarySha256, "GNU oracle binary hash changed; do not recapture silently");
  const version = spawnSync(binary, ["--version"], { encoding: "utf8", shell: false, timeout: 3000, maxBuffer: 65_536, env: { LC_ALL: "C", LANG: "C", PATH: "/usr/bin:/bin" } });
  assert.ifError(version.error);
  assert.equal(version.status, 0, "GNU oracle unavailable");
  assert.equal(version.stdout.split("\n")[0], "GNU patch 2.8");
  return version.stdout;
}

export function safeRelative(path: string): void {
  assert.match(path, /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/u);
  assert(!path.split("/").some(part => part === "." || part === ".."));
}

export async function native(fixture: Fixture): Promise<readonly Observation[]> {
  const root = await realpath(await mkdtemp(join(scope, ".native-")));
  const cwd = join(root, "work");
  try {
    await mkdir(cwd);
    await writeFile(join(root, "boundary"), "fixture boundary\n", { flag: "wx" });
    for (const directory of fixture.directories ?? []) { safeRelative(directory); await mkdir(join(cwd, directory), { recursive: true }); }
    for (const [path, text] of Object.entries(fixture.files)) {
      safeRelative(path);
      await mkdir(dirname(join(cwd, path)), { recursive: true });
      await writeFile(join(cwd, path), text, { flag: "wx" });
    }
    const observations: Observation[] = [];
    for (const step of fixture.steps) {
      assert(Buffer.byteLength(step.input) <= 65_536);
      assert(!step.input.includes("..") && !step.input.includes("\\") && !step.input.includes("\0"));
      const headers = step.input.split("\n").filter(line => /^(?:---|\*\*\*|\+\+\+) /u.test(line));
      for (const header of headers) {
        const path = header.slice(4).split("\t")[0]!;
        if (/^\d/u.test(path)) continue;
        assert(path === "/dev/null" || !path.startsWith("/"), "host absolute headers must use the isolated-root placeholder");
      }
      for (const arg of step.args) assert(!arg.startsWith("/") && !arg.includes(".."), "host argv must remain inside fixture root");
      const args = ["--batch", ...step.args.map(arg => arg.replaceAll("@ROOT@", root))];
      const result = spawnSync(binary, args, {
        cwd, input: step.input.replaceAll("@ROOT@", root), encoding: "utf8", shell: false, timeout: 3000, maxBuffer: 65_536,
        env: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC", HOME: root, TMPDIR: root, PATCH_GET: "0", VERSION_CONTROL: "simple" },
      });
      assert.ifError(result.error);
      assert.equal(result.signal, null, "native oracle terminated by signal");
      assert.notEqual(result.status, null);
      const namespace: Namespace = { ".": { kind: "directory" } };
      const visit = async (relative: string): Promise<void> => {
        for (const name of (await readdir(join(root, relative))).sort()) {
          const path = relative ? `${relative}/${name}` : name;
          safeRelative(path);
          const stat = await lstat(join(root, path));
          assert(!stat.isSymbolicLink(), "native corpus must never introduce symlinks");
          if (stat.isDirectory()) { namespace[path] = { kind: "directory" }; await visit(path); }
          else {
            assert(stat.isFile() && stat.nlink === 1 && stat.size <= 65_536);
            namespace[path] = { kind: "file", hex: (await readFile(join(root, path))).toString("hex") };
          }
        }
      };
      await visit("");
      const normalize = (text: string) => text.replaceAll(root, "@ROOT@");
      observations.push({ args: ["--batch", ...step.args], status: result.status!, stdout: normalize(result.stdout), stderr: normalize(result.stderr), namespace });
    }
    return observations;
  } finally { await rm(root, { recursive: true, force: true }); }
}
