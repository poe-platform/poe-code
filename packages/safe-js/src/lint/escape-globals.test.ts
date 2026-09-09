import { describe, expect, it } from "vitest";
import { lint } from "./index.js";
import { run } from "../run.js";

describe("legacy escape runtime globals in lint", () => {
  it.each([
    ['return escape("hello world ☃");', 'hello%20world%20%u2603'],
    ['return unescape("hello%20world%20%u2603");', 'hello world ☃']
  ])("accepts the implemented guest global in %s", async (source, expected) => {
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
    expect(lint(source)).toEqual([]);
  });

  it.each(["escape", "unescape"])("reports shadowing of %s", name => {
    expect(lint(`const ${name} = 7; return ${name};`)).toEqual([
      expect.objectContaining({ code: "AS-SHADOW-GLOBAL", severity: "warning" })
    ]);
  });

  it.each(["escap", "unescap"])("still rejects unknown %s", name => {
    expect(lint(`return ${name};`)).toEqual([
      expect.objectContaining({ code: "AS003", severity: "error" })
    ]);
  });
});
