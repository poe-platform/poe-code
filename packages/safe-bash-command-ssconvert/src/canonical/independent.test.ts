import { expect, it } from "vitest";
import { compareCapture, coverageGate, type Capture, type Evidence } from "./gates.js";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { resolve, join, relative, dirname } from "node:path";
import { Volume } from "memfs";

function nativeCapture(input: string, escape = false, overrides: Record<string, unknown> = {}, fixture: "hardlink" | "snapshot-error" | "signal" | undefined = undefined, profileOverrides: Record<string, unknown> = {}) {
  const fs = Volume.fromJSON({ "/out/root/in.csv": input, "/out/archive": "archive", "/out/oracle": "native",
    "/out/dependency": "dependency", "/out/plugin": "plugin", "/elsewhere/.keep": "" });
  const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
  fs.writeFileSync("/out/profile", JSON.stringify({ executableHash: digest("native"), dependencies: [{ path: "/out/dependency", sha256: digest("dependency") }],
    plugins: [{ path: "/out/plugin", sha256: digest("plugin") }], locale: "C", ...profileOverrides }));
  fs.writeFileSync("/out/spec", JSON.stringify({ profile: "/out/profile", archive: "/out/archive", cwd: "/out/root", executable: "/out/oracle", argv: [[45, 118]], stdin: [], env: [["LC_ALL", "C"]], ...overrides }));
  if (escape) fs.symlinkSync("/elsewhere", "/out/link");
  if (fixture === "hardlink") fs.linkSync("/out/root/in.csv", "/out/root/linked.csv");
  const source = readFileSync(new URL("../../tools/capture-native.mjs", import.meta.url), "utf8")
    .split("\n").filter(line => !line.startsWith("import ")).join("\n");
  const context = { ...fs, resolve, join, relative, dirname, Buffer, TextDecoder,
    process: { argv: ["node", "capture", "/out/spec", escape ? "/out/link/capture.json" : "/out/capture.json"], exitCode: 0 },
    realpathSync: (path: string) => fs.realpathSync(path === "out" ? "/out" : path),
    lstatSync: (path: string) => { if (fixture === "snapshot-error") throw new Error("Snapshot unavailable"); return fs.lstatSync(path); },
    createHash: () => ({ update: (bytes: Uint8Array) => ({ digest: () => Buffer.from(bytes).toString() === "archive"
      ? "2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12" : digest(bytes) }) }),
    spawnSync: (_file: string, _args: string[], options: { argv0?: string }) => {
      if (overrides.argv0 && options.argv0 !== new TextDecoder().decode(new Uint8Array(overrides.argv0 as number[])))
        throw new Error("Explicit argv0 was not passed intact");
      return fixture === "signal" ? { status: null, signal: "SIGTERM", stdout: Buffer.from("partial"), stderr: Buffer.from("warning") }
        : ({ status: 0, stdout: Buffer.from(""), stderr: Buffer.from("") });
    } };
  runInNewContext(source, context);
  return JSON.parse(fs.readFileSync("/out/capture.json", "utf8") as string) as { inputHash: string; state: string; reason?: string; snapshotError?: string;
    before?: { path: string; aliasOf?: string }[] };
}

it("native QA binds the filesystem inputs and refuses symlink output escape", () => {
  expect(nativeCapture("A\n").inputHash).not.toBe(nativeCapture("B\n").inputHash);
  expect(() => nativeCapture("A\n", true)).toThrow("Captures must be under out");
});

it("captures and transmits explicit argv0 bytes without rewriting diagnostics", () => {
  expect(nativeCapture("A", false, { argv0: [...Buffer.from("ssconvert")] }).state).toBe("captured");
  for (const argv0 of [[0], [255], [256], [], "ssconvert"]) {
    expect(nativeCapture("A", false, { argv0 }).state).toBe("blocked");
  }
});

it("authenticates declared schema, font/resource and build inputs before oracle execution", () => {
  for (const field of ["settingsSchemas", "resources", "buildInputs"]) {
    expect(nativeCapture("A", false, {}, undefined,
      { [field]: [{ path: "/out/plugin", sha256: "0".repeat(64) }] }).state).toBe("blocked");
    expect(nativeCapture("A", false, {}, undefined, { [field]: "unqualified" }).state).toBe("blocked");
  }
});

it("refuses environment coercion or duplicate keys", () => {
  for (const env of [[ ["A", "1"], ["A", "2"] ], [["A", 1]], [["A", "1", "extra"]], [["A=B", "1"]], [["A", "x\0"]], [["", "1"]], null]) {
    expect(nativeCapture("A", false, { env }).state).toBe("blocked");
  }
});

it("captures hardlink aliases and records snapshot failure as blocked", () => {
  const capture = nativeCapture("A", false, {}, "hardlink");
  expect(capture.before?.find(entry => entry.path === "/linked.csv")?.aliasOf).toBe("/in.csv");
  expect(nativeCapture("A", false, {}, "snapshot-error")).toMatchObject({ state: "blocked", snapshotError: "Error: Snapshot unavailable" });
});

it("preserves partial oracle diagnostics and native termination in blocked captures", () => {
  expect(nativeCapture("A", false, {}, "signal")).toMatchObject({ state: "blocked", status: null, signal: "SIGTERM",
    stdout: [...Buffer.from("partial")], stderr: [...Buffer.from("warning")] });
});

it("refuses two absent capture shapes rather than comparing their undefined fields", () => {
  expect(compareCapture({} as Capture, {} as Capture)).not.toEqual([]);
});

it("records byte admission and missing oracle profile as blocked evidence", () => {
  expect(nativeCapture("A", false, { argv: [[256]] }).state).toBe("blocked");
  expect(nativeCapture("A", false, { stdin: [-1] }).state).toBe("blocked");
  expect(nativeCapture("A", false, { profile: "/out/missing" }).state).toBe("blocked");
});

it("refuses unbound positive evidence and unknown runtime states", () => {
  expect(coverageGate(["a"], [{ feature: "a", state: "passed", exact: true }]).pass).toBe(false);
  expect(coverageGate(["a"], [{ feature: "a", state: "skipped", exact: true } as unknown as Evidence]).pass).toBe(false);
});

it("keeps malformed or absent hashes from certifying coverage", () => {
  const receipts = { sourceHash: "a".repeat(64), profileHash: "b".repeat(64), inputHash: "c".repeat(64), referenceHash: "d".repeat(64), candidateHash: "e".repeat(64) };
  expect(coverageGate([{ id: "workbook", requirements: ["exact", "styles", "caches"] }], [
    { feature: "workbook", state: "passed", exact: true, receipts, checks: { styles: true } },
  ]).pass).toBe(false);
  expect(coverageGate([{ id: "workbook", requirements: ["exact", "styles", "caches"] }], [
    { feature: "workbook", state: "passed", exact: true, receipts, checks: { styles: true, caches: true } },
  ]).pass).toBe(true);
  expect(coverageGate(["a"], [{ feature: "a", state: "passed", exact: true, receipts: { ...receipts, sourceHash: "wrong" } }]).pass).toBe(false);
});
