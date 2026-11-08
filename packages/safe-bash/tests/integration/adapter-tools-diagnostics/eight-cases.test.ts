import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FsError, type FileSystem, type ShellResult } from "../../../src/index.js";
import { withFixture, type AdapterName } from "../adapter-tools/fixtures.js";

const frozen = readFileSync(new URL("./reference.json", import.meta.url));
const digest = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
assert.equal(digest(frozen), "c62e4e68b6c2d79ce6e88ce958cc7df37a5b2cfa306d9779e0ba48f7f55039b4");
const reference = JSON.parse(frozen.toString()) as {
  missing: { status: number; stdout: string; stderr: string };
  readonly: { status: number; stdout: string; stderr: string };
};

async function snapshot(fs: FileSystem, root = "/"): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = { [root]: null };
  for (const entry of (await fs.readdir(root)).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = `${root === "/" ? "" : root}/${entry.name}`;
    if (entry.type === "directory") Object.assign(result, await snapshot(fs, path));
    else result[path] = Buffer.from(await fs.readFile(path, { maxBytes: 1024 * 1024 })).toString("hex");
  }
  return result;
}

function exactResult(result: ShellResult, vector: { status: number; stdout: string; stderr: string }): void {
  assert.equal(result.exitCode, vector.status);
  assert.deepEqual(Buffer.from(result.stdout), Buffer.from(vector.stdout));
  assert.deepEqual(Buffer.from(result.stderr), Buffer.from(vector.stderr));
}

function boundary(error: unknown, code: "ENOENT" | "EROFS", path: string) {
  assert.ok(error instanceof FsError, "actual adapter rejection must retain FsError identity");
  assert.equal(error.name, "FsError");
  assert.equal(error.code, code);
  assert.equal(error.path, path);
  return { type: error.name, code: error.code, path: error.path, syscall: error.syscall };
}

const rows: { id: string; backend: AdapterName; source: string; flag?: "w" | "a" }[] = [
  ...(["memory", "real", "s3", "webdav", "mount", "overlay"] as const).map(backend => ({
    id: `${backend}:ENOENT`, backend, source: "cat < missing.txt",
  })),
  { id: "readonly:truncate:EROFS", backend: "readonly", source: "printf 'changed' > target.txt", flag: "w" },
  { id: "readonly:append:EROFS", backend: "readonly", source: "printf 'changed' >> target.txt", flag: "a" },
];

for (const row of rows) {
  test(row.id, { timeout: 20000 }, async () => {
    const evidence: Record<string, unknown> = { id: row.id, source: row.source,
      revision: process.env.DIAGNOSTIC_REVISION ?? "worktree", nativeCalls: 0 };
    const failures: string[] = [];
    const check = async (name: string, action: () => unknown | Promise<unknown>) => {
      try { await action(); }
      catch (error) { failures.push(`${name}: ${String(error)}`); }
    };
    try {
      await withFixture(row.backend, async ({ fs, exec, dispatched, lower }) => {
        const before = await snapshot(fs);
        const lowerBefore = lower ? await snapshot(lower) : undefined;
        const path = row.flag ? "/work/target.txt" : "/work/missing.txt";
        const code = row.flag ? "EROFS" : "ENOENT";
        const direct: Record<string, unknown>[] = [];
        evidence.direct = direct;
        evidence.beforeSha256 = digest(JSON.stringify(before));
        evidence.namespace = Object.keys(before);
        if (!row.flag) {
          const prelude = await exec("cat missing.txt 2> error.log");
          await check("redirected command status/streams", () => exactResult(prelude, { status: 1, stdout: "", stderr: "" }));
          const afterPrelude = await snapshot(fs);
          const diagnostic = Buffer.from(afterPrelude["/work/error.log"] ?? "", "hex").toString();
          evidence.errorLogHex = afterPrelude["/work/error.log"];
          await check("redirected command diagnostic meaning/path", () => {
            const detail = row.backend === "webdav" ? "WebDAV HTTP status 404, PROPFIND"
              : row.backend === "overlay" ? "no such file or directory, overlay"
              : "no such file or directory, readStream";
            assert.equal(diagnostic, `cat: ENOENT: ${detail} '/work/missing.txt'\n`);
          });
          await check("only expected diagnostic file is created", () => {
            const withoutLog = { ...afterPrelude };
            delete withoutLog["/work/error.log"];
            assert.deepEqual(withoutLog, before);
            assert.ok(diagnostic.length > 0);
          });
        }
        const beforeRedirect = await snapshot(fs);
        const dispatchCount = dispatched.length;
        const observed: Record<string, unknown>[] = [];
        const caughtErrors: unknown[] = [];
        const originalAccess = fs.access;
        const originalWrite = fs.writeFile;
        const originalAppend = fs.appendFile;
        const originalStream = fs.writeStream;
        if (row.flag) {
          fs.writeFile = async (target, bytes, options) => {
            observed.push({ operation: "writeFile", target, bytesHex: Buffer.from(bytes).toString("hex"), flag: options?.flag });
            return originalWrite.call(fs, target, bytes, options);
          };
          fs.appendFile = async (target, bytes, options) => {
            observed.push({ operation: "appendFile", target, bytesHex: Buffer.from(bytes).toString("hex") });
            return originalAppend.call(fs, target, bytes, options);
          };
          if (originalStream) fs.writeStream = async (target, source, options) => {
            observed.push({ operation: "writeStream", target, flag: options?.flag });
            return originalStream.call(fs, target, source, options);
          };
        } else {
          fs.access = async (target, mode, options) => {
            try { return await originalAccess.call(fs, target, mode, options); }
            catch (error) {
              caughtErrors.push(error);
              observed.push({ operation: "access", target, mode });
              throw error;
            }
          };
        }
        let result: ShellResult;
        try { result = await exec(row.source); }
        finally {
          fs.access = originalAccess;
          fs.writeFile = originalWrite;
          fs.appendFile = originalAppend;
          if (originalStream) fs.writeStream = originalStream;
        }
        evidence.result = { status: result.exitCode, stdoutHex: Buffer.from(result.stdout).toString("hex"),
          stderrHex: Buffer.from(result.stderr).toString("hex") };
        evidence.observed = observed;
        await check("exact CLI reference", () => exactResult(result, row.flag ? reference.readonly : reference.missing));
        await check(row.flag ? "readonly admission avoids mutation APIs" : "corresponding rejecting operation", () => {
          if (row.flag) {
            assert.equal(fs.capabilities.readOnly, true);
            assert.deepEqual(observed, []);
            return;
          }
          assert.equal(observed.length, 1);
          const event = observed[0]!;
          Object.assign(event, boundary(caughtErrors[0], code, path));
          assert.equal(event.target, path);
          assert.equal(event.operation, "access");
          assert.equal(event.mode, 4);
        });
        await check("failed redirection never dispatches utility", () => assert.equal(dispatched.length, dispatchCount));
        await check("CLI namespace and bytes unchanged", async () => assert.deepEqual(await snapshot(fs), beforeRedirect));
        const operations: [string, () => Promise<unknown>][] = row.flag
          ? [[`writeFile(empty,${row.flag})`, () => fs.writeFile(path, new Uint8Array(), { flag: row.flag! })],
            [row.flag === "a" ? "appendFile(changed)" : "writeFile(changed,w)", () => row.flag === "a"
              ? fs.appendFile(path, Buffer.from("changed")) : fs.writeFile(path, Buffer.from("changed"), { flag: "w" })]]
          : [["access(4)", () => fs.access(path, 4)], ["readFile", () => fs.readFile(path)], ["stat", () => fs.stat(path)]];
        for (const [operation, action] of operations) {
          await check(`typed boundary ${operation}`, async () => {
            await assert.rejects(action, error => { direct.push({ operation, ...boundary(error, code, path) }); return true; });
          });
          await check(`no effects ${operation}`, async () => assert.deepEqual(await snapshot(fs), beforeRedirect));
        }
        if (lower) await check("lower namespace and bytes unchanged", async () => assert.deepEqual(await snapshot(lower), lowerBefore));
        const after = await snapshot(fs);
        evidence.afterSha256 = digest(JSON.stringify(after));
        evidence.beforeRedirectSha256 = digest(JSON.stringify(beforeRedirect));
        evidence.targetHex = after["/work/target.txt"];
        evidence.missingAbsent = !Object.hasOwn(after, "/work/missing.txt");
      });
    } catch (error) { failures.push(`fixture/execution: ${String(error)}`); }
    evidence.failures = failures;
    evidence.status = failures.length ? "FAIL" : "PASS";
    console.log(`EVIDENCE ${Buffer.from(JSON.stringify(evidence)).toString("base64")}`);
    assert.deepEqual(failures, []);
  });
}
