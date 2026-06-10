import { describe, expect, it } from "vitest";

import {
  isHarnessSpawnErrorRetryable,
  isHarnessSpawnResultRetryable
} from "./harness-spawn-retry.js";

describe("harness spawn retry policy", () => {
  it.each([
    'Unknown service "missing".',
    'Unknown agent "missing".',
    "No API key found.",
    "Invalid API key.",
    "Request failed: HTTP 401 Unauthorized.",
    'Agent "codex" has no spawn config.',
    'Agent "codex" does not support ACP spawn.',
    "Gemini CLI spawn requires an active configured provider.",
    "codex CLI binary not found on PATH.",
    "spawnAgent result exitCode must be a finite number."
  ])("classifies the permanent error %s", (message) => {
    expect(isHarnessSpawnErrorRetryable(new Error(message))).toBe(false);
  });

  it.each(["Request failed: HTTP 500.", "network connection reset", "sandbox unavailable"])(
    "classifies the transient error %s",
    (message) => {
      expect(isHarnessSpawnErrorRetryable(new Error(message))).toBe(true);
    }
  );

  it("retries only transient retryable exit codes", () => {
    expect(
      isHarnessSpawnResultRetryable({ exitCode: 1, stderr: "network reset", summary: "" })
    ).toBe(true);
    expect(
      isHarnessSpawnResultRetryable({ exitCode: 1, stderr: "Invalid API key.", summary: "" })
    ).toBe(false);
    expect(
      isHarnessSpawnResultRetryable({ exitCode: 2, stderr: "network reset", summary: "" })
    ).toBe(false);
  });

  it("reads sandbox-shaped errors", () => {
    expect(isHarnessSpawnErrorRetryable({ message: 'Unknown service "missing".' })).toBe(false);
  });
});
