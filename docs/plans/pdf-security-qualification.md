# PDF standard security: draft qualification

This increment is first-party security-dictionary parsing, password/key
validation and explicit byte decryption. It is not a mature encrypted-document
profile. No upstream source was adapted, no license-bearing assets were added,
and the private `pdf-parser` package retains an empty runtime dependency graph.
No permission to adopt an external parser or crypto dependency is inferred.

## Specification and source controls

Controls follow ISO 32000-1:2008 section 7.6, algorithms 1–7 and tables 20–23,
and ISO 32000-2:2020 section 7.6.4.3, algorithms 2.A/2.B and 8–13.
Password preparation is the caller's explicit byte contract: RFC 4013 SASLprep
for R6, UTF-8 for R5, and encoded legacy bytes for R2–R4. RFC 1321 MD5 and
NIST SP 800-38A AES-CBC vectors anchor the test capability contracts. The
historical Key/Plaintext RC4 vector anchors the test-only RC4 mock.

Research reference: PDF.js commit
`579c4b700f23f7782234f03358b5e9eaa3f58889`, `src/core/crypto.js`, Apache-2.0.
Inspected password preparation, version/key-length admission and metadata
handling against the proposed byte contracts. No copied source. The broader
source research remains pinned to pdf-lib
`93dd36e85aa659a3bca09867d2d8fac172501fbe` (MIT), qpdf
`54d6053af283bbeb8b325f4886c0f65cc51f2b80`, MuPDF
`89c1d183a7fb724898b2017d6ecd402a61886d4f` (AGPL/commercial), and Poppler
`0595ca8e76f575e5f16ccc5ee6d4b552d31b0a46` (GPL). Those references authorize
no copying of incompatible source.

Strict admission does not adopt PDF.js truthy defaulting, repair of missing V4
Length, bytes/bits length repair, extension of short AES keys, raw-password retry
after SASLprep, or permissive padding removal. Duplicate decoded keys fail.
This draft admits V1/R2, V2/R3, V4/R4 and V5/R5–R6; unsupported version/revision
combinations fail explicitly. Legacy object identifiers are admitted only within
24-bit object numbers and 16-bit generations; no accidental narrowing occurs.
CF Length is bytes and must agree with the file key. AESV2 requires 16 bytes;
AESV3 requires 32. Signed P and reserved bits are checked. Metadata exemptions
are admitted only for V4/V5. None of these strict choices closes a recovery gate.

## Original executed controls

`packages/pdf-parser/src/security.test.ts` contains in-memory dictionaries and
ciphertext only, with no native oracle process, files or external assets:

- R2/R3/R4 user and owner authentication, incorrect and omitted passwords;
  MD5 object keys with little-endian object/generation bytes and AESV2 sAlT;
  RC4/AES128 plaintext preservation including a zero byte.
- R3 40/56/128-bit keys; binary legacy passwords including zero/invalid UTF8;
  empty-password acceptance and exact 32-byte truncation.
- R4 EncryptMetadata false, Identity bypass, separate EFF RC4 selection,
  default Identity string/stream filters and EFOpen misuse rejection.
- Frozen original R5 and R6 O/U/OE/UE/Perms controls, non-ASCII/astral UTF8
  passwords, owner/user roles, AES256 independent of object key salts.
  Frozen R6 values were produced independently with BigInt modulo on the first
  16 encrypted bytes; engine selection uses byte-sum modulo 3. These are original
  specification controls, not copied upstream tests or parser agreement claims.
- Modern UTF8 rejection and encoding-contract mismatch; 127-byte truncation
  through a multibyte scalar, without re-encoding the truncated bytes.
- Encrypted Perms disagreement for P/metadata, reserved FF bytes and adb marker.
- AES missing IV, incomplete blocks, zero/excessive/inconsistent padding;
  invalid object key identifiers and unknown explicit Crypt filter.
- Duplicate keys, invalid default filters/lengths/metadata types, unsupported
  CFM, real tokens in integer fields and reserved permission bits; public-key
  handlers separately unsupported.
- Owned snapshots; captured primitive methods; admission before allocating
  decoded UTF8 text; work/expanded quotas; pending-call cancellation; exact
  primitive output lengths and unchanged provider exception propagation.
  Intrinsic byte admission accepts foreign-realm Uint8Array storage, rejects
  other spoof-tagged views, and ignores own length properties for quotas.

The legacy producer uses a test-only RC4 mock plus Node platform MD5; modern
frozen bytes use Node platform SHA/AES. Tests exercise platform primitives in
process. They do not qualify an audited shipping RC4 implementation. All engine
crypto is an explicit, trusted caller capability, with no built-in provider.

## Runtime, budgets and integration boundaries

No runtime-specific imports occur in engine source. Digest and cipher operations
can be synchronous or asynchronous; callers supply the same declared primitive
contracts across runtimes. Node platform primitives cover the exercised AES/SHA/
MD5 controls. RC4 availability depends on platform configuration. Browser/
workerd WebCrypto alone does not provide MD5, RC4 or AES-ECB. No production
adapter is supplied or claimed qualified; do not replace missing primitives with
an implicit dependency or shrink existing safe-bash runtime support claims.

Work, retained allocations and plaintext expansion are cumulative per security
factory. Before invoking primitives, the engine admits expected output/staging
and linear input work. R6 executes at least 64 rounds and its byte-valued stopping
condition bounds hashing to 287 rounds; quota exhaustion remains fatal. Default
quotas can reject repeated authentication attempts or costly passwords. Platform
internal allocations/timing are governed by the supplied capability; it must
honor cancellation, avoid ambient IO, and provide bounded execution. Engine
checks cancellation before calls and after asynchronous completion. An untrusted
or non-terminating crypto capability is outside this API's guarantees.

R6 normalization is delegated to explicitly labelled RFC 4013-prepared UTF8
bytes; Unicode 3.2 SASLprep mapping/prohibition/bidi tables and preparation from
JavaScript strings remain unqualified. Unicode preparation must not silently use
modern NFKC alone or discard invalid characters. No unprepared-password fallback.

Automatic decryption and shared document/security quota ownership remain open:
encryption dictionary/ID reference resolution, revision-specific security context,
unencrypted xref/Encrypt/ID fields, decrypt-before-filter ordering, explicit Crypt
selection/default Identity, object streams decrypted once (member strings must
not be decrypted again), metadata role detection, signature Contents exemptions,
attachments-only encryption, page/text interpretation and CLI/SDK flags need
original document controls before integration. Raw `getObject` data remains
ciphertext; existing document interpretation rejection tests must keep passing.
Standalone syntax, recovery, revisions, filters, pages, fonts, text and rewrite
qualification remain independent.

The command-package pattern was read at its currently archived path,
`docs/plans/archive/safe-bash-command-package-pattern.md`. No command export or
registration is added. Future consumers must follow its private first-party
engine → command → safe-bash bundling/declaration boundary, with no ambient
`pdf-parser` runtime import in published artifacts. An in-memory bundle/import
inspection of this engine can prove zero external imports; it does not constitute
installed safe-bash encrypted-command qualification.

## Verification

Fresh maintained package test route: `npm test --workspace=pdf-parser`.
Maintained package lint/typecheck: `npm run lint --workspace=pdf-parser`.
Selected build closure: `npm run build:workspaces -- --workspace=pdf-parser`.
Executed result after security review: all 91 package tests pass, including 23 security controls.
In-memory neutral-platform ES2022 bundling includes eight first-party modules
and zero external imports. This is engine evidence, not safe-bash artifact
publication or production-provider qualification.

No CLI visuals are changed, so no screenshot gate is opened. No commit, push,
remote-main delivery or release publication is requested or claimed.

## Task review findings

Reproduced expansion admission after object-key/cipher execution with an original
failing test: RC4 invoked two primitives even though its exact plaintext exceeded
the remaining expansion quota. Fixed by admitting RC4's exact length and AES's
guaranteed minimum (ciphertext minus IV and maximum padding) before object-key
or cipher work. AES charges the remaining bytes after validating padding; all
16 padding lengths pass exact-limit and cumulative-exhaustion controls. Invalid
AES envelope lengths now fail before object-key work. Failed operations retain
admitted quota charges, consistent with cumulative work/allocation accounting.
AES's exact size cannot be known before decrypting padding; allocation/work remain
admitted before invocation even when the final expansion check rejects output.

Reviewed handler admission, ownership, captured capabilities, cancellation,
object-key arithmetic, crypt-filter selection and error propagation. No ambient
file/network access or external runtime imports occur in security source. Crypto
wrappers perform algorithm/output/budget admission rather than merely forwarding
calls. No public command, document, snapshot or version contract was changed.

Unresolved completion finding: no shipping crypto provider is qualified across
declared runtimes. The tests' RC4 implementation remains test-only, and platform
WebCrypto lacks MD5/RC4/ECB. R6 SASLprep preparation remains a caller byte contract,
not a qualified first-party preparation implementation. The capability-driven
security increment is draft; these findings block a claim that this task delivers
qualified standard encryption across supported runtimes. Document integration and
safe-bash encrypted-command artifacts remain independent unopened gates rather
than inferred passes. No incompatible upstream source or implicit dependency was
adopted during review.

## Current candidate: explicit first-party/platform crypto

This task's changes supersede the earlier test-only RC4/no-shipping-provider
finding for the exercised Node cell. `src/crypto.ts` now implements original
RC4 KSA/PRGA, anchored independently to RFC 6229 section 2 key-1 vectors at
byte offsets 0 and 256 for 40/128/256-bit keys. Its 256-byte permutation,
1–256-byte key admission, modulo-256 indices and byte-valued XOR were reviewed
locally. Message length is intrinsically admitted before allocation (maximum
32 MiB); owned key/permutation storage is cleared in finally and failed output
is cleared on cancellation. Cancellation is checked before admission, every
4096 PRGA bytes and after execution. Foreign-realm bytes work; spoofed views,
shadowed length properties, overridden iterators and invalid keys/quotas have
negative controls. This is local review and original specification evidence,
not an independent cryptographic audit.

`createPdfCrypto` captures explicit digest/AES capabilities and supplies RC4.
The separate private `pdf-parser/node-crypto` entry supplies a shipping explicit
Node platform provider: built-in MD5/SHA256/384/512 and AES-CBC/ECB with no auto
padding. It checks byte bounds, block alignment, key/IV shapes, algorithms and
abort before/after synchronous platform work. Platform/FIPS failures propagate
without fallback. Synchronous work cannot observe event-loop cancellation until
control returns. The portable entry never imports the Node adapter. Both paths
retain zero external runtime package dependencies; `node:crypto` is an explicitly
selected permitted platform primitive, not a native addon or ambient module
fallback. No external source or license-bearing implementation was adapted.

All 23 pre-existing original security controls now execute through the shipping
Node provider. The independent fixture producer retains its separate test-only
RC4, so producer/consumer do not share that implementation. Six added RC4
controls and two Node controls cover RFC 1321 MD5, SHA256 and NIST SP 800-38A
CBC/ECB answers, in addition to the frozen R5/R6 specification controls.

Executed Markdown QA: `docs/plans/pdf-security-candidate-qa.md`. The in-memory
neutral ES2022 bundle has nine first-party modules and zero output imports.
A fresh Node VM without process, Buffer, require or supplied IO runs the frozen
RC4 vector; portable exports exclude the Node adapter. The Node-platform
in-memory graph has exactly one external import, `node:crypto`. No files,
network, native PDF oracles or generated logs are used for these controls.
These are local engine/boundary checks, not installed Safe Bash artifact proof.

Runtime qualification remains Node 22.22.2 only. Other Node versions, Bun,
actual browser/workerd engines and full command/checkpoint/replay integration
are unverified. No CLI changes or screenshot gate. R6 RFC 4013 preparation
remains explicit caller-prepared bytes, not a first-party Unicode 3.2 SASLprep
implementation. Automatic document decryption, shared document quotas and the
security-sensitive role exemptions/ordering remain separate integration gates.
No public-key acceptance, permission enforcement, redaction, mature encrypted
PDF profile, release or external parser adoption is claimed.

Current candidate verification: fresh `npm test --workspace=pdf-parser` passes
all 99 tests, zero failures/skips/cancellations. Maintained
`npm run lint --workspace=pdf-parser` passes ESLint and source/test typechecks;
`npm run build:workspaces -- --workspace=pdf-parser` passes the selected maintained
build closure. Manual bundle/realm and built package self-reference exports pass.
The root cannot resolve this uninstalled private package by its bare name; the
export check was executed successfully from the package's self-reference scope,
without changing the lockfile or installing a dependency. TDD missing-module
failures were intentional; a test syntax error and Node-type compile failures
were investigated and corrected before repeating the complete package routes.
No broad gate was started or claimed; changes stay within this private workspace
and its qualification documents, with no shared build/command infrastructure edits.

Verified production candidate SHA256 values:

- `src/crypto.ts`: `00c6b0b82d4369060231dd53ed5c01c1b78c4a3c1f25761211a529141f7d8ddb`
- `src/node-crypto.ts`: `5a588ea34f5086c1610d15aa8e0b33c092edd0fff0859df72e333250eef4cf37`
- Pre-existing `src/security.ts`: `b6f80f7a4cae8c975a63f4690427a0b6a1a2c3eded28c665ac4a8c527be2d5d9`

Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No push or publication was requested. Qualification remains draft for the
unverified runtime/preparation/integration cells stated above.
