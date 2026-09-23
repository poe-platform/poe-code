import assert from "node:assert/strict";
import test from "node:test";
import { Exclusions } from "../../src/commands/archive/options.js";
import { execute, fixture } from "./zip-standard-flags.helpers.js";

test("archive exclusions have no omitted work quota and honor explicit work", () => {
  assert.equal(new Exclusions(["*"]).maxWork, Infinity);
  assert.throws(() => new Exclusions(["*"], 1).matches("ab"), /work limit/);
});

test("ZIP staging retries beyond 64 collisions and honors explicit member limits", async () => {
  const fs = await fixture();
  for (let index = 1; index <= 65; index++) await fs.mkdir(`/work/.zip-${index}`);
  const limited = await execute("zip", fs, ["out.zip", "binary"], { limits: { maxMembers: 65 } });
  assert.notEqual(limited.exitCode, 0);
  assert.match(limited.stderr, /attempt limit/);
  for (const options of [{}, { limits: { maxMembers: 66 } }, { limits: { maxTextBytes: 1000 } }]) {
    const result = await execute("zip", fs, ["out.zip", "binary"], options);
    assert.equal(result.exitCode, 0, result.stderr);
  }
  assert.equal((await fs.readdir("/work")).filter(entry => entry.name.startsWith(".zip-")).length, 65);
});
