import { describe, expect, it } from "vitest";
import {
  parseCodeReviewIngestSource,
  parseCodeReviewProfileMarkdown,
  parseCodeReviewPromptMarkdown
} from "./document-schemas.js";

describe("code review document schemas", () => {
  it("rejects ingest source usernames with trailing hyphens", () => {
    const source = [
      "version: 1",
      "username: alice-",
      "repos: [owner/repo]",
      "fetched_at: 2026-01-01T00:00:00.000Z",
      "output_profile_path: /repo/.poe-code/code-review/profiles/alice.md",
      "pagination:",
      "  partial: false",
      "  comments_written: 0",
      "rate_limit: null",
      ""
    ].join("\n");

    expect(() => parseCodeReviewIngestSource(source, "source.yaml")).toThrow(
      "source.yaml: username must be a safe GitHub actor name"
    );
  });

  it("treats a leading horizontal rule without closing frontmatter as body content", () => {
    const content = "---\nReview style notes\n\nKeep comments specific.\n";

    expect(parseCodeReviewProfileMarkdown(content, "generic.md")).toEqual({ content });
    expect(parseCodeReviewPromptMarkdown(content, "orchestrator.md", "orchestrator")).toEqual({
      content
    });
  });
});
