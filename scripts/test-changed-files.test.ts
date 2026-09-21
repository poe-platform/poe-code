import { execFileSync } from "node:child_process";
import { beforeEach, expect, it, vi } from "vitest";
import { changedFilesSince } from "./build-workspaces.mjs";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn(), spawn: vi.fn() }));
beforeEach(() => vi.mocked(execFileSync).mockReset());

it("resolves a comparison commit and includes both rename sides and untracked files", () => {
  vi.mocked(execFileSync).mockReturnValueOnce("123abc\n")
    .mockReturnValueOnce("packages/docx/src/old.ts\0packages/docx/src/new.ts\0packages/js/src/pending.ts\0")
    .mockReturnValueOnce("packages/docx/src/new.ts\0packages/docx/src/untracked file.ts\0");
  const environment = { PATH: "/bin", CUSTOM: "unchanged" };
  expect(changedFilesSince("/repo", "HEAD~1", environment)).toEqual([
    "packages/docx/src/old.ts", "packages/docx/src/new.ts", "packages/js/src/pending.ts", "packages/docx/src/untracked file.ts"
  ]);
  expect(vi.mocked(execFileSync).mock.calls.map(call => call[1])).toEqual([
    ["rev-parse", "--verify", "--end-of-options", "HEAD~1^{commit}"],
    ["diff", "--no-renames", "--name-only", "-z", "123abc", "--"],
    ["ls-files", "--others", "--exclude-standard", "-z"]
  ]);
  for (const call of vi.mocked(execFileSync).mock.calls) expect(call[2]).toMatchObject({ cwd: "/repo", env: environment, timeout: 10000 });
});

it("fails closed on an unavailable comparison reference", () => {
  const error = new Error("invalid ref");
  vi.mocked(execFileSync).mockImplementationOnce(() => { throw error; });
  expect(() => changedFilesSince("/repo", "missing")).toThrow(error);
  expect(execFileSync).toHaveBeenCalledTimes(1);
});

it("does not invoke git for invalid references", () => {
  for (const reference of ["", "-option", "HEAD\u0000bad"]) expect(() => changedFilesSince("/repo", reference)).toThrow();
  expect(execFileSync).not.toHaveBeenCalled();
});
