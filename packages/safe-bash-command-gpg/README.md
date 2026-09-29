# safe-bash-command-gpg

OpenPGP encryption and signing command (`gpg`) for `@poe-platform/safe-bash`.

## Features

- **Key generation & keyring management**: Generate Ed25519 OpenPGP keys (`--quick-generate-key`, `--batch --gen-key`), list keys (`--list-keys`, `--list-secret-keys`, `-K`), and export/import ASCII-armored keys (`--export -a`, `--import`).
- **Detached & inline signatures**: Produce RFC 4880 ASCII-armored detached signatures (`gpg --detach-sign -a -u <uid>`) with CRC24 checksums compatible with Git commit/tag signing (`git commit -S`, `git tag -s`).
- **Verification & status protocol**: Verify detached signatures (`gpg --verify <sig> <file>`) and emit `[GNUPG:] GOODSIG` / `VALIDSIG` machine-readable lines when `--status-fd` is requested.

## Usage

```ts
import { Shell, createMemoryFileSystem, gpgCommands } from "@poe-platform/safe-bash";

const fs = createMemoryFileSystem();
const shell = new Shell({ fs }).use(gpgCommands());

await shell.exec('gpg --quick-generate-key "Alice <alice@example.com>" ed25519 sign never');
await shell.exec('printf "hello\\n" | gpg --detach-sign --armor -u "Alice <alice@example.com>" > /hello.sig');
```
