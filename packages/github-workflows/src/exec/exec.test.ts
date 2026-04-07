import { describe, expect, it } from "vitest";
import { UserError } from "@poe-code/cmdkit";
import { checkUserAllow } from "./check-user-allow.js";
import { requireCommentPrefix } from "./require-comment-prefix.js";

describe("checkUserAllow", () => {
  it("does nothing when the automation does not declare allow frontmatter", () => {
    expect(() => checkUserAllow({ name: "triage" }, undefined)).not.toThrow();
  });

  it("allows matching GitHub author associations", () => {
    expect(() =>
      checkUserAllow({ name: "triage", allow: ["OWNER", "MEMBER"] }, "MEMBER")
    ).not.toThrow();
  });

  it("throws when COMMENT_AUTHOR_ASSOCIATION is missing for a guarded automation", () => {
    expect(() =>
      checkUserAllow({ name: "triage", allow: ["OWNER", "MEMBER"] }, undefined)
    ).toThrowError(
      new UserError('Automation "triage" requires COMMENT_AUTHOR_ASSOCIATION when "allow" frontmatter is set.')
    );
  });

  it("throws when the commenter association is not permitted", () => {
    expect(() =>
      checkUserAllow({ name: "triage", allow: ["OWNER", "MEMBER"] }, "CONTRIBUTOR")
    ).toThrowError(
      new UserError(
        'Automation "triage" does not allow COMMENT_AUTHOR_ASSOCIATION "CONTRIBUTOR". Allowed values: OWNER, MEMBER.'
      )
    );
  });
});

describe("requireCommentPrefix", () => {
  it("does nothing when the automation does not declare a prefix", () => {
    expect(() => requireCommentPrefix({ name: "triage" }, undefined)).not.toThrow();
  });

  it("allows matching comment prefixes", () => {
    expect(() =>
      requireCommentPrefix({ name: "triage", prefix: "poe-code" }, "poe-code review this")
    ).not.toThrow();
  });

  it("allows matching any configured comment prefix alias", () => {
    expect(() =>
      requireCommentPrefix(
        { name: "triage", prefix: ["poe-code", "poe-code-agent", "@poe-code-agent"] },
        "@poe-code-agent review this"
      )
    ).not.toThrow();
  });

  it("throws when COMMENT_BODY is missing for a prefixed automation", () => {
    expect(() =>
      requireCommentPrefix({ name: "triage", prefix: "poe-code" }, undefined)
    ).toThrowError(
      new UserError('Automation "triage" requires COMMENT_BODY when "prefix" frontmatter is set.')
    );
  });

  it("throws when the comment body does not start with the configured prefix", () => {
    expect(() =>
      requireCommentPrefix({ name: "triage", prefix: "poe-code" }, "/poe please help")
    ).toThrowError(
      new UserError('Automation "triage" requires COMMENT_BODY to start with "poe-code".')
    );
  });

  it("lists all accepted prefixes when multiple aliases are configured", () => {
    expect(() =>
      requireCommentPrefix(
        { name: "triage", prefix: ["poe-code", "poe-code-agent", "@poe-code-agent"] },
        "/poe please help"
      )
    ).toThrowError(
      new UserError(
        'Automation "triage" requires COMMENT_BODY to start with one of: "poe-code", "poe-code-agent", "@poe-code-agent".'
      )
    );
  });
});
