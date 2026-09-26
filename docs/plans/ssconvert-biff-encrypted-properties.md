# BIFF CryptoAPI encrypted properties

Status: bounded container import, explicit export and unknown ancillary reexport
implemented; native application qualification remains pending under hey-boss #1748.

LibreOffice's property loader reads ordinary property streams without the BIFF
decrypter. Apache POI revision `942d95d85b15d0dfdb3bc9ba1b4f273f277757c8`
provides an implemented encrypted-container path. Exact source URLs, hashes and
line receipts are in `reference.biffDocumentProperties.encryptedAncillarySource`
in `docs/ssconvert/gap-resolution.json`.

1. Implement the separate `encryption` stream layout described by
   `CryptoAPIDecryptor.getSummaryEntries`. Header and descriptor array restart RC4
   at block 0; each payload restarts at its descriptor's block ID. Do not apply
   Workbook's 1024-byte chunk addressing to these payloads.
2. Admit the encrypted container before password acquisition where possible.
   After verification, validate decrypted descriptor offset/size, entry count,
   UTF-16 names and terminators, flags, reserved fields, payload bounds, overlaps
   and case-insensitive duplicate names before exposing decoded properties.
   Resolve ambiguous plaintext/encrypted stream collisions explicitly.
3. Integrate the container while the verified CryptoAPI key remains available.
   Reuse the existing derivation and the original host password request. Own and
   clear derived keys, keystreams and decrypted temporary buffers on success,
   failure, cancellation and disposal. Preserve the caller's input bytes.
4. Add explicit encrypted-property export selection with matching CLI and SDK
   behavior. Place real property sets in the encrypted container, clear bit 0x08
   in both matching header flag fields, remove the plaintext summary and emit the
   source-defined empty document-summary placeholder. Keep ordinary workbook-only
   encrypted exports stable. Preserve unsupported ancillary content or diagnose
   it explicitly; never silently discard it.
5. First reproduce the current refusal with a small original encrypted container.
   Verify framing and independently derived ciphertext for a title plus custom
   data, edited exports, wrong passwords, malformed descriptors and cancellation.
   Run maintained BIFF checks and package lint/types. Execute the public CLI and
   inspect its terminal screenshot; qualify native/independent readers separately.
6. Commit small changes to main, verify remote delivery, and monitor the containing
   GitHub release. Store temporary work under `out` and remove it after recording
   concise evidence. The broader encryption family remains open until its full
   acceptance evidence is present.

Import now accepts the admitted encrypted container. Missing containers, malformed
layouts, plaintext collisions and wrong passwords remain refused. Explicit
`encryption=rc4-cryptoapi-<bits>-properties` export uses the same password and entropy
request as Workbook encryption. It emits the source-defined container and empty
plaintext document-summary placeholder. Workbook-only encryption keeps its
existing plaintext-property behavior. Explicit property encryption preserves
retained opaque ancillary payloads and rejects ambiguous names before password
acquisition. Workbook-only profiles and unrecognized metadata shapes still
diagnose ancillary loss.
