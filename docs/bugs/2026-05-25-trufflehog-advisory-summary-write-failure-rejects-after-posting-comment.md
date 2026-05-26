# TruffleHog Advisory Summary Write Failure Rejects After Posting Comment

## Summary

The GitHub-workflows `report-advisory-result` command posts or updates the TruffleHog pull-request advisory comment before appending its local `GITHUB_STEP_SUMMARY` output. If the summary append fails, the command rejects after the externally visible PR comment has already been committed.

## Reproduction

Create a disposable Vitest probe at `packages/github-workflows/src/exec/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    async appendFile(targetPath: string, content: string, encoding?: BufferEncoding) {
      if (targetPath === "/summary.md") {
        throw new Error("summary disk full");
      }
      await fs.promises.appendFile(targetPath, content, encoding);
    }
  };
});

const { runTruffleHogPrScanCommand } = await import("./trufflehog-pr-scan.js");

describe("trufflehog advisory summary failure", () => {
  it("rejects after the pull request advisory comment is already posted", async () => {
    vol.reset();
    vol.writeFileSync(
      "/results.jsonl",
      JSON.stringify({ DetectorName: "Secret", Verified: true, SourceMetadata: { Data: { Git: { file: "src/a.ts", line: 3 } } } }) + "\n"
    );
    const runner = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "[]", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "{}", stderr: "", exitCode: 0 });
    const values: Record<string, string> = {
      GH_TOKEN: "token",
      HEAD_SHA: "head",
      MAX_FINDINGS: "5",
      PR_NUMBER: "7",
      REPOSITORY: "acme/app",
      TRUFFLEHOG_RESULTS_FILE: "/results.jsonl",
      GITHUB_STEP_SUMMARY: "/summary.md"
    };

    await expect(
      runTruffleHogPrScanCommand("report-advisory-result", { get: (key) => values[key] }, { runner })
    ).rejects.toThrow("summary disk full");

    expect(runner).toHaveBeenNthCalledWith(
      2,
      "gh",
      expect.arrayContaining(["--method", "POST"]),
      { env: { GH_TOKEN: "token" } }
    );
  });
});
```

Run:

```sh
npm exec -- vitest run packages/github-workflows/src/exec/__probe__.test.ts --reporter verbose
```

The probe passes and emits the annotation/error messages before the rejection:

```text
✓ packages/github-workflows/src/exec/__probe__.test.ts > trufflehog advisory summary failure > rejects after the pull request advisory comment is already posted
```

Remove the disposable probe after validation.

## Observed Behavior

`reportAdvisoryResult()` reads findings, emits annotations, and performs its `gh api` comment POST or PATCH at `packages/github-workflows/src/exec/trufflehog-pr-scan.ts:175` through `packages/github-workflows/src/exec/trufflehog-pr-scan.ts:202`. Only after that API mutation succeeds does it append the workflow step summary at `packages/github-workflows/src/exec/trufflehog-pr-scan.ts:204` through `packages/github-workflows/src/exec/trufflehog-pr-scan.ts:218`, via the direct append in `packages/github-workflows/src/exec/trufflehog-pr-scan.ts:289` through `packages/github-workflows/src/exec/trufflehog-pr-scan.ts:294`. In the probe, the comment POST completes, summary writing throws `summary disk full`, and the public command rejects.

## Expected Behavior

Failure to write an auxiliary workflow summary should not make an already posted or updated advisory comment appear as an uncommitted operation. The command should write local auxiliary output before mutating the PR, treat summary output as best-effort after a successful advisory publication, or return an explicit partial-success result.

## Impact

A transient runner filesystem failure can cause a failed workflow step to leave a real PR advisory comment behind. Retries can create confusing duplicate or repeated updates, maintainers may see an advisory from a step marked failed, and automation cannot reliably tell whether external GitHub state changed when the command rejects.
