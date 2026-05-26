# Encrypted credential store follows a symlinked credential file and overwrites or chmods an external secret

## Summary

The encrypted file credential backend used by poe-code writes directly to its configured credential-file path without rejecting a symbolic link at that final path. If `credentials.poe.enc` itself points to an existing external file, storing a provider API key overwrites the external file with encrypted credential data and changes its permissions to `0600`.

## Reproduction

From the repository root, create a normal poe-code state directory whose individual provider credential file points to an unrelated external file, then call the exported credential store API:

```sh
probe=$(mktemp -d /tmp/poe-auth-file-symlink-probe.XXXXXX)
mkdir -p "$probe/home/.poe-code" "$probe/outside"
printf 'original-external\n' > "$probe/outside/secret.enc"
ln -s "$probe/outside/secret.enc" "$probe/home/.poe-code/credentials.poe.enc"

cat > "$probe/repro.mts" <<EOF
import { readFile, stat } from "node:fs/promises";
import { EncryptedFileStore } from "file://$PWD/packages/auth-store/src/encrypted-file-store.ts";

const store = new EncryptedFileStore({
  filePath: "$probe/home/.poe-code/credentials.poe.enc",
  salt: "poe-code:encrypted-file-auth-store:v1",
  getMachineIdentity: () => ({ hostname: "probe-host", username: "probe-user" }),
  getRandomBytes: () => Buffer.alloc(12, 1)
});

await store.set("secret-probe-key");
console.log("stored=" + await store.get());
console.log("externalStartsJson=" + (await readFile("$probe/outside/secret.enc", "utf8")).startsWith("{"));
console.log("mode=" + ((await stat("$probe/outside/secret.enc")).mode & 0o777).toString(8));
EOF

./node_modules/.bin/tsx "$probe/repro.mts"

nl -ba packages/auth-store/src/encrypted-file-store.ts | sed -n '59,142p'
nl -ba src/cli/container.ts | sed -n '127,146p'
nl -ba src/sdk/container.ts | sed -n '99,118p'
```

## Observed Behavior

The credential backend follows the symlink, stores and retrieves the secret through the external target, and changes the target file mode:

```text
stored=secret-probe-key
externalStartsJson=true
mode=600
```

`EncryptedFileStore.set()` creates the parent directory, writes to `this.filePath`, and calls `chmod()` on the same unvalidated path in `packages/auth-store/src/encrypted-file-store.ts:110` through `packages/auth-store/src/encrypted-file-store.ts:132`. The CLI and SDK configure provider credential stores beneath `.poe-code` in `src/cli/container.ts:127` through `src/cli/container.ts:146` and `src/sdk/container.ts:99` through `src/sdk/container.ts:118`.

## Expected Behavior

Credential writes should refuse an existing symbolic link at the credential file path, or atomically create and replace a regular file that is guaranteed to remain beneath the intended poe-code state directory. An external file must not be overwritten or have its permissions altered by storing a credential.

## Impact

A pre-existing symlinked provider credential file can redirect normal login or provider credential updates into any writable external file. Although the replacement payload is encrypted, poe-code can destroy unrelated file contents and unexpectedly apply restrictive permissions outside its credential-state boundary.
