import { describe, expect, it, vi } from "vitest";
import { stripAnsi } from "toolcraft-design";
import { createFileChangeRenderers } from "./file-change-renderer.js";

describe("createFileChangeRenderers", () => {
  const result = {
    changes: [
      {
        kind: "modified" as const,
        path: "scripts/heating.js",
        oldContent: "old\n",
        newContent: "new\n"
      }
    ]
  };

  it("passes structured results through unchanged for JSON output", () => {
    const renderers = createFileChangeRenderers({ mode: "status" });

    expect(renderers.json?.(result, {} as never)).toBe(result);
  });

  it("renders status and diff modes through standard command renderers", () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    createFileChangeRenderers({ mode: "status" }).rich?.(result, {} as never);
    const markdown = createFileChangeRenderers({ mode: "diff" }).markdown?.(
      result,
      {} as never
    );

    expect(stripAnsi(String(stdout.mock.calls[0]?.[0]))).toContain("M  scripts/heating.js");
    expect(markdown).toContain("```diff");
    expect(markdown).toContain("-old");
    expect(markdown).toContain("+new");
    stdout.mockRestore();
  });
});
