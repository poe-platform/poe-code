import assert from "node:assert/strict";
import { test } from "node:test";
import { createYqQuerySession } from "safe-bash-query-engine";
import { evaluateJqExpression } from "./template.js";

test("jq serialization defaults to unlimited output", async (t) => {
  const session = createYqQuerySession({ signal: new AbortController().signal });
  const prototype = Object.getPrototypeOf(session.ownedWork) as typeof session.ownedWork;
  const stringify = prototype.stringifyJson;
  const limits: (number | undefined)[] = [];
  t.mock.method(prototype, "stringifyJson", function (
    this: typeof session.ownedWork,
    ...args: Parameters<typeof stringify>
  ) {
    limits.push(args[1]?.maxBytes);
    return stringify.apply(this, args);
  });
  try {
    assert.equal(await evaluateJqExpression({ body: "notes" }, ".", new AbortController().signal),
      '{"body":"notes"}\n');
    assert.deepEqual(limits, [Infinity]);
  } finally {
    await session.close();
  }
});

test("jq serialization honors an explicit output cap", async () => {
  await assert.rejects(evaluateJqExpression({ body: "x".repeat(100) }, ".", new AbortController().signal, 50));
});
