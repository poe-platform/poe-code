# Auth store Keychain set exposes plaintext secret in process arguments

## Summary

The macOS Keychain backend in `auth-store` writes credentials by launching the `security` command with the secret supplied directly as the value following `-w` in its argument vector. This makes every stored API key visible in the spawned process command line while the write is executing, despite using Keychain specifically to keep credentials out of ordinary plaintext storage paths.

## Reproduction

Add the following temporary probe as `packages/auth-store/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { KeychainStore } from "./keychain-store.js";

describe("keychain command argument secrecy", () => {
  it("passes the plaintext secret as a visible security CLI argument", async () => {
    const runCommand = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const store = new KeychainStore({ service: "poe-code", account: "poe", runCommand });

    await store.set("sk-secret-visible-in-argv");
    const args = runCommand.mock.calls[0]?.[1];
    console.log(JSON.stringify({ command: runCommand.mock.calls[0]?.[0], args }));
    expect(args).toContain("sk-secret-visible-in-argv");
    expect(args).toEqual([
      "add-generic-password", "-s", "poe-code", "-a", "poe", "-w", "sk-secret-visible-in-argv", "-U"
    ]);
  });
});
```

Run the probe and then remove it:

```sh
./node_modules/.bin/vitest run packages/auth-store/src/__probe__.test.ts --reporter verbose
rm -f packages/auth-store/src/__probe__.test.ts
```

The reproduction passes and prints the launched command arguments including the plaintext credential:

```text
{"command":"security","args":["add-generic-password","-s","poe-code","-a","poe","-w","sk-secret-visible-in-argv","-U"]}
✓ packages/auth-store/src/__probe__.test.ts > keychain command argument secrecy > passes the plaintext secret as a visible security CLI argument
```

## Observed Behavior

`KeychainStore.set()` constructs `security add-generic-password -s <service> -a <account> -w <value> -U` and sends that array to `runSecurityCommand()`, whose default implementation calls `spawn(command, args, ...)`. The credential is therefore a literal process argument for the duration of each Keychain update.

## Expected Behavior

Credential persistence through the Keychain backend should avoid exposing plaintext API keys in child-process argument vectors. The secret should be supplied through a non-command-line channel accepted by the platform tool, or stored through a native API that does not make it observable as argv content.

## Impact

Other local processes with command-line inspection access, debugging/telemetry wrappers, process auditing utilities, or crash-diagnostic tooling can capture an API key during Keychain storage or rotation. The secure backend consequently introduces a transient plaintext credential disclosure path during normal login and credential update operations.
