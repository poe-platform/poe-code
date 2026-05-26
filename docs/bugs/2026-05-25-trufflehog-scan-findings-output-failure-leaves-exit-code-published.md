# TruffleHog Scan Findings Output Failure Leaves Exit Code Published

## Summary

The GitHub Workflows `scan-for-secrets` handler appends its `exit_code` workflow output before appending `findings_count`. If publication of `findings_count` fails, the command rejects after exposing only the first output, leaving downstream workflow metadata incomplete and internally inconsistent.

## Reproduction

Create a disposable probe at `packages/github-workflows/src/exec/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";

const volume = new Volume();
volume.mkdirSync("/tmp", { recursive: true });
volume.mkdirSync("/github", { recursive: true });
const fs = createFsFromVolume(volume).promises;

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn((filePath: string, content: string) => fs.writeFile(filePath, content, "utf8")),
  appendFile: vi.fn(async (filePath: string, content: string) => {
    if (content.startsWith("findings_count=")) {
      throw new Error("injected second output failure");
    }
    const previous = await fs.readFile(filePath, "utf8").catch(() => "");
    await fs.writeFile(filePath, `${previous}${content}`, "utf8");
  })
}));

const { runTruffleHogPrScanCommand } = await import("./trufflehog-pr-scan.js");

describe("TruffleHog scan GitHub output partial publication probe", () => {
  it("leaves exit_code appended when findings_count append fails", async () => {
    const envValues = new Map([
      ["BASE_SHA", "base"],
      ["HEAD_SHA", "head"],
      ["RESULTS", "verified"],
      ["TRUFFLEHOG_IMAGE", "trufflehog:test"],
      ["GITHUB_OUTPUT", "/github/output"]
    ]);

    await expect(runTruffleHogPrScanCommand(
      "scan-for-secrets",
      { get: (key) => envValues.get(key) },
      {
        cwd: "/repo",
        runner: vi.fn().mockResolvedValue({
          exitCode: 1,
          stdout: '{"DetectorName":"OpenAI"}\n',
          stderr: ""
        })
      }
    )).rejects.toThrow("injected second output failure");

    await expect(fs.readFile("/github/output", "utf8")).resolves.toBe("exit_code=1\n");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/github-workflows/src/exec/__probe__.test.ts --reporter verbose
```

The probe passes, proving that the first GitHub output remains published when appending the second output rejects. Remove the disposable probe afterward.

## Observed Behavior

The scan command rejects with `injected second output failure`, while `GITHUB_OUTPUT` already contains `exit_code=1` and lacks any `findings_count` line. The scan artifacts were written before the output stage, but the declared workflow metadata is only partially published.

## Expected Behavior

The scan outputs should be emitted as a coherent pair or the handler should remove/avoid earlier output publication if a later required output fails. A rejected scan step should not expose an `exit_code` without its matching finding count.

## Impact

Workflow consumers can observe partial output state from a failed scan action and make decisions using an exit code without the finding-count context the action promises to expose. Retries and conditional workflow logic may then behave differently depending on which output append failed, making failure handling unreliable.
