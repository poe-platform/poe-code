# safe-bash-command-gpg

OpenPGP encryption and signing command (`gpg`) for `@poe-platform/safe-bash`.

## Features

- **Key generation & keyring management**: Generate Ed25519 OpenPGP keys (`--quick-generate-key`, `--batch --gen-key`), list keys (`--list-keys`, `--list-secret-keys`, `-K`), and export public certificates as binary OpenPGP packets (`--export`) or ASCII armor (`-a --export`). GnuPG can import these certificates and verify detached signatures made by safe-bash. Import supports this single-user-ID Ed25519 certificate format, including GnuPG signing certificates with SHA-256, SHA-384 or SHA-512 self-certifications and key expiration dates. Legacy safe-bash public-only records can verify old signatures but need a fresh certificate from the signer for OpenPGP export.
- **Detached signatures**: Sign with an existing secret key, selected by user ID, key ID, or full fingerprint. `gpg --detach-sign report` writes binary packets to `report.sig`; add `--armor` for `report.asc`. Input from stdin writes to stdout, as does `-o -`. With multiple files, the signature covers their contents in order and is named after the last file. Use `--yes` to replace an existing signature.
- **Verification & status protocol**: Verify armored or binary detached signatures (`gpg --verify <sig> <file>`) and emit `[GNUPG:] GOODSIG` / `VALIDSIG` machine-readable lines when `--status-fd` is requested. Use `gpg --verify report.sig -` to verify data from stdin. Outside batch mode, omitting the data operand looks for a sibling file by stripping `.sig`, `.asc`, or `.sign`; in batch mode the data operand is required. A valid signature from an expired key reports `EXPKEYSIG` instead of `GOODSIG`. Verification requires the signing public key to be generated or imported into the current keyring and checks that the signature key ID matches that key.

Unknown options return an error before reading or writing files. Use `--` before
filenames that start with a dash.

## Usage

```ts
import { Shell, createMemoryFileSystem, gpgCommands } from "@poe-platform/safe-bash";

const fs = createMemoryFileSystem();
const shell = new Shell({ fs }).use(gpgCommands());

await shell.exec('gpg --quick-generate-key "Alice <alice@example.com>" ed25519 sign never');
await shell.exec('printf "hello\\n" | gpg --detach-sign --armor -u "Alice <alice@example.com>" > /hello.sig');
```
