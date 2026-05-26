# Encrypted credential store follows a symlinked home-state directory and writes or deletes an external secret file

## Summary

The encrypted file credential backend used by poe-code writes provider credentials beneath `$HOME/.poe-code`, but it treats that directory as an ordinary textual path. If `$HOME/.poe-code` is a symbolic link, storing a provider API key creates an encrypted credential file in the external target, credential reads consume it from there, and deletion removes that external file.

## Reproduction

From the repository root, construct the same encrypted provider credential path used by the CLI/SDK with a disposable home whose state directory points elsewhere:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/outside"
ln -s "$probe/outside" "$probe/home/.poe-code"

cat > "$probe/repro.mts" <<EOF
import { stat } from "node:fs/promises";
import { EncryptedFileStore } from "file://$PWD/packages/auth-store/src/encrypted-file-store.ts";

const store = new EncryptedFileStore({
  filePath: "$probe/home/.poe-code/credentials.poe.enc",
  salt: "poe-code:encrypted-file-auth-store:v1",
  getMachineIdentity: () => ({ hostname: "probe-host", username: "probe-user" }),
  getRandomBytes: () => Buffer.alloc(12, 1)
});
await store.set("secret-probe-key");
console.log("stored=" + await store.get());
console.log("outsideExists=" + Boolean(await stat("$probe/outside/credentials.poe.enc")));
await store.delete();
try { await stat("$probe/outside/credentials.poe.enc"); console.log("remaining=true"); }
catch { console.log("remaining=false"); }
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"

nl -ba packages/auth-store/src/encrypted-file-store.ts | sed -n '40,142p'
nl -ba src/cli/container.ts | sed -n '117,160p'
nl -ba src/sdk/container.ts | sed -n '91,126p'
```

## Observed Behavior

The credential backend successfully stores and retrieves the supplied secret through the escaped provider path, then removes the external encrypted file:

```text
stored=secret-probe-key
outsideExists=true
remaining=false
```

`EncryptedFileStore.set()` recursively creates the parent directory, writes the encrypted document, and applies permissions at its configured path, while `delete()` unlinks that path. Both CLI and SDK containers construct provider credential stores with `defaultDirectory: ".poe-code"`, so a symlinked poe-code state directory redirects ordinary credential operations.

## Expected Behavior

Credential files for a selected home directory should be written, read, and deleted only inside the canonical `$HOME/.poe-code` state root. Secret persistence must reject symlink-mediated escapes or use storage semantics that cannot operate on unrelated external files.

## Impact

An attacker or damaged user state able to replace `$HOME/.poe-code` with a symbolic link can redirect encrypted provider secrets into an unintended writable directory and cause logout or cleanup operations to delete an external file. Although the stored payload is encrypted, its existence, lifecycle, and location no longer match poe-code's credential isolation boundary.
