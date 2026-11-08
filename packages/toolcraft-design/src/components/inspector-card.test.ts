import { describe, expect, it } from "vitest";
import { stripAnsi } from "../internal/strip-ansi.js";
import { dark } from "../tokens/colors.js";
import { renderInspectorCard } from "./inspector-card.js";

describe("renderInspectorCard", () => {
  it("renders a compact resource inspector with preview and grouped fields", () => {
    const result = renderInspectorCard({
      theme: dark,
      title: "PreToolUse",
      subtitle: "hook project",
      badges: ["project", "claude-code"],
      preview: [
        "{",
        "  \"hooks\": {",
        "    \"PreToolUse\": [{ \"matcher\": \"Bash\" }]",
        "  }",
        "}"
      ].join("\n"),
      sections: [{
        title: "Details",
        fields: [
          { label: "ID", value: "project:hook:claude-code:PreToolUse" },
          { label: "Path", value: "hooks/project/claude-code/PreToolUse.json" }
        ]
      }],
      width: 72
    });

    expect(stripAnsi(result)).toBe([
      "PreToolUse  hook project",
      "project · claude-code",
      "",
      "Preview",
      "{",
      "\"hooks\": {",
      "\"PreToolUse\": [{ \"matcher\": \"Bash\" }]",
      "}",
      "}",
      "",
      "Details",
      "ID    project:hook:claude-code:PreToolUse",
      "Path  hooks/project/claude-code/PreToolUse.json"
    ].join("\n"));
  });

  it("clips long previews without dropping metadata", () => {
    const result = renderInspectorCard({
      theme: dark,
      title: "Long",
      preview: ["one", "two", "three", "four"].join("\n"),
      maxPreviewLines: 2,
      sections: [{ fields: [{ label: "Files", value: "1" }] }]
    });

    expect(stripAnsi(result)).toBe([
      "Long",
      "",
      "Preview",
      "one",
      "two",
      "... 2 more line(s)",
      "",
      "Files  1"
    ].join("\n"));
  });
});
