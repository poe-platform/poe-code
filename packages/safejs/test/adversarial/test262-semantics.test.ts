import { describe, expect, it } from "vitest";

import { run } from "../../src/run.js";

describe("targeted Test262-style supported semantics", () => {
  it.each([
    [
      "keeps finally completion after catch",
      "try { throw 1; } catch (error) { return error; } finally { const observed = true; }",
      1
    ],
    [
      "uses short-circuit evaluation",
      "let calls = 0; function hit() { calls += 1; return true; } false && hit(); true || hit(); return calls;",
      0
    ],
    [
      "binds catch parameters lexically",
      "const error = 'outer'; try { throw 'inner'; } catch (error) { if (error !== 'inner') throw 'bad'; } return error;",
      "outer"
    ]
  ])("%s", async (_name, source, expected) => {
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
  });
});

describe("explicit unsupported ECMAScript syntax", () => {
  it.skip("skips classes rather than widening SafeJS syntax", () => undefined);
  it.skip("skips private fields rather than widening SafeJS syntax", () => undefined);
  it.skip("skips dynamic import rather than registering arbitrary modules", () => undefined);
  it.skip("skips array elisions rather than widening array literal syntax", () => undefined);
  it.skip("skips proxies and weak references outside the sandbox language", () => undefined);
});
