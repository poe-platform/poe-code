import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { runInNewContext } from "node:vm";
import { Volume } from "memfs";
import { compareCapture, coverageGate } from "./gates.js";

function report(requirements: string[], checks: Record<string, unknown> = {}, dropWarning = false, sameCapture = false, hardlink = false) {
  const fs = Volume.fromJSON({ "/docs/ssconvert/census.json": "{}", "/docs/ssconvert/profile.json": "{}", "/out/.keep": "" });
  const hash = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
  const profileBytes = JSON.stringify({ status: "captured", sourceHash: "a".repeat(64), executableHash: "c".repeat(64),
    dependencies: [{ path: "/oracle/dependency", sha256: "d".repeat(64) }], plugins: [{ path: "/oracle/plugin", sha256: "e".repeat(64) }], locale: { LC_ALL: "C" } });
  fs.writeFileSync("/docs/ssconvert/profile.json", profileBytes);
  const capture = { state: "captured", sourceHash: "a".repeat(64), profileHash: hash(profileBytes), inputHash: "b".repeat(64),
    argv: [], stdin: [], env: [], cwd: "/", status: 0, stdout: [], stderr: [], before: [], after: [] };
  capture.inputHash = hash(JSON.stringify({ argv: capture.argv, stdin: capture.stdin, env: capture.env, cwd: "/", before: capture.before }));
  fs.writeFileSync("/out/reference.json", JSON.stringify(capture));
  fs.writeFileSync("/out/candidate.json", JSON.stringify(capture));
  if (hardlink) { fs.unlinkSync("/out/candidate.json"); fs.linkSync("/out/reference.json", "/out/candidate.json"); }
  fs.writeFileSync("/out/snapshot.json", JSON.stringify({ sheets: [{ name: "Original", cells: [], warnings: ["original warning"] }] }));
  fs.writeFileSync("/out/candidate-snapshot.json", JSON.stringify({ sheets: [{ name: "Original", cells: [], warnings: dropWarning ? [] : ["original warning"] }] }));
  fs.writeFileSync("/out/cases.json", JSON.stringify([{ feature: "original", reference: "/out/reference.json", candidate: sameCapture ? "/out/reference.json" : "/out/candidate.json", checks }]));
  fs.writeFileSync("/docs/ssconvert/canonical-differential-register.json", JSON.stringify({ source: { sha256: capture.sourceHash },
    census: { path: "/docs/ssconvert/census.json", sha256: hash("{}") }, profile: { path: "/docs/ssconvert/profile.json", sha256: hash(profileBytes) },
    entries: [{ id: "original", requirements }] }));
  const script = readFileSync(new URL("../../tools/report.mjs", import.meta.url), "utf8").split("\n").filter(line => !line.startsWith("import ")).join("\n");
  const read = (path: string) => fs.readFileSync(path.startsWith("docs/") ? "/" + path : path);
  runInNewContext(script, { readFileSync: read, writeFileSync: fs.writeFileSync.bind(fs), lstatSync: fs.lstatSync.bind(fs), realpathSync: (path: string) => path === "out" ? "/out" : fs.realpathSync(path),
    resolve: (path: string) => path, dirname, createHash, compareCapture, coverageGate,
    isDeepStrictEqual: (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right),
    process: { argv: ["node", "report", "/out/cases.json", "/out/report.json"] }, console: { log() {} } });
  return JSON.parse(fs.readFileSync("/out/report.json", "utf8") as string) as { pass: boolean; passed: number; missing: string[] };
}
it("requires actual structured artifacts alongside exact captures", () => {
  expect(report(["exact", "semantic", "roundTrip", "interoperability"]).pass).toBe(false);
  const pair = { reference: "/out/snapshot.json", candidate: "/out/candidate-snapshot.json" };
  expect(report(["exact", "semantic", "roundTrip", "interoperability"], { semantic: pair, roundTrip: pair, interoperability: pair }).pass).toBe(false);
  expect(report(["exact", "semantic"], { semantic: pair }).pass).toBe(true);
  expect(report(["exact", "semantic"], { semantic: pair }, true).pass).toBe(false);
  expect(report(["exact", "semantic"], { semantic: { reference: "/out/snapshot.json", candidate: "/out/snapshot.json" } }).pass).toBe(false);
  expect(report(["exact"], {}, false, true).pass).toBe(false);
  expect(report(["exact"], {}, false, false, true).pass).toBe(false);
});
