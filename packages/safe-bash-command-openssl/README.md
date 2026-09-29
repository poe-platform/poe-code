# safe-bash-command-openssl

Cryptographic toolkit command (`openssl`) for `@poe-platform/safe-bash` with bounded in-memory resource accounting.

## Features

- **Message digests & HMAC (`dgst`, `sha256`, `sha512`, `sha1`, `md5`)**: Compute hex, coreutils (`-r`), or binary digests and HMAC authentication codes across files or standard input.
- **Symmetric encryption (`enc -aes-256-cbc -pbkdf2`)**: Encrypt and decrypt payloads using OpenSSL's `Salted__` header format and PBKDF2-HMAC-SHA256 key derivation.
- **Random byte generation (`rand`)**: Generate cryptographically secure bytes in raw, `-hex`, or `-base64` formats.
- **Asymmetric keys & X.509 certificates (`genpkey`, `pkey`, `req -x509`, `x509`)**: Generate PKCS#8 Ed25519 private keys, derive SPKI public keys, and issue or inspect self-signed X.509 PEM certificates.
- **Base64 & Password hashing (`base64`, `passwd`)**: Encode/decode Base64 streams and generate salted password hashes.

## Usage

```ts
import { Shell, createMemoryFileSystem, opensslCommands } from "@poe-platform/safe-bash";

const fs = createMemoryFileSystem();
const shell = new Shell({ fs }).use(opensslCommands());

await shell.exec("openssl rand -hex 16 > /secret.key");
await shell.exec("openssl dgst -sha256 /secret.key");
```
