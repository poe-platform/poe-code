import assert from "node:assert/strict";
import test from "node:test";
import { execute, fixture } from "./zip-standard-flags.helpers.js";

for (const args of [["-h2"], ["--more-help"], ["--more"], ["-qh2"], ["-h2", "--unknown"], ["-h22"], ["-", "-h2"]]) {
  test(`zip extended help exits without archive work ${args}`, async () => {
    const fs = await fixture();
    const denied = new Proxy(fs, { get(target, key) {
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? () => { throw new Error(`unexpected filesystem operation ${String(key)}`); } : value;
    } });
    const result = await execute("zip", denied, args);
    assert.equal(result.exitCode, 0, result.stderr);
    const output = result.stdout.toString();
    for (const section of ["Usage:", "Selection", "Archive operations", "Streaming", "ZIPOPT"]) assert.ok(output.includes(section), output);
    assert.ok(output.includes("conditional byte publication"), output);
    assert.equal(result.stderr, "");
  });
}

for (const args of [["-h2-"], ["--more-help-"], ["--more-help=value"], ["--unknown", "-h2"]]) {
  test(`zip extended help preserves invalid argument status ${args}`, async () => {
    const result = await execute("zip", await fixture(), args);
    assert.equal(result.exitCode, 16);
    assert.ok(!result.stdout.toString().includes("Usage:"));
  });
}
