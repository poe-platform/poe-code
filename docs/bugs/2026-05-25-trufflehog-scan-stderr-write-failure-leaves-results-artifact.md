# TruffleHog Scan Stderr Write Failure Leaves Results Artifact

## Summary

The GitHub Workflows `scan-for-secrets` handler writes TruffleHog JSONL results before it writes the accompanying stderr artifact. If the stderr-file write fails, the command rejects after retaining the results file, leaving an incomplete scan-artifact bundle for later workflow steps or diagnostics.

## Reproduction

Create a disposable probe at `packages/github-workflows/src/exec/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";

const volume = new Volume();
volume.mkdirSync("/tmp", { recursive: true });
const fs = createFsFromVolume(volume).promises;

vi.mock("node:fs/promises", () => ({
  appendFile: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(async (filePath: string, content: string) => {
    if (filePath === "/tmp/trufflehog-stderr.log") {
      throw new Error("injected stderr write failure");
    }
    await fs.writeFile(filePath, content, "utf8");
  })
}));

const { runTruffleHogPrScanCommand } = await import("./trufflehog-pr-scan.js");

describe("TruffleHog scan partial artifact probe", () => {
  it("leaves results published when writing stderr artifact fails", async () => {
    const envValues = new Map([
      ["BASE_SHA", "base"],
      ["HEAD_SHA", "head"],
      ["RESULTS", "verified"],
      ["TRUFFLEHOG_IMAGE", "trufflehog:test"]
    ]);

    await expect(runTruffleHogPrScanCommand(
      "scan-for-secrets",
      { get: (key) => envValues.get(key) },
      {
        cwd: "/repo",
        runner: vi.fn().mockResolvedValue({
          exitCode: 0,
          stdout: '{"DetectorName":"OpenAI"}\n',
          stderr: "warning\n"
        })
      }
    )).rejects.toThrow("injected stderr write failure");

    await expect(fs.readFile("/tmp/trufflehog-results.jsonl", "utf8")).resolves.toBe(
      '{"DetectorName":"OpenAI"}\n'
    );
    await expect(fs.readFile("/tmp/trufflehog-stderr.log", "utf8")).rejects.toThrow();
  });
});
```

Run:

```sh
npm exec -- vitest run packages/github-workflows/src/exec/__probe__.test.ts --reporter verbose
```

The probe passes, proving that the first artifact is persisted before the later required write rejects. Remove the disposable probe afterward.

## Observed Behavior

`runTruffleHogPrScanCommand("scan-for-secrets", ...)` rejects with `injected stderr write failure`, but `/tmp/trufflehog-results.jsonl` already contains the scan output while `/tmp/trufflehog-stderr.log` does not exist. Output variables are not reached because the exception occurs before they are appended.

## Expected Behavior

Publishing the scan's result and stderr artifacts should be atomic from the workflow's perspective, or failed publication should remove files already written before reporting failure. A rejected scan-artifact step should not leave only one artifact from the attempted bundle behind.

## Impact

Subsequent troubleshooting or retry logic can discover stale results from a failed scan attempt without its paired stderr context or GitHub outputs. This makes failed runs appear partially successful and risks later steps or humans acting on incomplete evidence from an aborted workflow action.
