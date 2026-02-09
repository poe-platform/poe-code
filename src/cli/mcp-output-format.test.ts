import { describe, expect, it } from "vitest";
import { ValidationError } from "./errors.js";
import { parseMcpOutputFormatPreferences } from "./mcp-output-format.js";

describe("parseMcpOutputFormatPreferences", () => {
  it("accepts markdown as a valid output format", () => {
    expect(parseMcpOutputFormatPreferences("markdown")).toEqual(["markdown"]);
  });

  it("rejects markdown when combined with url", () => {
    expect(() => parseMcpOutputFormatPreferences("markdown,url")).toThrowError(
      new ValidationError(
        "markdown output format cannot be combined with other formats. Use markdown alone or choose a different format combination."
      )
    );
  });

  it("rejects markdown when combined with base64", () => {
    expect(() =>
      parseMcpOutputFormatPreferences("base64,markdown")
    ).toThrowError(
      new ValidationError(
        "markdown output format cannot be combined with other formats. Use markdown alone or choose a different format combination."
      )
    );
  });

  it("accepts markdown_instructions as a valid output format", () => {
    expect(parseMcpOutputFormatPreferences("markdown_instructions")).toEqual([
      "markdown_instructions"
    ]);
  });

  it("rejects markdown_instructions when combined with other formats", () => {
    expect(() =>
      parseMcpOutputFormatPreferences("markdown_instructions,url")
    ).toThrowError(
      new ValidationError(
        "markdown_instructions output format cannot be combined with other formats. Use markdown_instructions alone or choose a different format combination."
      )
    );
  });
});

