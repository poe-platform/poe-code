import { describe, expect, it } from "vitest";
import { superintendentHarnessScript } from "./harness-script.js";

describe("superintendentHarnessScript", () => {
  it("wraps the script body in a fenced block and passes max_rounds through", () => {
    expect(superintendentHarnessScript).toContain("```js");
    expect(superintendentHarnessScript).toContain(
      "return await run({ maxRounds: meta.frontmatter.max_rounds });"
    );
    expect(superintendentHarnessScript).not.toContain("run(meta.frontmatter)");
    expect(superintendentHarnessScript).toContain("```");
  });
});
