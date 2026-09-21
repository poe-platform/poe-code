# Current encoding capability verification

This follow-up preserves the existing 44-codepage table runtime, captured
transliterations, licensing notices and injected locale selection. It repairs
an admission gap: source-admitted multibyte imports were treated as supported
whenever the host TextDecoder recognized their labels, despite uncaptured iconv
semantics. They now fail explicitly with `uncaptured import charset`. Unknown
native encoding names retain import guessing, without trying extra host aliases.
No native product dependency, fallback, ambient environment lookup or runtime
library was added. The shared CLI/SDK engine and safe-bash integration remain
the conversion path.

Seven initial regression cases failed before implementation; the first SDK
fixture also lacked required limits and was corrected. Final coverage includes
eight direct/CLI/SDK regressions, 29 cases from a different stress agent, and
a virtual-shell refusal with a supported CP437 negative control. Destination
preservation, exact diagnostic/status bytes, import modifiers, unknown aliases,
category masking, truncated offset byte views and foreign-realm decoding are
exercised. Existing cancellation/budget and checkpoint/replay cases run in the
maintained suites; no new rollback/authority API was introduced.

## Reference and original native probes

The official archive in `out/ssconvert-lifecycle` was rehashed to
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
The separate Colima oracle executable hash matches the captured profile:
`104f1e5500432c95ac3d46a679d476d05d2bf84e7483e991d212703cb0ed131c`.
Fresh stdout identifies version 1.12.61; stderr is empty. Fresh dependency
versions match: glibc 2.41-12+deb13u4, GLib 2.84.4-3~deb13u5, libgsf 1.14.53-1,
libxml2 2.12.7+dfsg+really2.9.14-2.1+deb13u3 and tzdata 2026c-0+deb13u1.
All 38 installed plugin manifest hashes match the existing profile; installed
manifests do not prove all plugin runtime variants. Locales remain C/C.utf8/POSIX.
Shared-library bytes were not freshly rehashed. Explicit HOME/XDG roots, C, UTC,
library/schema/data paths were injected as described by the QA procedure.

Forced importer `Gnumeric_stf:stf_csvtab`, UTF-8 text export produces these
original small-fixture results. Every row has native status 0 and empty stdout
and stderr; each destination was removed before the invocation.

| Import encoding | Input hex | Native destination hex | Product capability |
| --- | --- | --- | --- |
| SHIFT_JIS | 5c7e0a | c2a5e280be0a | Refused; old WHATWG path returned 5c7e0a |
| SHIFT_JIS | 800a | c2800a | Refused |
| SHIFT_JIS | 82a00a | e381820a | Refused |
| BIG5 | a4400a | e4b8800a | Refused |
| GBK | 800a | e282ac0a | Refused |
| EUC-JP | a4a20a | e381820a | Refused |
| UTF-8 | 410a | 410a | Supported control |
| CP437 | 820a | c3a90a | Supported control |
| made-up-charset | 410a | 410a | Unknown override guessing |

These native-success/product-refusal rows are capability gaps, not parity passes.
Exploratory automatic-probe failures and an invalid importer ID were investigated
and excluded. The SHIFT_JIS backslash/tilde case independently demonstrates the
semantic defect that justified removing host decoder admission.

## Candidate and gates

Base Git revision: `b97c4938a469ee70e09bd08a0e5fcf7e868ca04c`; candidate is an
uncommitted working tree, including preserved earlier edits. On Node v22.22.2,
the 296-file source/config fingerprint is
`34aabac143cf46f22817b1d1ced21fa76d066188d3494ed395d46f13b2cd92fe`.
Reproduce it by sorting all regular files under `packages/ssconvert/src`, plus
its package manifest, root/package safe-bash manifests, the ssconvert command
integration and its encoding command test. Hash the concatenation of each
relative path, NUL, lowercase SHA-256 of its bytes, and LF using SHA-256.
Reports and temporary captures are excluded from this fingerprint.

Passes: fresh maintained ssconvert unit suite (141 files, 3,902 tests) and package ESLint/production/test
TypeScript checks; uncached maintained safe-bash dependency build closure;
48 ssconvert virtual-command tests; 558 safe-bash runner tests; configured
uncached ESLint for the edited integration test. Built virtual-command refusal
and transliteration screenshots were inspected: readable diagnostics and `e:-D`
output, respectively. The initial screenshot/control missing the explicit
exporter was rejected QA and corrected, not counted as a pass.

Failure: maintained safe-bash typecheck exits 2 before builds or runtime cells.
Its current peer validator requires root export `./safe-fs` to equal
`./packages/safe-js/dist/safe-fs.js`; the current root manifest lacks that export.
The failure originates at
`packages/safe-bash/tests/plugins/qualified-current-release/peer.mjs:245`.
Unrelated SafeFS/export edits were preserved; no prerequisite was weakened.
The complete safe-bash typecheck is therefore incomplete, not a focused pass.

Not run: full root npm test/lint/build, all-runtime/host matrix, alternate native
dependency/plugin profiles, fresh exhaustive converter captures and bounded
performance measurements. This focused importer admission change uses package
gates and the cross-workspace integration/build closure. No workflow changed.
Unsupported/unmeasured: multibyte/stateful encoders and decoders, uncaptured
locales, arbitrary malformed Unicode and context-sensitive transliteration,
all TZ transitions, synchronous decoder interruption and all upstream runtime
variants. Earlier verification documents retain their remaining mismatches;
historical exhaustive measurements were not recaptured or claimed as fresh.

No README edits, local commits, remote delivery, pushes or releases occurred.
Temporary follow-up logs, native fixtures and screenshots are removed after
summarizing. QA steps are in the encoding Markdown procedure in `docs/plans`;
the independent review is `encoding-current-independent-review.md`.
