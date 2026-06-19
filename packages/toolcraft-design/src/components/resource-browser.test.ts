import { describe, expect, it } from "vitest";
import { stripAnsi } from "../internal/strip-ansi.js";
import { dark } from "../tokens/colors.js";
import { renderResourceBrowser } from "./resource-browser.js";

describe("renderResourceBrowser", () => {
  it("renders grouped resource rows with previews and footer actions", () => {
    const result = renderResourceBrowser({
      theme: dark,
      title: "agent-stash browse",
      subtitle: "project to global",
      groups: [{
        title: "Project: claude-code",
        description: "Local project inventory",
        items: [{
          label: "PreToolUse",
          meta: ["hook", "project", "1 file"],
          preview: "PreToolUse: Bash -> npm test",
          badge: "project"
        }, {
          label: "code-review",
          meta: ["skill", "project", "1 file"],
          preview: "# Code Review",
          badge: "project"
        }]
      }, {
        title: "Global: claude-code",
        items: [{
          label: "global-only",
          meta: ["skill", "global", "1 file"],
          preview: "# Global Only",
          badge: "global"
        }]
      }],
      footer: "c copy   m move   u upload"
    });

    expect(stripAnsi(result)).toBe([
      "agent-stash browse  project to global",
      "",
      "Project: claude-code  2",
      "Local project inventory",
      "> PreToolUse  project",
      "  hook · project · 1 file",
      "  PreToolUse: Bash -> npm test",
      "",
      "> code-review  project",
      "  skill · project · 1 file",
      "  # Code Review",
      "",
      "Global: claude-code  1",
      "> global-only  global",
      "  skill · global · 1 file",
      "  # Global Only",
      "",
      "c copy   m move   u upload"
    ].join("\n"));
  });

  it("renders empty groups with their empty hint", () => {
    const result = renderResourceBrowser({
      theme: dark,
      title: "agent-stash browse",
      groups: [{
        title: "Gist default: claude-code",
        emptyHint: "No shared items",
        items: []
      }]
    });

    expect(stripAnsi(result)).toBe([
      "agent-stash browse",
      "",
      "Gist default: claude-code  0",
      "No shared items"
    ].join("\n"));
  });
});
