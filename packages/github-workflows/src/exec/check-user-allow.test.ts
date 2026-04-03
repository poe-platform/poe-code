import { describe, expect, it } from "vitest";
import { UserError } from "@poe-code/cmdkit";
import { checkUserAllow } from "./check-user-allow.js";

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
