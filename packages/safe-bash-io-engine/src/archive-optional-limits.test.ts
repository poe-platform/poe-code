import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandContext } from "safe-bash-contracts";
import { DEFAULT_ARCHIVE_LIMITS, invocationLimits, settings } from "./commands/archive/internal.js";

test("archive quotas default to Infinity and accept explicit Infinity independently", () => {
  const defaults = settings({});
  for (const key of Object.keys(DEFAULT_ARCHIVE_LIMITS)) {
    if (key === "chunkSize") continue;
    assert.equal(defaults[key as keyof typeof defaults], Infinity);
    assert.deepEqual(settings({ limits: { [key]: Infinity } }), defaults);
    assert.deepEqual(settings({ limits: { [key]: undefined } }), defaults);
    assert.deepEqual(settings({ limits: { [key]: 1 } }), { ...defaults, [key]: 1 });
    for (const value of [0, -1, 1.5, NaN, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => settings({ limits: { [key]: value } }), RangeError);
    }
  }
  assert.throws(() => settings({ limits: { unknown: Infinity } } as never), RangeError);
});

test("unlimited archive quotas retain a finite chunk size", () => {
  assert.equal(settings({}).chunkSize, 64 * 1024);
  assert.equal(settings({ limits: { chunkSize: Infinity } }).chunkSize, 64 * 1024);
  assert.equal(settings({ limits: { chunkSize: undefined } }).chunkSize, 64 * 1024);
  for (const chunkSize of [512, 1024 * 1024]) {
    assert.equal(settings({ limits: { chunkSize } }).chunkSize, chunkSize);
  }
  for (const chunkSize of [0, 511, 1024 * 1024 + 1, 512.5, NaN, -Infinity]) {
    assert.throws(() => settings({ limits: { chunkSize } }), RangeError);
  }
});

test("explicit Infinity cannot remove a finite archive registration or invocation quota", () => {
  const values = createCommandArguments([]);
  const context: CommandContext = {
    command: "tar", args: values.args, argumentValues: values, cwd: "/", env: {},
    fs: createMemoryFileSystem(), stdin: toByteSource(""),
    stdout: { async write() {} }, stderr: { async write() {} },
    signal: new AbortController().signal,
    capabilities: { commandLimits: { archive: { maxArchiveBytes: Infinity, maxEntryBytes: 5, maxTotalBytes: undefined, chunkSize: undefined } } },
  };
  const configured = settings({ limits: { maxArchiveBytes: 10, maxEntryBytes: Infinity } });
  const limits = invocationLimits(configured, context);
  assert.equal(limits.maxArchiveBytes, 10);
  assert.equal(limits.maxEntryBytes, 5);
  assert.equal(limits.maxTotalBytes, Infinity);
  assert.equal(limits.chunkSize, 64 * 1024);
  assert.equal(configured.maxEntryBytes, Infinity);
});
