import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve, join, relative } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { runInNewContext } from "node:vm";
import { Volume } from "memfs";
import { compareCapture, coverageGate, type Capture } from "./gates.js";

function runReport(profile: Record<string, unknown>, forgedInputHash = false, alternateRegister = false, argv0?: number[]) {
  const fs = Volume.fromJSON({ "/out/.keep": "", "/docs/ssconvert/census.json": "{}" });
  const hash = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
  const profileBytes = JSON.stringify(profile);
  fs.writeFileSync("/docs/ssconvert/profile.json", profileBytes);
  const capture = { state: "captured", sourceHash: "a".repeat(64), profileHash: hash(profileBytes), inputHash: "b".repeat(64),
    argv: [[45, 118]], stdin: [], env: [["LC_ALL", "C"]], cwd: "/", status: 0, stdout: [79, 75], stderr: [], before: [], after: [] };
  if (argv0) Object.assign(capture, { argv0 });
  capture.inputHash = forgedInputHash ? "b".repeat(64) : hash(JSON.stringify({ ...(argv0 ? { argv0 } : {}), argv: capture.argv, stdin: capture.stdin, env: capture.env, cwd: "/", before: capture.before }));
  for (const name of ["reference", "candidate"]) fs.writeFileSync(`/out/${name}.json`, JSON.stringify(capture));
  fs.writeFileSync("/out/cases.json", JSON.stringify([{ feature: "version", reference: "/out/reference.json", candidate: "/out/candidate.json" }]));
  fs.writeFileSync("/docs/ssconvert/canonical-differential-register.json", JSON.stringify({ source: { sha256: capture.sourceHash },
    census: { path: "/docs/ssconvert/census.json", sha256: hash("{}") }, profile: { path: "/docs/ssconvert/profile.json", sha256: hash(profileBytes) },
    entries: [{ id: "version", requirements: ["exact"] }] }));
  if (alternateRegister) {
    fs.writeFileSync("/out/register.json", fs.readFileSync("/docs/ssconvert/canonical-differential-register.json"));
    fs.writeFileSync("/docs/ssconvert/canonical-differential-register.json", "{}");
  }
  const script = readFileSync(new URL("../../tools/report.mjs", import.meta.url), "utf8").split("\n").filter(line => !line.startsWith("import ")).join("\n");
  runInNewContext(script, {
    readFileSync: (path: string) => fs.readFileSync(path.startsWith("docs/") ? "/" + path : path),
    writeFileSync: fs.writeFileSync.bind(fs), lstatSync: fs.lstatSync.bind(fs),
    realpathSync: (path: string) => fs.realpathSync(path === "out" ? "/out" : path),
    resolve: (path: string) => path, dirname, createHash, isDeepStrictEqual, compareCapture, coverageGate,
    process: { argv: ["node", "report", "/out/cases.json", "/out/report.json", ...(alternateRegister ? ["/out/register.json"] : [])] }, console: { log() {} },
  });
  return JSON.parse(fs.readFileSync("/out/report.json", "utf8") as string) as { pass: boolean; passed: number; blocked: string[] };
}

it("cannot certify captures bound to a frozen unavailable native profile", () => {
  const result = runReport({ status: "blocked", executableHash: "c".repeat(64), dependencies: [], plugins: [], locale: { LC_ALL: "C" } });
  expect(result).toMatchObject({ pass: false, passed: 0, blocked: ["version"] });
});

it("requires input receipts to authenticate the actual invocation and namespace", () => {
  const profile = { status: "captured", sourceHash: "a".repeat(64), executableHash: "c".repeat(64),
    dependencies: [{ path: "/dependency", sha256: "d".repeat(64) }], plugins: [{ path: "/plugin", sha256: "e".repeat(64) }], locale: { LC_ALL: "C" } };
  expect(runReport(profile).pass).toBe(true);
  expect(runReport(profile, true)).toMatchObject({ pass: false, passed: 0, blocked: ["version"] });
});

it("qualifies a new register generation without replacing the frozen default", () => {
  const profile = { status: "captured", sourceHash: "a".repeat(64), executableHash: "c".repeat(64),
    dependencies: [{ path: "/dependency", sha256: "d".repeat(64) }], plugins: [{ path: "/plugin", sha256: "e".repeat(64) }], locale: { LC_ALL: "C" } };
  expect(runReport(profile, false, true).pass).toBe(true);
});

it("cannot certify incomplete dependency or plugin identities", () => {
  const profile = { status: "captured", sourceHash: "a".repeat(64), executableHash: "c".repeat(64),
    dependencies: [{ path: "/dependency", sha256: "d".repeat(64) }], plugins: [{ path: "/plugin", sha256: "e".repeat(64) }], locale: { LC_ALL: "C" } };
  expect(runReport({ ...profile, dependencies: [{}] })).toMatchObject({ pass: false, passed: 0, blocked: ["version"] });
  expect(runReport({ ...profile, plugins: [{ path: "/plugin", sha256: "unknown" }] })).toMatchObject({ pass: false, passed: 0, blocked: ["version"] });
});

it("rejects impossible symlink targets and unrepresentable namespace modes", () => {
  const base = { sourceHash: "a".repeat(64), profileHash: "b".repeat(64), inputHash: "c".repeat(64),
    argv: [], stdin: [], env: [], cwd: "/", status: 0, stdout: [], stderr: [], before: [], after: [] } satisfies Capture;
  for (const entry of [
    { path: "/link", kind: "symlink", target: "bad\0target", mode: 41471 },
    { path: "/file", kind: "file", bytes: [], mode: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    const capture = { ...base, after: [entry] } as Capture;
    expect(compareCapture(capture, capture)).toContain("after");
  }
});

it("compares invocation name bytes and authenticates optional argv0 receipts", () => {
  const profile = { status: "captured", sourceHash: "a".repeat(64), executableHash: "c".repeat(64),
    dependencies: [{ path: "/dependency", sha256: "d".repeat(64) }], plugins: [{ path: "/plugin", sha256: "e".repeat(64) }], locale: { LC_ALL: "C" } };
  expect(runReport(profile, false, false, [115, 115]).pass).toBe(true);
  const base: Capture = { sourceHash: "a".repeat(64), profileHash: "b".repeat(64), inputHash: "c".repeat(64),
    argv: [], stdin: [], env: [], cwd: "/", status: 0, stdout: [], stderr: [], before: [], after: [] };
  expect(compareCapture({ ...base, argv0: [115] } as Capture, { ...base, argv0: [116] } as Capture)).toContain("argv0");
  expect(compareCapture({ ...base, argv0: [115] } as Capture, base)).toContain("argv0");
  for (const argv0 of [[0], []]) {
    const invalid = { ...base, argv0 } as Capture;
    expect(compareCapture(invalid, invalid)).toContain("argv0");
  }
});

it("native QA preserves a leading UTF-8 BOM in argv0 and argv", () => {
  const fs = Volume.fromJSON({ "/out/root/input": "tiny", "/out/archive": "archive", "/out/oracle": "oracle", "/out/dependency": "dependency", "/out/plugin": "plugin" });
  const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
  fs.writeFileSync("/out/profile", JSON.stringify({ executableHash: digest("oracle"),
    dependencies: [{ path: "/out/dependency", sha256: digest("dependency") }], plugins: [{ path: "/out/plugin", sha256: digest("plugin") }], locale: { LC_ALL: "C" } }));
  fs.writeFileSync("/out/spec", JSON.stringify({ profile: "/out/profile", archive: "/out/archive", cwd: "/out/root", executable: "/out/oracle",
    argv0: [239, 187, 191, 115], argv: [[239, 187, 191, 120]], stdin: [], env: [["LC_ALL", "C"]] }));
  const script = readFileSync(new URL("../../tools/capture-native.mjs", import.meta.url), "utf8").split("\n").filter(line => !line.startsWith("import ")).join("\n");
  let actual: { argv: string[]; argv0: string } | undefined;
  runInNewContext(script, { ...fs, resolve, join, relative, dirname, Buffer, TextDecoder,
    realpathSync: (path: string) => fs.realpathSync(path === "out" ? "/out" : path),
    process: { argv: ["node", "capture", "/out/spec", "/out/capture"] },
    createHash: () => ({ update: (bytes: Uint8Array) => ({ digest: () => Buffer.from(bytes).toString() === "archive"
      ? "2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12" : digest(bytes) }) }),
    spawnSync: (_command: string, argv: string[], options: { argv0: string }) => {
      actual = { argv, argv0: options.argv0 };
      return { status: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
    },
  });
  expect(actual).toEqual({ argv: ["\ufeffx"], argv0: "\ufeffs" });
});
