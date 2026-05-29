import { describe, expect, it } from "vitest";
import {
  parseTruffleHogFindings,
  renderTruffleHogComment,
  renderTruffleHogFindingsTable,
  runTruffleHogPrScanCommand,
  uniqueTruffleHogFindings
} from "./trufflehog-pr-scan.js";
import { vi } from "vitest";

describe("parseTruffleHogFindings", () => {
  it("parses git metadata and verification status from TruffleHog JSONL", () => {
    const jsonl = [
      JSON.stringify({
        DetectorName: "OpenAI",
        Verified: true,
        SourceMetadata: { Data: { Git: { file: "src/config.ts", line: 12 } } }
      }),
      JSON.stringify({
        DetectorName: "Stripe",
        VerificationError: "network unavailable",
        SourceMetadata: { Git: { File: "src/payments.ts", Line: "8" } }
      }),
      "not json"
    ].join("\n");

    expect(parseTruffleHogFindings(jsonl)).toEqual([
      {
        detector: "OpenAI",
        filePath: "src/config.ts",
        lineNumber: 12,
        status: "verified"
      },
      {
        detector: "Stripe",
        filePath: "src/payments.ts",
        lineNumber: 8,
        status: "unknown"
      }
    ]);
  });
});

describe("uniqueTruffleHogFindings", () => {
  it("deduplicates by status, detector, file, and line", () => {
    expect(
      uniqueTruffleHogFindings([
        { detector: "OpenAI", filePath: "src/config.ts", lineNumber: 12, status: "unverified" },
        { detector: "OpenAI", filePath: "src/config.ts", lineNumber: 12, status: "unverified" },
        { detector: "OpenAI", filePath: "src/config.ts", lineNumber: 13, status: "unverified" }
      ])
    ).toHaveLength(2);
  });
});

describe("renderTruffleHogFindingsTable", () => {
  it("renders concise linked findings without exposing the secret value", () => {
    expect(
      renderTruffleHogFindingsTable(
        [{ detector: "OpenAI", filePath: "src/config.ts", lineNumber: 12, status: "unverified" }],
        { repository: "poe-platform/poe-code", headSha: "abc123", maxFindings: 10 }
      )
    ).toBe(
      [
        "| Detector | Location | Verification |",
        "| --- | --- | --- |",
        "| OpenAI | [src/config.ts:12](https://github.com/poe-platform/poe-code/blob/abc123/src/config.ts#L12) | unverified |"
      ].join("\n")
    );
  });
});

describe("renderTruffleHogComment", () => {
  it("uses a singular heading for one finding", () => {
    expect(
      renderTruffleHogComment(
        [{ detector: "OpenAI", filePath: "src/config.ts", lineNumber: 12, status: "unverified" }],
        { repository: "poe-platform/poe-code", headSha: "abc123", maxFindings: 10 }
      )
    ).toContain("### TruffleHog found a possible secret");
  });

  it("uses a plural heading for multiple findings", () => {
    expect(
      renderTruffleHogComment(
        [
          { detector: "OpenAI", filePath: "src/config.ts", lineNumber: 12, status: "unverified" },
          { detector: "Stripe", filePath: "src/payments.ts", lineNumber: 8, status: "unknown" }
        ],
        { repository: "poe-platform/poe-code", headSha: "abc123", maxFindings: 10 }
      )
    ).toContain("### TruffleHog found 2 possible secrets");
  });
});

describe("runTruffleHogPrScanCommand", () => {
  it.each(["scan-for-secrets", "report-advisory-result", "clear-stale-advisory-result"] as const)(
    "previews %s without executing any runner command",
    async (command) => {
      const runner = vi.fn();
      const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await runTruffleHogPrScanCommand(command, { get: () => undefined }, { dryRun: true, runner });

      expect(runner).not.toHaveBeenCalled();
      expect(stdout).toHaveBeenCalledWith(`Dry run: would run TruffleHog operation ${command}.\n`);
      stdout.mockRestore();
    }
  );
});
