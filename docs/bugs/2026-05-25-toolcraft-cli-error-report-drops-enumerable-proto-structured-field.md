# Toolcraft CLI Error Report Drops an Enumerable `__proto__` Structured Field

## Summary

The public Toolcraft `runCLI()` error-reporting path silently omits an enumerable `__proto__` property carried by a thrown `Error`. The command fails and a diagnostic report is saved successfully, but the saved report claims that the error has no structured fields even though the thrown error exposes the field as its own enumerable data.

## Reproduction

Create a disposable Vitest probe at `packages/toolcraft/src/__probe__.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return fs;
});

const { runCLI } = await import("./cli.js");

describe("toolcraft CLI error report prototype-key structured field repro", () => {
  beforeEach(() => {
    vol.reset();
    vol.fromJSON({ "/repo/package.json": JSON.stringify({ name: "fixture" }) });
    process.argv = ["node", "probe", "fail"];
    process.exitCode = undefined;
  });

  it("drops an enumerable __proto__ field from the saved structured error details", async () => {
    const error = new Error("boom");
    Object.defineProperty(error, "__proto__", {
      value: { requestId: "visible" },
      enumerable: true,
      configurable: true,
      writable: true
    });
    const root = defineGroup({
      name: "probe",
      children: [
        defineCommand({
          name: "fail",
          params: S.Object({}),
          handler: async () => {
            throw error;
          }
        })
      ]
    });

    await runCLI(root, { errorReports: true, projectRoot: "/repo" });

    const reportPath = Object.keys(vol.toJSON("/repo")).find((filePath) =>
      filePath.startsWith(path.join("/repo", ".toolcraft", "errors"))
    );
    const report = await readFile(reportPath!, "utf8");
    expect(Object.keys(error)).toContain("__proto__");
    expect(report).toContain("structured fields:\n{}");
    expect(report).not.toContain("requestId");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/toolcraft/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints that a report was saved, confirming that CLI diagnostics complete normally while the structured field is missing. Remove the disposable probe after validation.

## Observed Behavior

A command handler throws an `Error` with an own enumerable `__proto__` value `{ requestId: "visible" }`. Calling `runCLI()` with `errorReports: true` writes an error report whose `structured fields:` JSON is `{}`, and the saved text contains no `requestId`. In `packages/toolcraft/src/error-report.ts`, `ownStructuredFields()` enumerates the thrown error and copies fields into `fields = {}` using `fields[key] = ...`; when `key` is `__proto__`, the assignment changes the temporary object's prototype instead of preserving an own report field. The subsequent `JSON.stringify()` therefore serializes no diagnostic entry.

## Expected Behavior

Saved Toolcraft error reports should preserve every own enumerable structured error field, including `__proto__`, or explicitly state that a field cannot be represented instead of silently dropping diagnostic data.

## Impact

Failures carrying structured correlation data, response metadata, or debugging context under this legal property name produce incomplete saved reports. Operators can lose information needed to diagnose a failed command while Toolcraft misleadingly records an empty structured-field section.
