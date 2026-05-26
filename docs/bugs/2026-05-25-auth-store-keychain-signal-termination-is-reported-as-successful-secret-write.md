# Keychain signal termination is reported as successful secret write

## Summary

`auth-store` treats a `security` subprocess that is killed by a signal as a successful keychain operation. Node reports signal termination through `close` with `code === null`, but `runSecurityCommand()` converts that to `exitCode: 0`; as a result, `KeychainStore.set()` resolves even though the credential helper did not complete the write.

## Reproduction

1. From the repository root, create a temporary `security` executable that terminates itself and a disposable Vitest probe:

   ```sh
   probe_dir=$(mktemp -d /tmp/auth-store-security-probe.XXXXXX)
   cat > "$probe_dir/security" <<'EOF'
   #!/bin/sh
   kill -TERM $$
   EOF
   chmod +x "$probe_dir/security"

   cat > packages/auth-store/src/__probe__.test.ts <<'EOF'
   import { describe, expect, it } from "vitest";
   import { KeychainStore } from "./keychain-store.js";

   describe("KeychainStore killed security helper", () => {
     it("resolves set when the security subprocess is terminated by a signal", async () => {
       const store = new KeychainStore({ service: "poe-code", account: "provider:poe" });
       await expect(store.set("secret-value")).resolves.toBeUndefined();
     });
   });
   EOF
   ```

2. Run the probe using the killed helper in place of the macOS `security` command:

   ```sh
   PATH="$probe_dir:$PATH" npm exec -- vitest run packages/auth-store/src/__probe__.test.ts --reporter verbose
   rm -f packages/auth-store/src/__probe__.test.ts
   rm -rf "$probe_dir"
   ```

3. The disposable probe passes:

   ```text
   ✓ packages/auth-store/src/__probe__.test.ts > KeychainStore killed security helper > resolves set when the security subprocess is terminated by a signal

   Test Files  1 passed (1)
        Tests  1 passed (1)
   ```

## Observed Behavior

`KeychainStore.set("secret-value")` resolves successfully after its `security add-generic-password` subprocess is killed with `SIGTERM`. In `packages/auth-store/src/keychain-store.ts:130`, the `close` handler receives a `null` exit code for signal termination, and `packages/auth-store/src/keychain-store.ts:134` maps that condition to `exitCode: 0`. The write path at `packages/auth-store/src/keychain-store.ts:52` through `packages/auth-store/src/keychain-store.ts:70` therefore treats termination as successful storage.

## Expected Behavior

A keychain command that terminates by signal should be treated as failed. `KeychainStore.set()` should reject unless `security` completed with a true successful exit status, rather than reporting a credential write that may never have happened.

## Impact

Callers can report successful login or credential persistence after the platform keychain helper was terminated before saving the secret. Follow-up operations may find no credential while the user and application have already proceeded on the assumption that secure storage succeeded.
