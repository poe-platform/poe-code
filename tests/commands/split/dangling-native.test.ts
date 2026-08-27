import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as native from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { platform, release, arch } from "node:os";
import type { FileSystem } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createRealFileSystem } from "../../../src/fs/real/index.js";
import { run } from "./helpers.js";
import { captureNativeReport, createNativeScratch } from "./native-capture.js";

const executable = fileURLToPath(new URL("../metadata-stress/.oracle/coreutils-9.7/src/split", import.meta.url));
const pin = "cf5851c4e6566983ce69940b766c0b5eb0cd26ebf2bb45eefe215b2d5c62f958";
interface Fixture {
  readonly id: string;
  readonly links: readonly (readonly [string, string])[];
  readonly dirs?: readonly string[];
  readonly prefix?: string;
  readonly error?: "missing" | "loop" | "notdir" | "alias";
}
const fixtures: readonly Fixture[] = [
  { id: "relative", links: [["xaa", "target"]] },
  { id: "absolute-virtual", links: [["xaa", "/target"]] },
  { id: "final-chain", links: [["xaa", "middle"], ["middle", "target"]] },
  { id: "nested-parent", dirs: ["out", "out/inner"], links: [["xaa", "out/next"], ["out/next", "inner/target"]] },
  { id: "symlink-before-dotdot", dirs: ["out", "out/inner"], links: [["jump", "out/inner"], ["xaa", "jump/../target"]] },
  { id: "prefix-through-link", dirs: ["out"], prefix: "prefix/x", links: [["prefix", "out"], ["out/xaa", "target"]] },
  { id: "missing-parent", links: [["xaa", "missing/target"]], error: "missing" },
  { id: "loop", links: [["xaa", "middle"], ["middle", "xaa"]], error: "loop" },
  { id: "non-directory-parent", links: [["xaa", "input/target"]], error: "notdir" },
  { id: "nested-input-alias", dirs: ["out"], links: [["xaa", "out/next"], ["out/next", "../input"]], error: "alias" },
  { id: "completed-before-missing-parent", links: [["xaa", "target"], ["xab", "missing/target"]], error: "missing" },
];
const nativeErrors = { missing: /No such file or directory/, loop: /Too many levels of symbolic links/, notdir: /Not a directory/, alias: /would overwrite input/ };
const virtualErrors = { missing: /no such file or directory/, loop: /too many symbolic links/, notdir: /not a directory/, alias: /would overwrite input/ };

async function setup(fs: FileSystem, fixture: Fixture): Promise<void> {
  await fs.writeFile("/input", Buffer.from("abcdef"));
  for (const path of fixture.dirs ?? []) await fs.mkdir(`/${path}`);
  for (const [path, target] of fixture.links) await fs.symlink!(target, `/${path}`);
}

async function snapshot(fs: FileSystem, path = "/"): Promise<Record<string, unknown>> {
  const entries: Record<string, unknown> = {};
  for (const entry of await fs.readdir(path)) {
    const full = `${path === "/" ? "" : path}/${entry.name}`;
    entries[full] = entry.type === "file" ? { type: "file", hex: Buffer.from(await fs.readFile(full)).toString("hex") }
      : entry.type === "symlink" ? { type: "symlink", target: await fs.readlink!(full) } : { type: "directory" };
    if (entry.type === "directory") Object.assign(entries, await snapshot(fs, full));
  }
  return entries;
}

async function nativeSnapshot(root: string, path = ""): Promise<Record<string, unknown>> {
  const entries: Record<string, unknown> = {};
  for (const entry of await native.readdir(join(root, path), { withFileTypes: true })) {
    const relative = `${path}/${entry.name}`;
    const full = join(root, relative);
    if (entry.isSymbolicLink()) {
      const target = await native.readlink(full);
      entries[relative] = { type: "symlink", target: target.startsWith(`${root}/`) ? target.slice(root.length) : target };
    } else if (entry.isDirectory()) {
      entries[relative] = { type: "directory" };
      Object.assign(entries, await nativeSnapshot(root, relative));
    } else entries[relative] = { type: "file", hex: (await native.readFile(full)).toString("hex") };
  }
  return entries;
}

test("dangling output links: pinned GNU effects on MemoryFS and rooted RealFS; Apple separate", async context => {
  let binary: Uint8Array;
  try { binary = await native.readFile(executable); } catch { context.skip("pinned GNU9.7 unavailable"); return; }
  assert.equal(createHash("sha256").update(binary).digest("hex"), pin);
  const report: unknown[] = [];
  const failures: string[] = [];
  const apple = platform() === "darwin" ? "/usr/bin/split" : undefined;
  const appleHash = apple ? createHash("sha256").update(await native.readFile(apple)).digest("hex") : undefined;
  if (apple) assert.equal(appleHash, "7c2d5f3c73e849d664bad3a2f4c67c5154b0f03f59f2fa779d49e33dc7983f91");
  for (const fixture of fixtures) {
    const args = ["-b3", "input", fixture.prefix ?? "x"];
    const profiles: Record<string, { status: number | null; stdout: string; stderr: string; entries: Record<string, unknown> }> = {};
    for (const [profile, command] of [["GNU9.7-Darwin", executable], ...(apple ? [["Apple", apple]] : [])]) {
      const root = await createNativeScratch(context);
      try {
        await native.writeFile(join(root, "input"), "abcdef");
        for (const path of fixture.dirs ?? []) await native.mkdir(join(root, path));
        for (const [path, target] of fixture.links) await native.symlink(target.startsWith("/") ? `${root}${target}` : target, join(root, path));
        const result = spawnSync(command!, args, { cwd: root, env: { LC_ALL: "C", PATH: "/usr/bin:/bin" }, timeout: 10000 });
        assert.ifError(result.error);
        profiles[profile!] = { status: result.status, stdout: result.stdout.toString(), stderr: result.stderr.toString(), entries: await nativeSnapshot(root) };
      } finally { await native.rm(root, { recursive: true }); }
    }
    const expected = profiles["GNU9.7-Darwin"]!;
    assert.equal(expected.status, fixture.error ? 1 : 0, fixture.id);
    if (fixture.error) assert.match(expected.stderr, nativeErrors[fixture.error], fixture.id);
    else assert.equal(expected.stderr, "");
    const observed: unknown[] = [];
    for (const backend of ["memory", "explicit-root-real"]) {
      const root = backend === "explicit-root-real" ? await createNativeScratch(context) : undefined;
      try {
        const fs = root ? await createRealFileSystem({ root }) : createMemoryFileSystem();
        await setup(fs, fixture);
        const result = await run(args, "", {}, { fs });
        const actual = { status: result.exitCode, stdout: result.stdout, stderr: result.stderr, entries: await snapshot(fs) };
        let failure: string | undefined;
        try {
          assert.equal(actual.status, expected.status);
          assert.equal(actual.stdout, expected.stdout);
          assert.deepEqual(actual.entries, expected.entries);
          if (fixture.error) assert.match(actual.stderr, virtualErrors[fixture.error]);
          else assert.equal(actual.stderr, expected.stderr);
        } catch (error) { failure = String(error); failures.push(`${fixture.id}/${backend}: ${failure}`); }
        observed.push({ backend, actual, match: !failure, failure });
      } finally { if (root) await native.rm(root, { recursive: true }); }
    }
    report.push({ fixture, args, profiles, observed });
  }
  const manifest = { time: new Date().toISOString(), platform: platform(), release: release(), arch: arch(), node: process.version, pin, appleHash,
    source: createHash("sha256").update(await native.readFile(new URL("../../../src/commands/split/outputs.ts", import.meta.url))).digest("hex"),
    absoluteFixtureMapping: "native targets rooted under scratch; snapshot strips only that exact root; VFS uses virtual absolute targets",
    diagnostics: "GNU and virtual negative patterns asserted separately; exact raw stderr retained. Apple is a separate observation, not a GNU oracle substitute.", report, failures };
  await captureNativeReport(context, "dangling-native", manifest, failures.length > 0);
  assert.deepEqual(failures, []);
});
