import test from "node:test";
import assert from "node:assert/strict";
import { createBinaryExistsDetectors as own } from "../dist/index.js";
import { createBinaryExistsDetectors as original } from "../../agent-harness-tools/dist/index.js";
test("binary probes preserve exact names, programs and validation semantics", () => {
  for (const name of [
    "echo",
    'missing"; printf pwned; #',
    "a\u0000b",
    "α😀",
    "\ud800",
    "../tool"
  ]) {
    const rust = own(name),
      sdk = original(name);
    assert.deepEqual(
      rust.map(({ command, args }) => ({ command, args })),
      sdk.map(({ command, args }) => ({ command, args }))
    );
    for (let index = 0; index < rust.length; index++)
      for (const exitCode of [0, 1, -1, NaN, Infinity, "0"])
        for (const stdout of ["", " \n\t", "\u00a0\ufeff", "tool"])
          assert.equal(
            rust[index].validate({ exitCode, stdout }),
            sdk[index].validate({ exitCode, stdout })
          );
    rust[0].args.push("changed");
    assert.equal(rust[1].args.length, 1);
    assert.equal(own(name)[0].args.length, 1);
  }
});
test("probe validators read only required fields and retain getter errors", () => {
  const failure = new Error("stdout getter");
  for (const make of [own, original]) {
    const probes = make("mock"),
      seen = [];
    const result = {
      get exitCode() {
        seen.push("exit");
        return 0;
      },
      get stdout() {
        seen.push("stdout");
        return "mock";
      }
    };
    assert.equal(probes[0].validate(result), true);
    assert.deepEqual(seen, ["exit"]);
    seen.length = 0;
    assert.equal(probes[1].validate(result), true);
    assert.deepEqual(seen, ["exit", "stdout"]);
    assert.throws(
      () =>
        probes[1].validate({
          exitCode: 0,
          get stdout() {
            throw failure;
          }
        }),
      (error) => error === failure
    );
    assert.equal(
      probes[1].validate({
        exitCode: 1,
        get stdout() {
          throw failure;
        }
      }),
      false
    );
  }
});
