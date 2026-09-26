import { expect, it } from "vitest";
import { convert, createFormatRegistry, inspectFormats } from "./index.js";

it("accepts markdown for both directions with tables and strikeout enabled", async () => {
  const source = "| Name | Value |\n| --- | ---: |\n| ~~old~~ | 7 |\n";
  const registry = createFormatRegistry();
  for (const direction of ["read", "write"] as const) {
    expect(registry.resolve("markdown", direction).descriptor.name).toBe("gfm");
    expect(registry.list(direction)).toContain("markdown");
  }
  expect(registry.infer("report.markdown", "write")).toBe("gfm");
  expect(inspectFormats(["--list-extensions=markdown"])).toContain("+pipe_tables");
  const result = await convert([{ bytes: new TextEncoder().encode(source) }], {
    from: "markdown", to: "markdown"
  }, { yield: async () => {} });
  expect(result).toMatchObject({ kind: "text", text: expect.stringContaining("~~old~~") });
  expect(result.diagnostics).toEqual([]);
});
