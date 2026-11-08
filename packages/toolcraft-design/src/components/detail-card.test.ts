import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetOutputFormatCache } from "../internal/output-format.js";
import { stripAnsi } from "../internal/strip-ansi.js";
import { dark } from "../tokens/colors.js";
import { renderDetailCard } from "./detail-card.js";

describe("renderDetailCard", () => {
  const originalNoColor = process.env.NO_COLOR;
  const originalOutputFormat = process.env.OUTPUT_FORMAT;

  beforeEach(() => {
    process.env.NO_COLOR = "1";
    process.env.OUTPUT_FORMAT = "terminal";
    resetOutputFormatCache();
  });

  afterEach(() => {
    if (originalNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = originalNoColor;
    if (originalOutputFormat === undefined) delete process.env.OUTPUT_FORMAT;
    else process.env.OUTPUT_FORMAT = originalOutputFormat;
    resetOutputFormatCache();
  });

  it("renders a resource hero with description and grouped metadata", () => {
    const result = renderDetailCard({
      theme: dark,
      title: "GPT-5.5",
      subtitle: "@GPT-5.5",
      badges: ["OFFICIAL", "PUBLIC"],
      prose: [{ value: "Handles complex multi-step work with less guidance." }],
      sections: [
        {
          rows: [
            { label: "Owner", value: "OpenAI (@openai)" },
            { label: "Bot ID", value: "3065" },
            { label: "Image", value: "https://example.com/a-very-long-avatar-name.jpeg" }
          ]
        },
        {
          title: "Capabilities",
          rows: [
            { label: "Attachments", value: "Enabled" },
            { label: "Vision", value: "Disabled" }
          ]
        }
      ],
      width: 64
    });

    expect(stripAnsi(result)).toBe(
      [
        "GPT-5.5  @GPT-5.5",
        "Official · Public",
        "",
        "Handles complex multi-step work with less guidance.",
        "",
        "Owner   OpenAI (@openai)",
        "Bot ID  3065",
        "Image   https://example.com/a-very-long-avatar-name.jpeg",
        "",
        "Capabilities",
        "Attachments  Enabled",
        "Vision       Disabled"
      ].join("\n")
    );
  });

  it("keeps multiline row values aligned under the value column", () => {
    expect(
      stripAnsi(
        renderDetailCard({
          theme: dark,
          title: "Result",
          sections: [{ rows: [{ label: "Text", value: "First paragraph.\n\nSecond paragraph." }] }],
          width: 40
        })
      )
    ).toBe(
      ["Result", "", "Text  First paragraph.", "      ", "      Second paragraph."].join("\n")
    );
  });

  it("wraps styled row values by visible terminal width", () => {
    const styledValue = "\u001b[32mabcdefghij\u001b[0m klmno";
    const result = renderDetailCard({
      theme: dark,
      title: "Status",
      width: 30,
      sections: [
        {
          rows: [
            { label: "ansi", value: styledValue },
            { label: "plain", value: "abcdefghij klmno" }
          ]
        }
      ]
    });

    expect(result).toContain("\u001b[32mabcdefghij\u001b[0m klmno");
    expect(stripAnsi(result)).toBe(
      ["Status", "", "ansi   abcdefghij klmno", "plain  abcdefghij klmno"].join("\n")
    );
  });
});
