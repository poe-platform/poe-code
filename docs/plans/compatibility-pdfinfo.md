# Independent pdfinfo qualification

## Result and inspected revision

Qualification is **incomplete**: there is no pdfinfo candidate to execute.
Inspected on 2026-09-21 at HEAD
`ab1fa8d34101e1e7f61272973f3bc28a842043d8`, with existing uncommitted changes.
HEAD alone does not identify the inspected working tree. Node v22.22.2 and npm
10.9.7 were queried; neither is a qualified pdfinfo runtime profile.

Inspection receipt SHA256:
`ef908eedfeee88cb2175458aac381a6f6564a252ac63e5ac796783b1c6066df5`.
Reproduce by sorting these relative paths and hashing each path, NUL, its exact
file bytes, NUL, in sequence:

- `docs/plans/archive/safe-bash-command-package-pattern.md`
- `docs/plans/safe-bash-pdf-parser.md`
- `docs/plans/safe-bash-pdfinfo-acceptance.md`
- `docs/plans/safe-bash-pdfinfo.md`
- `package.json`
- `packages/pdf/package.json`
- `packages/safe-bash-command-pdftotext/src/command.ts`
- `packages/safe-bash/package.json`
- `scripts/bundle-safe-bash.mjs`

This identifies inspected inputs, not executable candidate source. This document
is outside that receipt.

## Executed manual inspection

Executed the candidate-identification and prerequisite-inspection steps of the
[acceptance procedure](safe-bash-pdfinfo-acceptance.md). Direct filesystem checks
and `rg --files packages` confirm that `packages/safe-bash-command-pdfinfo`,
`packages/pdf-parser` and `packages/safe-bash-pdf-parser` are absent. Neither a
`packages/safe-bash/src/commands/pdfinfo` directory nor a `pdfinfo.ts` facade
exists. Parsed Safe Bash exports contain no `./commands/pdfinfo`. Searches of
the root manifest, Safe Bash manifest and bundle script find no pdfinfo
integration.

The shared parser's syntax, revisions, filters, page-tree, security and private
API implementation/test gates remain open. The adjacent pdftotext command
declares `extractionQualified: false` and rejects extraction; it does not supply
resolved metadata, page inheritance or authorization APIs. The existing PDF
generation package depends on pdf-lib, fontkit and pako and is not a qualified
inspection parser under the required dependency contract.

The requested package-pattern path is absent due to an existing move. Its
[archived copy](archive/safe-bash-command-package-pattern.md) was read without
restoring unrelated changes. It requires shared parser ownership and prohibits
empty scaffolds. Existing engine/behavior completion claims in the pdfinfo plan
are contradicted by the absent code and exports; those contributor edits were
preserved. They do not close qualification cells.

## Independent control inventory and missing cells

The [acceptance matrix](safe-bash-pdfinfo-acceptance.md) remains authoritative.
The exact fixture set executed against a candidate in this task is **empty**.
No candidate stdout/stderr bytes, status or invocation effects were produced.
No native process was launched and no fixtures were downloaded. Existing
writer-generated PDFs elsewhere in the repository are not substituted for
retained independent controls.

The supplied upstream evidence pins Poppler
`0595ca8e76f575e5f16ccc5ee6d4b552d31b0a46`, version 26.09.90, archive SHA256
`e9834d9e5e9269e241d9638e97e32867cdf56140b87af74d0fb9f58a326e158a`.
Its macOS CMake 4.4.3 build used Freetype 2.14.3, Fontconfig 2.17.1 and JPEG;
Qt/GLib/CPP/NSS/GPGME/Brotli/Harfbuzz/curl/OpenJPEG/LCMS/Cairo were disabled.
The normal-date observation used explicit TZ=UTC. Complete invocation locale,
binary/library hashes and raw receipts still need retention before an exact
differential claim. These are prior supplied controls, not newly executed results.

| Required cell | Current result |
| --- | --- |
| Writer-generated controls | Not executed against pdfinfo; no candidate |
| Independent classic/xref-stream and incremental revisions | Unverified; exact admitted fixtures and native receipts missing |
| Encryption/password/permission profiles | Unverified; supplied fragments do not provide complete encrypted fixture receipts |
| Mixed page sizes, inherited boxes and rotations | Unverified; original P3 bytes/hash and complete geometry output missing |
| Metadata/text encoding | Unverified; P3/B12 fixture bytes/hashes and complete output receipts missing |
| Flag priorities, dates, encoding maps and statuses | Unverified; source findings and supplied fragments remain distinct from full differential proof |
| Document JS/actions, URI and attachments remain inert | Unverified; no inspection invocation exists to instrument |
| CLI/SDK, stdin size versus actual input length | Unverified; no command/SDK API exists |
| Cancellation, budgets, cleanup, rollback and authority denial | Unverified; no candidate lifetime/resource contract can be exercised |
| Node/browser/workerd and any other advertised runtimes; realm boundaries | Unverified; no runtime profile is advertised by a candidate |
| Original/checkpoint/replay | Unverified; no pdfinfo execution exists |
| Bundled private runtime and declarations; isolated installed consumer | Unverified; public subpath absent |

No semantic passes, runtime failures, repaired defects or minimized generated
findings are claimed. The concrete finding is missing implementation and
prerequisites, rather than a reproduced parser defect. No unsupported feature
policy can be inferred for a nonexistent candidate. Performance measurements
were not collected and cannot substitute for any of these cells.

## Remaining executable QA

1. Qualify the shared parser's metadata/page-tree/security capabilities. Then
   identify the real private pdfinfo source candidate and all dirty source bytes.
   Preserve package ownership, byte streams and explicit invocation profiles.
2. Retain independently identified classic, xref-stream, incremental, encrypted,
   mixed-size and metadata fixtures, alongside separately identified writer
   controls. A reconstructed fixture is a new control, not the original P3/B12.
3. Manually run the pinned native executable under a declared locale/timezone,
   output-encoding and build profile. Record exact argv/input/output bytes,
   hashes, source kind, exit status and effects for every matrix cell. Native
   processes stay outside unit tests and the product.
4. Compare complete candidate bytes/status/effects to those receipts. Include
   document actions containing execution/fetch/attachment traps; instrument
   explicit capabilities and assert no action evaluation or unauthorized effects.
   Check SDK raw metadata preservation separately from CLI NUL truncation, and
   SDK input length separately from stdin-compatible file size zero.
5. Minimize discrepancies, preserve seeds and add fast failing memory-VFS
   regressions before repairs. Verify cancellation/accounting cleanup and negative
   authority controls independently of compatibility output. Run the narrowest
   maintained workspace test/lint/build closure covering each code change.
6. Exercise each advertised runtime/realm, original/checkpoint/replay and an
   isolated installed Safe Bash consumer with no unpublished workspace. Inspect
   screenshots of actual CLI output. Keep bounded performance receipts separate.

Only this evidence document was added. No code/config changes, placeholder
tests, duplicate parser or speculative command scaffold were introduced.
Unit tests, lint/typecheck/build, installed-consumer checks and screenshots were
not run: there is no pdfinfo target, and no product visual behavior changed.
Broad gates were not run or claimed. No temporary logs were retained.

Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No private command package was published. Unrelated edits were preserved.
