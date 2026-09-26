import assert from "node:assert/strict";
import { test } from "node:test";
import { createOpCommand } from "./cli.js";
import { resolveOpCompletion } from "./completion-resolver.js";
import { createOp } from "./index.js";
import type { OpBackend, OpBindingHandle } from "./types.js";
import { isOpDuration } from "./duration.js";

const paths = ["item share", "events-api create", "service-account create", "connect token create"];
const valid = ["0", "+0", "-0", "-1h", "+1h", "1.5h", ".5h", "1.h", "1h30m", "1s1h", "1ns", "1us", "1µs", "1μs", "1ms", "1d", "1w", "1d2h", "0.5d", "1.d", ".5d", "1w.5d", "1.5w", "1h0s", "9223372036854775807ns", "-9223372036854775808ns", "-9223372036854775808.000000000000000000000001ns", "-9223372036.854775807999999999999999s", "106751.991d", "0.005208333333333333d9223371604854775807ns"];
const invalid = ["synthetic-private", "", "00", "0.0", "1", ".s", "1H", "1 d", " 1h", "1h ", "1e3s", "1h-1m", "1y", "1day", "1week", "1dd", "1..5d", "1h0", "9223372036854775808ns", "-9223372036854775809ns", "-9223372036854775808ns1ns", "9223372036.854775807999999999999999s", "1000000d", "106751.992d", "-106751.991167300645925925925925d", "15250.28445w", "-15250.284452471520846560846560w", "0.005208333333333333d9223371604854775808ns"];

test("unsigned duration accumulation does not bypass individual component or intermediate bounds", async () => {
  for (const sign of ["", "+", "-"]) {
    const value = `${sign}9223372036854775808ns9223372036854775808ns`;
    assert.equal(isOpDuration(value), true);
    const result = await execute("item share", [`--expires-in=${value}`]);
    assert.equal(result.exitCode, 0, result.error);
    assert.equal(result.received, value);
    assert.equal(resolveOpCompletion(["item", "share", `--expires-in=${value}`, "--"]).directive, 4);
    for (const suffix of ["9223372036854775809ns", "9223372036854775808.999999999999999999999999ns", "106752d", "1ns9223372036854775807ns"]) {
      assert.equal(isOpDuration(`${sign}9223372036854775808ns${suffix}`), false, sign + suffix);
    }
  }
});

async function execute(path: string, flags: readonly string[]) {
  const calls: string[] = [];
  let received: unknown;
  let error = "";
  const result = await createOpCommand({
    authorize(request) { calls.push("authorize"); received = request.flags["expires-in"]; return "allow"; },
    backend: { async execute(request) { calls.push("backend"); assert.equal(request.flags["expires-in"], received); return {}; } },
  }).execute({
    args: [...path.split(" "), "synthetic", ...flags], env: {}, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { calls.push("stdin"); yield new Uint8Array(); } },
    stdout: { async write() { calls.push("stdout"); } },
    stderr: { async write(bytes) { error += Buffer.from(bytes); } },
  });
  return { ...result, calls, received, error };
}

for (const path of paths) {
  test(`${path} rejects malformed and overflowing durations before policy or acquisition`, async () => {
    for (const value of invalid) {
      for (const flags of [[`--expires-in=${value}`], ["--expires-in", value], [`--expires-in=${value}`, "--expires-in=1h"], ["--expires-in=1h", `--expires-in=${value}`]]) {
        const result = await execute(path, flags);
        assert.equal(result.exitCode, 1, JSON.stringify({ path, flags, result }));
        assert.deepEqual(result.calls, []);
        assert.equal(result.error.includes("synthetic-private"), false);
      }
    }
  });

  test(`${path} completion rejects invalid consumed durations`, () => {
    for (const value of invalid) {
      for (const flags of [[`--expires-in=${value}`], ["--expires-in", value]]) {
        assert.deepEqual(resolveOpCompletion([...path.split(" "), ...flags, "--"]), { candidates: [], directive: 0 });
      }
    }
  });

  test(`${path} preserves valid duration strings and omission through authorization and backend`, async () => {
    for (const value of valid) {
      const result = await execute(path, [`--expires-in=${value}`]);
      assert.equal(result.exitCode, 0, JSON.stringify({ value, result }));
      assert.equal(result.received, value);
      assert.equal(result.calls.filter(call => call === "backend").length, 1);
      assert.equal(resolveOpCompletion([...path.split(" "), `--expires-in=${value}`, "--"]).directive, 4);
    }
    const omitted = await execute(path, []);
    assert.equal(omitted.exitCode, 0);
    assert.equal(omitted.received, undefined);
  });
}

test("item share expiry alias has the same validation and retains the original spelling of values", async () => {
  assert.equal((await execute("item share", ["--expiry=synthetic-private"])).exitCode, 1);
  assert.equal((await execute("item share", ["--expiry=+1.5d"])).received, "+1.5d");
  assert.deepEqual(resolveOpCompletion(["item", "share", "--expiry=synthetic-private", "--"]), { candidates: [], directive: 0 });
});

test("resolved approval and bound backend requests retain raw duration strings and omission", async () => {
  for (const value of [undefined, "+0.005208333333333333d", "-1h"]) {
    const stages: string[] = [];
    let error = "";
    const handle = Object.freeze({}) as OpBindingHandle;
    const backend: OpBackend = {
      async prepareBinding(requests) {
        stages.push("prepare");
        assert.equal(requests[0]!.flags["expires-in"], value);
        return { backendId: "synthetic", accountId: null, handle, targets: [], metadata: requests.map(() => ({})) };
      },
      validateBinding(binding) { assert.equal(binding, handle); },
      cancelBinding(binding) { assert.equal(binding, handle); },
      async execute(request, context) {
        stages.push("hook");
        assert.equal(context.binding, handle);
        assert.equal(request.flags["expires-in"], value);
        return "synthetic-result";
      },
    };
    const result = await createOp({
      backend,
      authorize(request) {
        stages.push("authorize");
        assert.equal(request.flags["expires-in"], value);
        return "ask";
      },
      authorizeResolution() { stages.push("resolution"); return true; },
      async approveResolved(manifest) {
        stages.push("approve");
        assert.equal(manifest.optionNames.includes("expires-in"), value !== undefined);
        await Promise.resolve();
        return true;
      },
    }).execute({
      args: ["item", "share", "item", ...(value === undefined ? [] : [`--expiry=${value}`])],
      env: {}, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { yield new Uint8Array(); } },
      stdout: { async write() { stages.push("stdout"); } },
      stderr: { async write(data) { error += Buffer.from(data); } },
    });
    assert.equal(result.exitCode, 0, JSON.stringify({ error, stages }));
    assert.deepEqual(stages, ["authorize", "resolution", "prepare", "approve", "hook", "stdout"]);
  }
});
