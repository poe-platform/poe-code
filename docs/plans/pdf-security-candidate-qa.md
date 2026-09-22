# PDF security candidate QA

Execute this Markdown plan without native PDF oracle processes or fixture files.
Candidate is the current working tree, including pre-existing parser/security
work. This task adds first-party RC4, explicit Node platform crypto, their tests,
and the portable/private Node export contracts. No command integration gate is
opened.

1. Run `npm test --workspace=pdf-parser`. Require the original R2–R6 user/owner,
   object-key, metadata, crypt-filter, password, Perms and ciphertext negatives
   to use the shipping Node provider. Keep independent test-only RC4 exclusively
   in the fixture producer. Check RFC 6229 offsets and RFC 1321/NIST primitives.
2. Run `npm run lint --workspace=pdf-parser` and
   `npm run build:workspaces -- --workspace=pdf-parser`. Investigate every failure
   and repeat the complete package route after corrections.
3. Bundle `src/index.ts` in memory with esbuild's neutral ES2022 platform and
   metadata enabled. Require every output import list to be empty. Execute the
   IIFE in a fresh Node VM with no process/Buffer/require/network/file capability.
   Supply byte arrays from inside that realm and run the frozen RC4 Key/Plaintext
   control. This is conditional realm evidence, not a browser/workerd pass.
4. Bundle `src/node-crypto.ts` on the Node platform in memory. Inspect its external
   graph: only `node:crypto` is admitted. Invoke the built private Node subpath
   and verify the portable export does not contain `createNodePdfCrypto`.
5. Review KSA/PRGA indices and modulo-256 arithmetic, key admission, work ceiling,
   output ownership, cancellation checks and key/state cleanup. Review platform
   padding disabled, CBC/ECB IV and block checks, explicit algorithm selection,
   no fallback, and no ambient IO. Record this as local review, never an
   independent cryptographic audit.

No CLI visuals or commands are changed: CLI screenshots, password CLI/SDK flags,
original/checkpoint/replay command execution and installed Safe Bash artifacts
are unopened integration gates. Actual browser/workerd/Bun runtimes, R6 SASLprep
from JavaScript strings, document automatic decryption, and a mature encrypted
PDF profile remain unverified. Public-key support is explicitly unsupported;
permission bits are reported without enforcement or redaction claims.
