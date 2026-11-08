import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import {
  parseTruffleHogFindings,
  renderTruffleHogComment,
  renderTruffleHogFindingsTable,
  runTruffleHogPrScanCommand,
  uniqueTruffleHogFindings
} from "./trufflehog-pr-scan.js";
import { workflowSubprocessTimeoutMs } from "../subprocess-timeout.js";

function env(values: Record<string, string>): { get(key: string): string | undefined } {
  return { get: (key) => values[key] };
}

function createTestFileSystem(files: Record<string, string> = {}) {
  const volume = Volume.fromJSON(files, "/");
  volume.mkdirSync("/tmp", { recursive: true });
  volume.mkdirSync("/github", { recursive: true });
  return { volume, fs: createFsFromVolume(volume).promises };
}

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

const finding = JSON.stringify({
  DetectorName: "OpenAI",
  SourceMetadata: { Data: { Git: { file: "src/config.ts", line: 12 } } }
});

const scanEnv = {
  BASE_SHA: "base",
  HEAD_SHA: "head",
  RESULTS: "verified,unknown,unverified",
  TRUFFLEHOG_IMAGE: "trufflehog:test"
};

const advisoryEnv = {
  GH_TOKEN: "token",
  HEAD_SHA: "head",
  MAX_FINDINGS: "10",
  PR_NUMBER: "1",
  REPOSITORY: "org/repo"
};

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

  it.each([-1, 0, 1.5])("rejects invalid maxFindings value %s", (maxFindings) => {
    expect(() =>
      renderTruffleHogFindingsTable(
        [{ detector: "OpenAI", filePath: "src/config.ts", lineNumber: 12, status: "unverified" }],
        { repository: "poe-platform/poe-code", headSha: "abc123", maxFindings }
      )
    ).toThrow("maxFindings must be a positive integer.");
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

  it("rejects symlinked scan artifacts without overwriting their targets", async () => {
    const { volume, fs } = createTestFileSystem({
      "/outside-results.jsonl": "original results",
      "/outside-stderr.log": "original stderr"
    });
    volume.symlinkSync("/outside-results.jsonl", "/tmp/trufflehog-results.jsonl");
    volume.symlinkSync("/outside-stderr.log", "/tmp/trufflehog-stderr.log");

    await expect(
      runTruffleHogPrScanCommand("scan-for-secrets", env(scanEnv), {
        fs,
        runner: vi.fn().mockResolvedValue({ exitCode: 1, stdout: finding, stderr: "scanner stderr" })
      })
    ).rejects.toThrow("symbolic link");

    await expect(fs.readFile("/outside-results.jsonl", "utf8")).resolves.toBe("original results");
    await expect(fs.readFile("/outside-stderr.log", "utf8")).resolves.toBe("original stderr");
  });

  it("runs the Docker scan subprocess with the workflow timeout", async () => {
    const { fs } = createTestFileSystem();
    const runner = vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

    await runTruffleHogPrScanCommand("scan-for-secrets", env(scanEnv), {
      cwd: "/repo",
      fs,
      runner
    });

    expect(runner).toHaveBeenCalledWith(
      "docker",
      expect.any(Array),
      expect.objectContaining({
        cwd: "/repo",
        timeoutMs: workflowSubprocessTimeoutMs
      })
    );
  });

  it("rejects symlinked advisory results without publishing external findings", async () => {
    const { volume, fs } = createTestFileSystem({ "/outside-results.jsonl": `${finding}\n` });
    volume.symlinkSync("/outside-results.jsonl", "/tmp/trufflehog-results.jsonl");
    const runner = vi.fn();

    await expect(
      runTruffleHogPrScanCommand("report-advisory-result", env(advisoryEnv), { fs, runner })
    ).rejects.toThrow("symbolic link");

    expect(runner).not.toHaveBeenCalled();
  });

  it("rejects a symlinked GitHub output without appending outside workflow state", async () => {
    const { volume, fs } = createTestFileSystem({ "/outside-output": "original output" });
    volume.symlinkSync("/outside-output", "/github/output");

    await expect(
      runTruffleHogPrScanCommand("scan-for-secrets", env({ ...scanEnv, GITHUB_OUTPUT: "/github/output" }), {
        fs,
        runner: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" })
      })
    ).rejects.toThrow("symbolic link");

    await expect(fs.readFile("/outside-output", "utf8")).resolves.toBe("original output");
  });

  it.each(["-1", "0", "1.5", "0x2", "1e2", " 2 "])(
    "rejects invalid MAX_FINDINGS count %s",
    async (maxFindings) => {
      const { fs } = createTestFileSystem({ "/tmp/trufflehog-results.jsonl": `${finding}\n` });
      const runner = vi.fn();

      await expect(
        runTruffleHogPrScanCommand(
          "report-advisory-result",
          env({ ...advisoryEnv, MAX_FINDINGS: maxFindings }),
          { fs, runner }
        )
      ).rejects.toThrow("MAX_FINDINGS must be a positive integer.");

      expect(runner).not.toHaveBeenCalled();
    }
  );

  it("runs GitHub API subprocesses with the workflow timeout", async () => {
    const { fs } = createTestFileSystem({ "/tmp/trufflehog-results.jsonl": "" });
    const runner = vi.fn().mockResolvedValue({ exitCode: 0, stdout: "[]", stderr: "" });

    await runTruffleHogPrScanCommand("report-advisory-result", env(advisoryEnv), {
      fs,
      runner
    });

    expect(runner).toHaveBeenCalledWith(
      "gh",
      expect.any(Array),
      expect.objectContaining({
        env: { GH_TOKEN: "token" },
        timeoutMs: workflowSubprocessTimeoutMs
      })
    );
  });

  it("validates the step summary before posting an advisory comment", async () => {
    const { volume, fs } = createTestFileSystem({
      "/tmp/trufflehog-results.jsonl": `${finding}\n`,
      "/outside-summary.md": "original summary"
    });
    volume.symlinkSync("/outside-summary.md", "/github/summary.md");
    const runner = vi.fn();

    await expect(
      runTruffleHogPrScanCommand(
        "report-advisory-result",
        env({ ...advisoryEnv, GITHUB_STEP_SUMMARY: "/github/summary.md" }),
        { fs, runner }
      )
    ).rejects.toThrow("symbolic link");

    expect(runner).not.toHaveBeenCalled();
    await expect(fs.readFile("/outside-summary.md", "utf8")).resolves.toBe("original summary");
  });

  it("does not post an advisory comment when writing its summary fails", async () => {
    const { fs } = createTestFileSystem({
      "/tmp/trufflehog-results.jsonl": `${finding}\n`,
      "/github/summary.md": ""
    });
    const failingFs = {
      ...fs,
      appendFile: vi.fn(async () => {
        throw new Error("injected summary failure");
      })
    };
    const runner = vi.fn();

    await expect(
      runTruffleHogPrScanCommand(
        "report-advisory-result",
        env({ ...advisoryEnv, GITHUB_STEP_SUMMARY: "/github/summary.md" }),
        { fs: failingFs, runner }
      )
    ).rejects.toThrow("injected summary failure");

    expect(runner).not.toHaveBeenCalled();
  });

  it("does not publish one scan artifact when staging the other fails", async () => {
    const { fs } = createTestFileSystem();
    let temporaryPath: string | undefined;
    const failingFs = {
      ...fs,
      writeFile: vi.fn(async (
        path: string,
        content: string,
        options: { encoding: BufferEncoding; flag?: string }
      ) => {
        if (path.startsWith("/tmp/trufflehog-stderr.log.")) {
          temporaryPath = path;
          await fs.writeFile(path, "partial stderr\n", options);
          throw new Error("injected stderr write failure");
        }
        await fs.writeFile(path, content, options);
      })
    };

    await expect(
      runTruffleHogPrScanCommand("scan-for-secrets", env(scanEnv), {
        fs: failingFs,
        runner: vi.fn().mockResolvedValue({ exitCode: 1, stdout: finding, stderr: "scanner stderr" })
      })
    ).rejects.toThrow("injected stderr write failure");

    await expect(fs.readFile("/tmp/trufflehog-results.jsonl", "utf8")).rejects.toThrow();
    await expect(fs.readFile("/tmp/trufflehog-stderr.log", "utf8")).rejects.toThrow();
    expect(temporaryPath).toMatch(/^\/tmp\/trufflehog-stderr\.log\..+\.tmp$/);
    await expect(fs.readFile(temporaryPath ?? "", "utf8")).rejects.toThrow();
  });

  it("removes partial staged scan artifacts when write errors only inherit existing-path codes", async () => {
    const { fs } = createTestFileSystem();
    let temporaryPath: string | undefined;
    const failingFs = {
      ...fs,
      writeFile: vi.fn(async (
        path: string,
        content: string,
        options: { encoding: BufferEncoding; flag?: string }
      ) => {
        if (path.startsWith("/tmp/trufflehog-stderr.log.")) {
          temporaryPath = path;
          await fs.writeFile(path, "partial stderr\n", options);
          throw new Error("injected stderr write failure");
        }
        await fs.writeFile(path, content, options);
      })
    };

    await withObjectPrototypeProperties({ code: "EEXIST" }, async () => {
      await expect(
        runTruffleHogPrScanCommand("scan-for-secrets", env(scanEnv), {
          fs: failingFs,
          runner: vi.fn().mockResolvedValue({ exitCode: 1, stdout: finding, stderr: "scanner stderr" })
        })
      ).rejects.toThrow("injected stderr write failure");
    });

    expect(temporaryPath).toMatch(/^\/tmp\/trufflehog-stderr\.log\..+\.tmp$/);
    await expect(fs.readFile(temporaryPath ?? "", "utf8")).rejects.toThrow();
  });

  it("does not hide symbolic-link check failures with inherited missing-file codes", async () => {
    const { fs } = createTestFileSystem({ "/github/output": "" });
    const failingFs = {
      ...fs,
      lstat: vi.fn(async (path: string) => {
        if (path === "/github/output") {
          throw new Error("output lstat denied");
        }

        return await fs.lstat(path);
      })
    };

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(
        runTruffleHogPrScanCommand("scan-for-secrets", env({ ...scanEnv, GITHUB_OUTPUT: "/github/output" }), {
          fs: failingFs,
          runner: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" })
        })
      ).rejects.toThrow("output lstat denied");
    });
  });

  it("does not remove a colliding staged scan artifact symlink", async () => {
    const { fs, volume } = createTestFileSystem({ "/outside-results.tmp": "outside-state\n" });
    let temporaryPath: string | undefined;
    const failingFs = {
      ...fs,
      writeFile: vi.fn(async (
        path: string,
        content: string,
        options: { encoding: BufferEncoding; flag?: string }
      ) => {
        if (path.startsWith("/tmp/trufflehog-results.jsonl.") && path.endsWith(".tmp")) {
          temporaryPath = path;
          volume.symlinkSync("/outside-results.tmp", path);
          expect(options).toEqual({ encoding: "utf8", flag: "wx" });
        }

        await fs.writeFile(path, content, options);
      })
    };

    await expect(
      runTruffleHogPrScanCommand("scan-for-secrets", env(scanEnv), {
        fs: failingFs,
        runner: vi.fn().mockResolvedValue({ exitCode: 1, stdout: finding, stderr: "scanner stderr" })
      })
    ).rejects.toThrow();

    expect(temporaryPath).toBeDefined();
    expect(volume.readFileSync("/outside-results.tmp", "utf8")).toBe("outside-state\n");
    expect(volume.lstatSync(temporaryPath as string).isSymbolicLink()).toBe(true);
    await expect(fs.readFile("/tmp/trufflehog-results.jsonl", "utf8")).rejects.toThrow();
    await expect(fs.readFile("/tmp/trufflehog-stderr.log", "utf8")).rejects.toThrow();
  });

  it("publishes scan outputs in one append operation", async () => {
    const { fs } = createTestFileSystem({ "/github/output": "" });
    const failingFs = {
      ...fs,
      appendFile: vi.fn(async () => {
        throw new Error("injected output failure");
      })
    };

    await expect(
      runTruffleHogPrScanCommand("scan-for-secrets", env({ ...scanEnv, GITHUB_OUTPUT: "/github/output" }), {
        fs: failingFs,
        runner: vi.fn().mockResolvedValue({ exitCode: 1, stdout: finding, stderr: "" })
      })
    ).rejects.toThrow("injected output failure");

    expect(failingFs.appendFile).toHaveBeenCalledTimes(1);
    await expect(fs.readFile("/github/output", "utf8")).resolves.toBe("");
  });
});
