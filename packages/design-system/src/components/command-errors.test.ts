import { describe, it, expect } from "bun:test";
import { formatCommandNotFoundPanel } from "./command-errors.js";

function stripAnsi(value: string): string {
  let result = "";
  let index = 0;
  while (index < value.length) {
    const char = value[index];
    if (char === "\u001b" && value[index + 1] === "[") {
      index += 2;
      while (index < value.length && value[index] !== "m") {
        index += 1;
      }
      if (index < value.length) {
        index += 1;
      }
      continue;
    }
    result += char;
    index += 1;
  }
  return result;
}

describe("formatCommandNotFoundPanel", () => {
  it("formats a title, label, and footer", () => {
    const panel = formatCommandNotFoundPanel({
      unknownCommand: "yo",
      helpCommand: "poe-code --help"
    });

    expect(panel.title).toBe("command not found");
    expect(stripAnsi(panel.label)).toContain("Unknown command:");
    expect(stripAnsi(panel.label)).toContain("yo");
    expect(stripAnsi(panel.footer)).toContain("Run");
    expect(stripAnsi(panel.footer)).toContain("poe-code --help");
    expect(stripAnsi(panel.footer)).toContain("available commands.");
  });

  it("allows overriding the title", () => {
    const panel = formatCommandNotFoundPanel({
      title: "mcp command not found",
      unknownCommand: "nope",
      helpCommand: "poe-code mcp --help"
    });

    expect(panel.title).toBe("mcp command not found");
    expect(stripAnsi(panel.footer)).toContain("poe-code mcp --help");
  });
});

