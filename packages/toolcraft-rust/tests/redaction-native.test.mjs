import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tsImport } from "tsx/esm/api";
import * as native from "../dist/redaction.js";
const reference = await tsImport("../../toolcraft/src/redaction.ts", import.meta.url);

test("deep redaction returns a value or a catchable stack error without aborting Node", () => {
  for (const container of ["object", "array"]) {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import { redactHttpBody } from ${JSON.stringify(new URL("../dist/index.js", import.meta.url).href)};
      let value = { token: 1 };
      for (let i = 0; i < 10000; i++) value = ${container === "object" ? "{ child: value }" : "[value]"};
      try { redactHttpBody(value); }
      catch (error) { if (!(error instanceof RangeError)) throw error; }
    `
      ],
      { encoding: "utf8", timeout: 3000 }
    );
    assert.equal(result.signal, null, `${container}: ${result.stderr}`);
    assert.equal(result.status, 0, `${container}: ${result.stderr}`);
  }
});

test("redaction names and headers preserve normalization and authorization policy", () => {
  for (const name of [
    "password",
    "Pass-Word",
    "X-API_KEY",
    "toKen",
    "APİKEY",
    "s.e.c.r.e.t",
    "constructor",
    "__proto__",
    "\ud800token",
    "authentication",
    "Authorization",
    "Proxy-Authorization",
    "Cookie",
    "Set-Cookie"
  ]) {
    assert.equal(native.isSensitiveName(name), reference.isSensitiveName(name), name);
    for (const value of ["Bearer token", "bearer token", "Basic value", "", "Bearer \ud800"]) {
      assert.equal(
        native.redactHttpHeaderValue(name, value),
        reference.redactHttpHeaderValue(name, value)
      );
    }
  }
});

test("redaction preserves host scalars, string parsing, cycles and repeated references", () => {
  const shared = { access_token: "synthetic", value: "\ud800" };
  const cycle = { shared, second: shared, big: 1n, absent: undefined, symbol: Symbol("value") };
  cycle.self = cycle;
  const array = [shared];
  array.push(array);
  for (const value of [
    cycle,
    array,
    null,
    1n,
    undefined,
    Symbol("root"),
    "plain",
    ' {"password":"synthetic"} ',
    '[{"secret":1}]',
    "{invalid",
    '"token"',
    "\ufeff[1]",
    new Date("2026-01-01"),
    JSON.parse('{"__proto__":{"password":1}}')
  ]) {
    assert.deepEqual(native.redactHttpBody(value), reference.redactHttpBody(value));
  }
  assert.equal(shared.access_token, "synthetic");
});

test("redaction preserves serializer receivers, keys, single application and thrown identity", () => {
  for (const lib of [native, reference]) {
    const calls = [];
    const returned = {
      label: "visible",
      toJSON() {
        throw new Error("must not call twice");
      }
    };
    const child = {
      toJSON(key) {
        calls.push([this, key]);
        return returned;
      }
    };
    assert.deepEqual(lib.redactHttpBody({ child, token: child }), {
      child: { label: "visible" },
      token: "<redacted>"
    });
    assert.deepEqual(calls, [[child, "child"]]);
    const exception = { reason: "serializer" };
    assert.throws(
      () =>
        lib.redactHttpBody({
          toJSON() {
            throw exception;
          }
        }),
      (error) => error === exception
    );
    const fn = Object.assign(() => 0, { toJSON: () => ({ secret: 1 }) });
    assert.deepEqual(lib.redactHttpBody(fn), { secret: "<redacted>" });
    assert.equal(
      lib.redactHttpBody(() => 0),
      undefined
    );
    const hook = () => ({ ignored: true });
    hook.call = (receiver, key) => ({ password: receiver.value, key });
    assert.deepEqual(lib.redactHttpBody({ nested: { toJSON: hook, value: "synthetic" } }), {
      nested: { password: "<redacted>", key: "nested" }
    });
  }
});

test("redaction snapshots object entries before traversal and retains array map semantics", () => {
  const run = (lib) => {
    const calls = [];
    const input = {
      get first() {
        calls.push("first");
        return {
          toJSON() {
            calls.push("serialize");
            return 1;
          }
        };
      },
      get second() {
        calls.push("second");
        return 2;
      }
    };
    const output = lib.redactHttpBody(input);
    return { output, calls };
  };
  assert.deepEqual(run(native), run(reference));
  class Values extends Array {}
  const input = new Values(3);
  input[1] = { secret: 1 };
  const actual = native.redactHttpBody(input);
  assert.deepEqual(actual, reference.redactHttpBody(input));
  assert.equal(Object.getPrototypeOf(actual), Values.prototype);
  assert.equal(0 in actual, false);
  const custom = [1];
  custom.map = (visit) => [visit({ token: 1 }, 0), "custom"];
  assert.deepEqual(native.redactHttpBody(custom), reference.redactHttpBody(custom));
});

test("redaction propagates getter and serializer exceptions without replacing thrown values", () => {
  for (const error of [new Error("synthetic"), { failure: true }, undefined, null, 0, "failed"]) {
    for (const value of [
      {
        get toJSON() {
          throw error;
        }
      },
      {
        toJSON() {
          throw error;
        }
      },
      {
        get field() {
          throw error;
        }
      }
    ]) {
      for (const lib of [native, reference]) {
        let thrown = false;
        try {
          lib.redactHttpBody(value);
        } catch (caught) {
          thrown = true;
          assert.equal(caught, error);
        }
        assert.equal(thrown, true);
      }
    }
  }
});

test("array callbacks can be retained and invoked after the original traversal", () => {
  const run = (lib) => {
    let retained;
    const input = [];
    input.map = (callback) => {
      retained = callback;
      return "custom";
    };
    assert.equal(lib.redactHttpBody(input), "custom");
    // Its former ancestor has left the active set by the time map returns.
    input.map = Array.prototype.map;
    input.push({ token: 1 });
    return retained(input, 0);
  };
  assert.deepEqual(run(native), run(reference));
});
