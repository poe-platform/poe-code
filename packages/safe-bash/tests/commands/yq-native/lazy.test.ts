import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { run } from "./helpers.js";

test("help and version do not resolve the optional yaml peer", async () => {
  let attempted = 0;
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier === "yaml") { attempted++; throw new Error("optional peer intentionally absent"); }
    return next(specifier, context);
  } });
  try {
    assert.equal((await run(["--help"])).status, 0);
    assert.equal((await run(["--version"])).status, 0);
    assert.equal(attempted, 0);
    assert.equal((await run(["."], "1")).status, 1);
    assert.equal(attempted, 1);
  } finally { hooks.deregister(); }
});
