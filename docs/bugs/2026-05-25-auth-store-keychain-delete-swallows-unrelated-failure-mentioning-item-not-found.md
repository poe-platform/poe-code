# Auth store Keychain delete swallows unrelated failure mentioning item not found

## Summary

The exported `auth-store` `KeychainStore.delete()` method treats a failed macOS `security` command as successful whenever its stdout or stderr contains the broad substring `item not found`, regardless of the actual exit code or failure context. An authorization or operational error that merely mentions that phrase is silently converted into a completed credential deletion.

## Reproduction

Create the disposable probe `packages/auth-store/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { KeychainStore } from "./keychain-store.js";

describe("keychain not-found diagnostic matching", () => {
  it("reports successful deletion for an unrelated security failure mentioning item not found", async () => {
    const store = new KeychainStore({
      service: "poe-code",
      account: "api-key",
      runCommand: async () => ({
        stdout: "",
        stderr: "authorization denied while resolving item not found in audit context",
        exitCode: 1
      })
    });

    const outcome = await store.delete().then(() => "resolved", (error) => String(error));
    console.log(JSON.stringify({ outcome }));
    expect(outcome).toBe("resolved");
  });
});
```

Run the targeted test and remove the disposable probe:

```sh
npm exec -- vitest run packages/auth-store/src/__probe__.test.ts --reporter verbose
rm -f packages/auth-store/src/__probe__.test.ts
```

The test passes, showing that the non-not-found failure is reported as successful deletion:

```text
{"outcome":"resolved"}
✓ packages/auth-store/src/__probe__.test.ts > keychain not-found diagnostic matching > reports successful deletion for an unrelated security failure mentioning item not found
```

## Observed Behavior

`KeychainStore.delete()` resolves without error when `isKeychainEntryNotFound(result)` is true at `packages/auth-store/src/keychain-store.ts:72` through `packages/auth-store/src/keychain-store.ts:84`. That helper treats exit code `44` as absence, but also accepts any command output containing `"item not found"`, `"could not be found"`, or `"errsecitemnotfound"` at `packages/auth-store/src/keychain-store.ts:152` through `packages/auth-store/src/keychain-store.ts:164`, without requiring the expected Keychain-not-found exit status. The probe returns exit code `1` and an authorization-denied diagnostic containing incidental `item not found` text, yet `delete()` resolves normally.

## Expected Behavior

Credential deletion should suppress only an actual absent-item result from the Keychain command. Other failed command executions must reject, even when their diagnostic text happens to mention a not-found phrase in a different context.

## Impact

Logout or credential cleanup flows can report successful Keychain deletion while a real authorization, policy, or command failure prevented the operation. The sensitive credential may remain stored and active even though callers believe it was removed, leaving users unable to trust logout status and masking operational failures that require remediation.
