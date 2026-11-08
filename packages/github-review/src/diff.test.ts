import { describe, expect, it } from "vitest";
import { parseReviewDiff, validateInlineComments } from "./diff.js";

describe("validateInlineComments", () => {
  it("rejects ambiguous deleted-line targets unless the right side is explicit", () => {
    const context = parseReviewDiff(`diff --git a/src/demo.ts b/src/demo.ts
index 1111111..2222222 100644
--- a/src/demo.ts
+++ b/src/demo.ts
@@ -10,3 +10,2 @@ export function demo() {
 keep();
-removeMe();
 done();
`);

    expect(() =>
      validateInlineComments(
        [{ path: "src/demo.ts", line: 11, body: "Comment on deleted line" }],
        context,
      ),
    ).toThrow("ambiguous");

    expect(
      validateInlineComments(
        [{ path: "src/demo.ts", line: 11, side: "RIGHT", body: "Comment on context line" }],
        context,
      ),
    ).toEqual([{ path: "src/demo.ts", line: 11, side: "RIGHT", body: "Comment on context line" }]);
  });

  it("preserves valid whitespace in diff paths", () => {
    const context = parseReviewDiff(
      [
        'diff --git "a/ weird.ts" "b/ weird.ts"',
        '--- "a/ weird.ts"',
        '+++ "b/ weird.ts"',
        "@@ -1 +1 @@",
        "-old",
        "+new",
      ].join("\n"),
    );

    expect(
      validateInlineComments([{ path: " weird.ts", line: 1, body: "bug" }], context),
    ).toEqual([{ path: " weird.ts", line: 1, body: "bug" }]);
  });
});
