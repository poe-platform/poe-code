import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stripAnsi } from "../internal/strip-ansi.js";
import { renderFileChanges } from "./file-changes.js";

const originalForceColor = process.env.FORCE_COLOR;
const originalNoColor = process.env.NO_COLOR;

describe("renderFileChanges", () => {
  beforeEach(() => {
    delete process.env.FORCE_COLOR;
    process.env.NO_COLOR = "1";
  });

  afterEach(() => {
    if (originalForceColor === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = originalForceColor;
    if (originalNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = originalNoColor;
  });

  it("renders deterministic status lines and a summary", () => {
    expect(
      renderFileChanges(
        [
          { kind: "added", path: "flows/morning.json", newContent: "{}\n" },
          { kind: "modified", path: "scripts/heating.js", conflict: true },
          { kind: "deleted", path: "flows/old.json", oldContent: "{}\n" },
          { kind: "renamed", oldPath: "a.json", path: "b.json" }
        ],
        { mode: "status" }
      )
    ).toBe(
      [
        "A  flows/morning.json",
        "M! scripts/heating.js",
        "D  flows/old.json",
        "R  a.json -> b.json",
        "",
        "4 changes (1 added, 1 modified, 1 deleted, 1 renamed, 1 conflict)"
      ].join("\n")
    );
  });

  it("renders unified diffs for file contents", () => {
    const rendered = renderFileChanges(
      [
        {
          kind: "modified",
          path: "scripts/heating.js",
          oldContent: "const temperature = 18;\n",
          newContent: "const temperature = 21;\n"
        }
      ],
      { mode: "diff" }
    );

    expect(rendered).toContain("--- a/scripts/heating.js");
    expect(rendered).toContain("+++ b/scripts/heating.js");
    expect(rendered).toContain("-const temperature = 18;");
    expect(rendered).toContain("+const temperature = 21;");
  });

  it("colorizes terminal status without changing its plain text", () => {
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = "1";

    const rendered = renderFileChanges([{ kind: "added", path: "new.json" }], {
      mode: "status"
    });

    expect(rendered).toContain("\u001b[");
    expect(stripAnsi(rendered)).toBe("A  new.json\n\n1 change (1 added)");
  });
});
