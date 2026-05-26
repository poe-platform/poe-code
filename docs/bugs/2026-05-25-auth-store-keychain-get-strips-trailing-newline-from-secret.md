# Auth store Keychain get strips trailing newline from secret

## Summary

The exported `auth-store` Keychain backend cannot round-trip a secret whose value ends with a newline. `KeychainStore.get()` always removes one trailing line break from successful `security find-generic-password -w` output, treating it as CLI formatting even when that line break is part of the stored credential value.

## Reproduction

Create the following disposable probe at `packages/auth-store/src/__probe__.test.ts`:

```ts
import { expect, it } from "vitest";
import { KeychainStore } from "./keychain-store.js";

it("drops a trailing newline from a secret returned by Keychain", async () => {
  const store = new KeychainStore({
    service: "app",
    account: "token",
    runCommand: async () => ({
      stdout: "secret-with-newline\n\n",
      stderr: "",
      exitCode: 0
    })
  });

  await expect(store.get()).resolves.toBe("secret-with-newline\n");
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/auth-store/src/__probe__.test.ts --reporter verbose
rm packages/auth-store/src/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/auth-store/src/__probe__.test.ts > drops a trailing newline from a secret returned by Keychain
```

## Observed Behavior

`packages/auth-store/src/keychain-store.ts` returns `stripTrailingLineBreak(result.stdout)` whenever the Keychain command succeeds. That helper unconditionally removes one final `\n`, `\r`, or `\r\n`. In the reproduction, stdout represents a stored secret ending in `\n` plus the command output terminator, yet `get()` returns only one of the two final newline characters and therefore changes the stored value.

## Expected Behavior

The Keychain backend should preserve arbitrary secret bytes or otherwise reject unsupported values during `set()`. A successful `set(value)` followed by `get()` should return the exact same string, including legitimate trailing line breaks.

## Impact

Credentials, private keys, tokens, or other secrets containing a trailing newline are silently corrupted when read from macOS Keychain storage. Consumers can then receive invalid authentication material even though storage and retrieval both report success, while the encrypted-file backend preserves the same value correctly.
