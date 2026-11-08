# safe-bash-command-openssl

Compute digests, encrypt files, generate keys, and create or inspect real certificates inside the `@poe-platform/safe-bash` virtual filesystem. The `openssl` command uses portable JavaScript and Web Crypto; it never launches a host executable or reads host files or environment variables.

## Features

| Commands | Supported workflows |
| --- | --- |
| `dgst`, `md5`, `sha1`, `sha256`, `sha384`, `sha512` | Digests/HMAC, `-binary`, `-hex`, `-r`, `-out`; RSA and ECDSA SHA signatures with `-sign`, `-verify`, `-signature` |
| `rand` | Secure raw bytes, `-hex`, `-base64`, `-out` |
| `enc` | AES-128-CBC, AES-256-CBC, AES-256-CTR; `-e`/`-d`, `-a`/`-base64`, `-A`, raw `-K`/`-iv`, passwords, salts, PBKDF2 |
| `base64` | Encode/decode binary stdin or `-in`, optionally write `-out`; `-A` disables wrapping |
| `genpkey`, `genrsa`, `ecparam`, `rsa`, `ec`, `pkey` | RSA, Ed25519, P-256/P-384/P-521 keys, PEM/DER, public extraction, `-noout`, `-text`, RSA `-modulus` |
| `req`, `x509` | Signed PKCS#10 CSRs and self-signed X.509 certificates; subject, issuer, validity, serial, fingerprint, extension and expiry inspection |
| `passwd` | MD5 crypt (`-1`), Apache MD5 (`-apr1`), SHA-256 crypt (`-5`), SHA-512 crypt (`-6`), supplied/random salt, `-stdin` |
| `pkeyutl` | RSA/ECDSA and Ed25519 signing and verification |
| `version` | Portable implementation banner and `-a`, `-v`, `-b`, `-o`, `-f`, `-p`, `-d` metadata |

## Usage

```ts
import { Shell, createMemoryFileSystem, opensslCommands } from "@poe-platform/safe-bash";

const fs = createMemoryFileSystem();
const shell = new Shell({ fs }).use(opensslCommands());

await shell.exec("openssl rand -hex 16 > /secret.key");
await shell.exec("openssl dgst -sha256 /secret.key");
await shell.exec("openssl ecparam -name prime256v1 -genkey -out /tls.key");
await shell.exec("openssl req -new -x509 -nodes -key /tls.key -days 30 -subj /CN=example.test -addext subjectAltName=DNS:example.test -out /tls.pem");
await shell.exec("openssl x509 -in /tls.pem -noout -subject -dates -fingerprint");
await shell.dispose();
```

Use `-pass pass:value`, `-pass env:NAME`, `-pass file:/virtual/path`, or `-pass stdin` with `enc`. The environment is the Shell invocation's environment; a password file contributes its first line. `stdin` consumes one password line and leaves the remaining bytes for the payload. `-k value` supplies a literal password.

Encryption uses an 8-byte salt, a `Salted__` header, and SHA-256 derivation. `-pbkdf2` defaults to 10,000 iterations; `-iter` selects PBKDF2 and overrides that count. Without PBKDF2 the command supports the legacy EVP_BytesToKey format. `-S` supplies an explicit 8-byte hexadecimal salt and, like OpenSSL 3, omits the header; provide the same salt when decrypting. `-nosalt` omits both salt and header. CBC uses PKCS#7 padding. Newer native OpenSSL versions with a different default salt length need their 8-byte salt option when reading these encrypted files.

Keys are written as unencrypted PKCS#8 private keys or SPKI public keys. Traditional RSA PKCS#1 and EC SEC1 keys are also accepted in PEM/DER. EC names are `prime256v1`/`P-256`, `secp384r1`/`P-384`, and `secp521r1`/`P-521`. Encrypted private keys, arbitrary curves, engines, interactive prompts, and native provider configuration are outside this portable command's scope. Unsupported options fail explicitly.

`req -new` creates a CSR; add `-x509` for a self-signed certificate. `x509 -new -key ...` also creates a self-signed certificate. Supply `-subj /CN=...` and an existing `-key`, or generate a key with `-newkey rsa:2048` / `-newkey ec:prime256v1` and `-keyout`. Certificates default to 30 days. Repeat `-addext` for subject alternative names, basic constraints, key usage, extended key usage, or a hashed subject key identifier. Inspection supports `-inform PEM|DER`, `-text`, `-subject`, `-issuer`, `-dates`, `-startdate`, `-enddate`, `-serial`, `-fingerprint`, `-ext`, and `-checkend seconds`. `-checkend` returns status 1 when the certificate expires within the interval. `-noout` suppresses encoded certificate/key output.

Set `opensslCommands({ limits: { maxBufferedBytes, maxIterations, maxKeyBits, maxPasswordBytes } })` to control resource use. Defaults are 16 MiB of cumulative input/per-output bytes, 1,000,000 derivation iterations, 4,096 RSA generation bits, and 1,024 password bytes. Input collection owns stream fragments and observes cancellation; file and stream writes use Shell output accounting. Web Crypto operations complete before cancellation is observed again. No native OpenSSL installation is needed to use the command.
