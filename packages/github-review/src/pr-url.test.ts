import { describe, expect, it } from "vitest";
import { canonicalPullRequestUrl } from "./pr-url.js";

describe("canonicalPullRequestUrl", () => {
  it("canonicalizes a pull request url", () => {
    expect(canonicalPullRequestUrl("https://github.com/acme/repo/pull/7/files")).toBe(
      "https://github.com/acme/repo/pull/7"
    );
  });

  it("rejects input that is not a pull request url and names the expected shape", () => {
    expect(() => canonicalPullRequestUrl("not-a-url")).toThrow(
      'Expected a GitHub pull request URL like https://github.com/<owner>/<repo>/pull/<number>, received "not-a-url".'
    );
  });

  it("rejects a github url that is not a pull request", () => {
    expect(() => canonicalPullRequestUrl("https://github.com/acme/repo/issues/7")).toThrow(
      "Expected a GitHub pull request URL like https://github.com/<owner>/<repo>/pull/<number>"
    );
  });
});
