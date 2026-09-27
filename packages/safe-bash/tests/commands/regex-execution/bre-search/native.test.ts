import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createBoundedRegexProvider } from "../../../../src/commands/regex-execution/bounded-provider.js";
import { RegexExecutor } from "../../../../src/commands/regex-execution/portable.js";
import { exprMatchCeilings } from "../../../../src/commands/regex-execution/protocol.js";
import { nativeCases } from "./native.cases.js";

const executor = new RegexExecutor(createBoundedRegexProvider());
const session = executor.open(new AbortController().signal);
after(async () => { await session.close(); await executor.dispose(); });

for (const method of ["searchBre", "matchExpr", "run"] as const) for (const cancelled of [false, true]) test(`${method} rejects ${cancelled ? "cancelled" : "closed"} sessions through its Promise`, async () => {
  const request = { kind: "bre-search" as const, pattern: Buffer.from("a"), profile: "byte" as const, limits: exprMatchCeilings };
  const expr = { ...request, kind: "expr-match" as const };
  const grep = { kind: "grep" as const, patterns: ["a"], fixed: true, extended: false, insensitive: false, whole: false, word: false };
  const controller = new AbortController();
  const current = executor.open(controller.signal);
  const reason = new Error("cancel regex session");
  if (cancelled) controller.abort(reason);
  else await current.close();
  const expected = (error: unknown) => cancelled ? error === reason : error instanceof Error && "code" in error && error.code === "CLOSED";
  try {
    const pending = method === "searchBre" ? current.searchBre(request, Buffer.from("a"))
      : method === "matchExpr" ? current.matchExpr(expr, Buffer.from("a")) : current.run(grep, []);
    await assert.rejects(pending, expected);
    if (method === "searchBre") assert.throws(() => current.searchBreSync(request, Buffer.from("a")), expected);
    if (method === "run") assert.throws(() => current.runSync(grep, []), expected);
  } finally { await current.close(); }
});

for (const [index, fixture] of nativeCases.entries()) {
  test(`GNU csplit syntax ${index + 1}: ${fixture.profile} ${JSON.stringify(fixture.pattern)} on ${JSON.stringify(fixture.subject)}`, async () => {
    const request = { kind: "bre-search" as const, pattern: Uint8Array.from(fixture.pattern), profile: fixture.profile, limits: exprMatchCeilings };
    if ("category" in fixture.expected) {
      await assert.rejects(session.searchBre(request, Uint8Array.from(fixture.subject)), { category: fixture.expected.category });
    } else {
      const result = await session.searchBre(request, Uint8Array.from(fixture.subject));
      assert.deepEqual(result.overall, fixture.expected.overall, fixture.native);
      assert.equal(result.matched, fixture.expected.overall !== null);
    }
  });
}
