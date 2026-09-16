# ZIP password capabilities

`ArchiveCommandsOptions.zipHost` is an optional, explicit trusted host binding.
The same archive options flow through `archiveCommands`, `agentCommands` and the
`runBash` SDK's `archive` option. Commands never import host randomness, access
ambient credentials, open a terminal, or spawn native tools.

`entropy(length, signal)` must return exactly the requested number of fresh,
cryptographically secure bytes. ZIP requests 11 bytes per newly encrypted member;
the twelfth header byte is the CRC high byte, or the DOS time high byte when the
descriptor flag is set. The callback must cooperate with cancellation. Callback
work belongs to the command's existing registered cleanup scope. Test entropy
is deterministic only in fixtures. There is no product entropy fallback.

`password({ prompt, maxBytes, signal })` must suppress input echo, return password
bytes, or return `undefined` on EOF. It must not consume command stdin, log
passwords, or exceed `maxBytes` (the configured `maxArgumentBytes`). Commands
copy returned bytes; NUL is refused. This is a trusted host promise, not a terminal
security enforcement mechanism. Hosts must cooperate with cancellation; cleanup
cannot forcibly settle an uncooperative host promise.

`zip -P PASSWORD` (including long `--password` and attached/clustered forms)
encrypts newly added/replaced non-directory members. Native ZIP's empty supplied
password rejection is retained. `zip -e` requests and confirms a nonempty
password; supplying `-P` satisfies password input. `unzip -P PASSWORD` uses the
supplied bytes; otherwise encrypted members request a password with at most
three no-echo attempts after verifier rejection. A verified password is reused,
with new prompts if another member rejects it. Unicode text uses UTF-8; owned
raw argv bytes and injected password bytes retain their identity. The low-level
format API can decode/encode empty password bytes independently of native ZIP's
command argument restriction.

Traditional ZipCrypto is supported; AES/strong encryption remains refused.
Every member starts fresh keys. Compression precedes encryption, and decryption
precedes decompression. The 12-byte header's verifier is not authentication.
Commands validate final CRC and expanded length before publishing encrypted
member data, including `unzip -p`; encrypted pipe output therefore uses bounded
member buffering. Copy/update/comment operations retain existing ciphertext and
its descriptor/time binding. `zip -T` uses the supplied password to validate the
serialized archive. Direct `decodeZipEntry` is a streaming primitive: consumers
must reach successful EOF before publishing its unverified chunks.

The current `poe-code bash -c` CLI is noninteractive. Its host adapter supplies
Node cryptographic entropy through the SDK, so `zip -P` works with stdout output.
Named ZIP publication still requires the filesystem's existing owned atomic
staging capability; the real-filesystem adapter currently refuses that path.
Shell stdout redirection uses its existing explicitly weaker output contract.
It has no no-echo
password provider: `zip -e` or passwordless encrypted extraction fails precisely
with `ZIP no-echo password capability is unavailable` (status 2). The SDK also
requires explicit capabilities; it does not implicitly borrow the host terminal
or RNG. Terminal prompt parity in the CLI is excluded until an explicit no-echo
host is configured. No SafeJS contract changes are required.
