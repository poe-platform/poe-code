import { describe, expect, it, vi } from "vitest";
import { prepareSafeBashUnitBuild } from "./prepare-safe-bash-unit-build.mjs";

const ci = {
  GITHUB_ACTIONS: "true",
  GITHUB_RUN_ID: "37262445969",
  GITHUB_RUN_ATTEMPT: "2",
  GITHUB_SHA: "310627a6f9278c3266f14fd775ffabcaace717d4",
  TURBO_FORCE: "true"
};
const receipt = `${ci.GITHUB_RUN_ID}:${ci.GITHUB_RUN_ATTEMPT}:${ci.GITHUB_SHA}`;

describe("Safe Bash unit build prerequisite", () => {
  it.each([{}, ci])("builds without a reuse receipt in %j", (environment) => {
    const spawn = vi.fn(() => ({ status: 0 }));
    expect(prepareSafeBashUnitBuild("/repo", { environment, spawn })).toBe(0);
    expect(spawn).toHaveBeenCalledExactlyOnceWith("npm", ["--prefix", "/repo", "run", "build", "--workspaces=false"], {
      cwd: "/repo", env: environment, stdio: "inherit"
    });
  });

  it("uses the invoking npm CLI when available and preserves build controls", () => {
    const environment = { ...ci, npm_execpath: "/npm/bin/npm-cli.js" };
    const spawn = vi.fn(() => ({ status: 0 }));
    expect(prepareSafeBashUnitBuild("/repo", { environment, spawn })).toBe(0);
    expect(spawn).toHaveBeenCalledExactlyOnceWith(process.execPath, [environment.npm_execpath, "--prefix", "/repo", "run", "build", "--workspaces=false"], {
      cwd: "/repo", env: environment, stdio: "inherit"
    });
  });

  it("reuses an attested same-run build without modifying cache controls", () => {
    const environment = Object.freeze({ ...ci, POE_SAFE_BASH_VERIFIED_BUILD_REUSE: receipt });
    const spawn = vi.fn(() => ({ status: 0 }));
    expect(prepareSafeBashUnitBuild("/repo", { environment, spawn })).toBe(0);
    expect(spawn).not.toHaveBeenCalled();
    expect(environment.TURBO_FORCE).toBe("true");
  });

  it.each([
    ["GITHUB_ACTIONS", undefined], ["GITHUB_ACTIONS", "false"],
    ["GITHUB_RUN_ID", undefined], ["GITHUB_RUN_ID", ""], ["GITHUB_RUN_ID", "0"], ["GITHUB_RUN_ID", "123x"], ["GITHUB_RUN_ID", "123\n"],
    ["GITHUB_RUN_ATTEMPT", undefined], ["GITHUB_RUN_ATTEMPT", ""], ["GITHUB_RUN_ATTEMPT", "0"], ["GITHUB_RUN_ATTEMPT", "1.0"], ["GITHUB_RUN_ATTEMPT", "2\n"],
    ["GITHUB_SHA", undefined], ["GITHUB_SHA", ""], ["GITHUB_SHA", "310627a6"], ["GITHUB_SHA", "z".repeat(40)], ["GITHUB_SHA", `${ci.GITHUB_SHA}\n`]
  ])("rejects supplied reuse with invalid %s=%s", (field, value) => {
    const identifiers = { ...ci, [field]: value };
    const environment = { ...identifiers, POE_SAFE_BASH_VERIFIED_BUILD_REUSE: `${identifiers.GITHUB_RUN_ID}:${identifiers.GITHUB_RUN_ATTEMPT}:${identifiers.GITHUB_SHA}` };
    const spawn = vi.fn(() => ({ status: 0 }));
    expect(() => prepareSafeBashUnitBuild("/repo", { environment, spawn })).toThrow("Invalid verified build reuse receipt");
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([
    "", "::", "true", `${ci.GITHUB_RUN_ID}:${ci.GITHUB_RUN_ATTEMPT}`, `${receipt}:extra`,
    `1:${ci.GITHUB_RUN_ATTEMPT}:${ci.GITHUB_SHA}`, `${ci.GITHUB_RUN_ID}:1:${ci.GITHUB_SHA}`,
    `${ci.GITHUB_RUN_ID}:${ci.GITHUB_RUN_ATTEMPT}:${"a".repeat(40)}`, `${receipt}\n`
  ])("rejects malformed or mismatched receipt %j", (value) => {
    const spawn = vi.fn(() => ({ status: 0 }));
    expect(() => prepareSafeBashUnitBuild("/repo", {
      environment: { ...ci, POE_SAFE_BASH_VERIFIED_BUILD_REUSE: value }, spawn
    })).toThrow("Invalid verified build reuse receipt");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("rejects empty identifiers even when the receipt matches them", () => {
    const spawn = vi.fn(() => ({ status: 0 }));
    expect(() => prepareSafeBashUnitBuild("/repo", {
      environment: { GITHUB_ACTIONS: "true", GITHUB_RUN_ID: "", GITHUB_RUN_ATTEMPT: "", GITHUB_SHA: "", POE_SAFE_BASH_VERIFIED_BUILD_REUSE: "::" }, spawn
    })).toThrow("Invalid verified build reuse receipt");
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([0, 7, null])("propagates the build result %s", (status) => {
    expect(prepareSafeBashUnitBuild("/repo", { environment: {}, spawn: () => ({ status }) })).toBe(status ?? 1);
  });

  it("propagates a failure to start the build", () => {
    const error = new Error("npm unavailable");
    expect(() => prepareSafeBashUnitBuild("/repo", { environment: {}, spawn: () => ({ error }) })).toThrow(error);
  });
});
