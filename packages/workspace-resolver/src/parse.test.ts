import { describe, expect, it } from "vitest";
import { parseLocator } from "./parse.js";

describe("parseLocator", () => {
  it("treats plain filesystem paths as local locators", () => {
    expect(parseLocator("./src")).toEqual({ scheme: "local", path: "./src" });
    expect(parseLocator("/tmp/project")).toEqual({ scheme: "local", path: "/tmp/project" });
  });

  it("parses github locators with owner and repo", () => {
    expect(parseLocator("github://poe-platform/poe-code")).toEqual({
      scheme: "github",
      owner: "poe-platform",
      repo: "poe-code"
    });
  });

  it("parses github locators with a ref and subdir", () => {
    expect(parseLocator("github://poe-platform/poe-code#beta:packages/process-runner")).toEqual({
      scheme: "github",
      owner: "poe-platform",
      repo: "poe-code",
      ref: "beta",
      subdir: "packages/process-runner"
    });
  });

  it("parses github locators with ref only (no subdir)", () => {
    expect(parseLocator("github://owner/repo#v1.0.0")).toEqual({
      scheme: "github",
      owner: "owner",
      repo: "repo",
      ref: "v1.0.0"
    });
  });

  it("parses github locators with subdir via path segments", () => {
    expect(parseLocator("github://owner/repo/packages/core")).toEqual({
      scheme: "github",
      owner: "owner",
      repo: "repo",
      subdir: "packages/core"
    });
  });

  it("parses github locators with deeply nested subdir via path", () => {
    expect(parseLocator("github://owner/repo/a/b/c")).toEqual({
      scheme: "github",
      owner: "owner",
      repo: "repo",
      subdir: "a/b/c"
    });
  });

  it("parses github locators with subdir in fragment but no ref", () => {
    expect(parseLocator("github://owner/repo#:subdir")).toEqual({
      scheme: "github",
      owner: "owner",
      repo: "repo",
      subdir: "subdir"
    });
  });

  it("ignores trailing colon in fragment when subdir is empty", () => {
    expect(parseLocator("github://owner/repo#main:")).toEqual({
      scheme: "github",
      owner: "owner",
      repo: "repo",
      ref: "main"
    });
  });

  it("ignores empty fragment", () => {
    expect(parseLocator("github://owner/repo#")).toEqual({
      scheme: "github",
      owner: "owner",
      repo: "repo"
    });
  });

  it("rejects github locators with subdir in both path and fragment", () => {
    expect(() => parseLocator("github://owner/repo/path-sub#ref:frag-sub")).toThrow(
      'Invalid github workspace locator'
    );
  });

  it("rejects github locators with only owner", () => {
    expect(() => parseLocator("github://owner")).toThrow('Invalid github workspace locator');
  });

  it("rejects github locators with empty authority", () => {
    expect(() => parseLocator("github://")).toThrow('Invalid github workspace locator');
  });

  it("strips leading/trailing whitespace", () => {
    expect(parseLocator("  ./src  ")).toEqual({ scheme: "local", path: "./src" });
  });

  it("treats empty string as local", () => {
    expect(parseLocator("")).toEqual({ scheme: "local", path: "" });
  });

  it("treats Windows drive paths as local", () => {
    expect(parseLocator("C:\\Users\\me\\repo")).toEqual({
      scheme: "local",
      path: "C:\\Users\\me\\repo"
    });
  });

  it("parses ssh locators with port", () => {
    expect(parseLocator("ssh://deploy@10.0.0.1:2222/var/repos/app")).toEqual({
      scheme: "ssh",
      user: "deploy",
      host: "10.0.0.1",
      port: 2222,
      path: "/var/repos/app"
    });
  });

  it("parses ssh locators without user", () => {
    expect(parseLocator("ssh://example.com/repo")).toEqual({
      scheme: "ssh",
      host: "example.com",
      path: "/repo"
    });
  });

  it("parses docker locators with image tag", () => {
    expect(parseLocator("docker://myimage:latest/workspace/app")).toEqual({
      scheme: "docker",
      container: "myimage:latest",
      path: "/workspace/app"
    });
  });

  it("rejects docker locators without a path", () => {
    expect(() => parseLocator("docker://container-only")).toThrow(
      'Invalid docker workspace locator'
    );
  });

  it("parses reserved ssh and docker schemes for future support", () => {
    expect(parseLocator("ssh://git@example.com/worktree")).toEqual({
      scheme: "ssh",
      user: "git",
      host: "example.com",
      path: "/worktree"
    });

    expect(parseLocator("docker://dev-container/workspace")).toEqual({
      scheme: "docker",
      container: "dev-container",
      path: "/workspace"
    });
  });

  it("rejects unknown locator schemes", () => {
    expect(() => parseLocator("s3://bucket/repo")).toThrow('Unsupported workspace locator scheme "s3".');
  });
});
