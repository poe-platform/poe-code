import assert from "node:assert/strict";
import test from "node:test";
import { transferReport } from "../../../src/commands/dd/report.js";
import { bytes, run } from "./helpers.js";

test("transfer reports use injected elapsed time and exact semantic byte counts", async () => {
  const times = [1000, 1500];
  const result = await run(["bs=4"], bytes("abcd"), {}, { now: () => times.shift()! });
  assert.equal(result.stderr, "1+0 records in\n1+0 records out\n4 bytes copied, 0.5 s, 8 B/s\n");
  assert.equal(transferReport(1n, 1000), "1 byte copied, 1 s, 1 B/s");
  assert.equal(transferReport(1024n, 1000), "1024 bytes (1.0 kB, 1.0 KiB) copied, 1 s, 1.0 kB/s");
  assert.equal(transferReport(0n, 0), "0 bytes copied, 0 s, Infinity B/s");
  assert.ok(transferReport(1n, 0.001).includes(", 1e-06 s,"));
  assert.ok(transferReport(1n, 1000000000).includes(", 1e+06 s,"));
});

test("status=progress is periodic and ends with a newline before record statistics", async () => {
  let clock = 0;
  const result = await run(["bs=2", "status=progress"], bytes("abcd"), {}, { now: () => { clock += 1000; return clock; } });
  assert.equal(result.exitCode, 0);
  assert.ok(result.stderr.startsWith("\r0 bytes copied, 1 s, 0 B/s"));
  assert.ok(result.stderr.includes("\n2+0 records in\n2+0 records out\n4 bytes copied,"));
});
