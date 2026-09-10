import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createBoundedRegexProvider } from "../../../../src/commands/regex-execution/bounded-provider.js";
import { RegexExecutor } from "../../../../src/commands/regex-execution/portable.js";
import { exprMatchCeilings } from "../../../../src/commands/regex-execution/protocol.js";
import { nativeCases } from "./native.cases.js";

const executor = new RegexExecutor(createBoundedRegexProvider());
const session = executor.open(new AbortController().signal);
after(async () => { await session.close(); await executor.dispose(); });

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
