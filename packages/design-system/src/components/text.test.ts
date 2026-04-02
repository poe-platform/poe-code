import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resetOutputFormatCache,
  withOutputFormat
} from "../internal/output-format.js";
import { text } from "./text.js";

describe("text", () => {
  const originalForceColor = process.env.FORCE_COLOR;

  beforeEach(() => {
    process.env.FORCE_COLOR = "1";
    resetOutputFormatCache();
  });

  afterEach(() => {
    process.env.FORCE_COLOR = originalForceColor;
    resetOutputFormatCache();
  });

  it("renders markdown strings with markdown formatting", () => {
    withOutputFormat("markdown", () => {
      expect(text.intro("Intro")).toBe("**Intro**");
      expect(text.heading("Heading")).toBe("## Heading");
      expect(text.section("Section")).toBe("**Section**");
      expect(text.command("poe-code")).toBe("`poe-code`");
      expect(text.argument("provider")).toBe("<provider>");
      expect(text.option("--help")).toBe("`--help`");
      expect(text.example("configure --yes")).toBe("`configure --yes`");
      expect(text.usageCommand("poe-code configure")).toBe("`poe-code configure`");
      expect(text.link("https://example.com")).toBe(
        "[https://example.com](https://example.com)"
      );
      expect(text.muted("Muted")).toBe("*Muted*");
      expect(text.badge("beta")).toBe("[beta]");
      expect(text.selectLabel("provider", "claude")).toBe("provider — claude");
    });
  });

  it("renders json strings without decoration", () => {
    withOutputFormat("json", () => {
      expect(text.intro("Intro")).toBe("Intro");
      expect(text.heading("Heading")).toBe("Heading");
      expect(text.section("Section")).toBe("Section");
      expect(text.command("poe-code")).toBe("poe-code");
      expect(text.argument("provider")).toBe("provider");
      expect(text.option("--help")).toBe("--help");
      expect(text.example("configure --yes")).toBe("configure --yes");
      expect(text.usageCommand("poe-code configure")).toBe("poe-code configure");
      expect(text.link("https://example.com")).toBe("https://example.com");
      expect(text.muted("Muted")).toBe("Muted");
      expect(text.badge("beta")).toBe("beta");
      expect(text.selectLabel("provider", "claude")).toBe("provider — claude");
    });
  });

  it("keeps terminal formatting for select labels with detail", () => {
    const result = withOutputFormat("terminal", () =>
      text.selectLabel("my-file.md", "codex · ×3")
    );

    expect(result).toContain("my-file.md");
    expect(result).toContain("codex · ×3");
    expect(result).not.toBe("my-file.md — codex · ×3");
    expect(result).not.toBe("my-file.md codex · ×3");
  });
});

describe("text.selectLabel", () => {
  it("returns plain label when detail is undefined", () => {
    expect(text.selectLabel("my-file.md")).toBe("my-file.md");
  });

  it("returns plain label when detail is empty", () => {
    expect(text.selectLabel("my-file.md", "")).toBe("my-file.md");
  });
});
