# pdftotext behavior increment

Candidate inspected 2026-09-21. This increment adds real pure behavior primitives
in private `safe-bash-command-pdftotext`; it does not close `behavior-pdftotext`.
The [command package pattern](archive/safe-bash-command-package-pattern.md) was
read at its relocated path without restoring unrelated deleted files.

## Scope and acceptance state

| Capability | Local deterministic state | Full acceptance-matrix state |
| --- | --- | --- |
| Page normalization and exact filename defaults | Tested, including short names, sentinels, invalid numbers, NUL and cancellation | Open: no PDF or VFS invocation |
| Exact argument admission | Tested, including options after operands, `--`, unknown positional tokens, repeated values, aliases and precedence | Open: no CLI/SDK dispatch or native run |
| Checked numeric admission | Tested strict decimal grammar, complete values, finite arithmetic, positive DPI and colspacing bounds | Open for native comparison; deliberate stricter admission |
| Password profile | String CLI admission truncates encoded bytes, including a split multibyte sequence | Open: SDK raw bytes, encryption/security and real CLI |
| Output maps/EOL | Strict UTF-8, UTF-16BE, Latin1 and ASCII7 primitives tested; whitespace/formfeeds use the map | Open: native encoding goldens and extraction events |
| XML/word boxes | Metacharacters, six-decimal supplied coordinates, XML scalar admission and bounds tested | Open: page/block/line boxes, bbox/layout XML, crop/resolution transforms and full native goldens |
| Resource and authority controls | Pre-admission of byte/string retention and work, zero-work/zero-retention rejection, supplied iterator/method negative controls | Open: document/parser budgets, invocation cleanup, byte argv brands, realms and replay |
| PDF text, image-only pages and unresolved glyphs | Not implemented | Open: accepted parser font/CMap/ActualText and layout APIs absent |
| Publication and installed consumers | Not implemented | Open: VFS alias/conditional writes, rollback, CLI/SDK composition and bundled safe-bash export |

No fake command, substring extraction, fabricated glyph text or external parser
was introduced. Prerequisite-gated extraction integration remains absent. The
[parser plan](safe-bash-pdf-parser.md) still has its implementation gates open;
the [engine review](safe-bash-pdftotext-engine-prerequisites.md) confirms the
missing APIs. Before extraction integration, select the explicit copy-permission
profile and accept those gates. Safe Bash is unchanged by this increment.

## Accounting review

Admission charges original UTF-8 argument bytes plus one separator byte per
argument, UTF-16 decoded string storage, conservative retained string/copy/array
reservations and bounded scanning/parsing work. Naming separately charges its
source path, decoded storage, possible stem/name copies and scans. Do not add
these independent helper receipts as though source paths were reread from VFS.

Encoding has no document input bytes: it charges supplied decoded UTF-16 storage,
fixed structures, two-pass work and exact expanded output bytes before allocating
the byte buffer. Bbox charges fixed formatting/chunk/string retention, XML
expansion and encoder work together. Retained figures are conservative declared
reservations, not measurements of VM heap size. Helpers are synchronous, have
zero recursion and retain no module-global invocation state or external resource.
Returned byte storage belongs to the caller. Document reads, parser recursion,
glyph retention, streams, sink cleanup and publication still require separate
invocation accounting and tests.

The first red run had two failing range/naming positive controls. The admission
increment had seven failing positive/negative controls; encoding then had three
failing controls plus a zero-work accounting regression. XML serialization had
three failing controls. Further red runs reproduced default-name accounting,
argv-iterator admission bypass, producer array-method calls and missing fixed
encoder retention for empty output. Each was implemented only after its red run.
The minimized authority cases are retained in unit tests. Independent UTF-8
checks use WHATWG TextEncoder and scalar boundaries with seed `0x0595ca8e`; they
are encoding controls, not a Poppler oracle or performance measurement.

Strict deviations: Unicode string argv and ASCII identifiers only; complete
decimal numeric tokens (no exponent/whitespace/degenerate tokens), checked
integers, positive DPI, UNIX platform-EOL profile, strict unmappable output
diagnostics and rejection of invalid XML scalars. No general native equivalence
is advertised. Six-decimal tie-rounding and native repair profiles remain open.

## Manual QA plan

1. Run the workspace unit task. Check that all controls pass without host fixture
   creation or external executables/network. Keep any failure open until fixed.
2. Run workspace lint, including source/test TypeScript checks. Build through
   `npm run build:workspaces -- --workspace=safe-bash-command-pdftotext --no-cache`.
3. Import the exact built `dist/index.js` in a Node ESM session. Independently
   inspect range normalization, the literal-after-delimiter operand, raw-over-
   layout precedence, an escaped XML word, and DOS/UTF-16 formfeed bytes.
4. In that session, abort before admission and attempt sign-only DPI and a bbox
   containing NUL. Check that all three fail with no I/O or fabricated output.
5. Review runtime imports and the private manifest. Confirm no external runtime
   closure, host executable, network, ambient file or dynamic dependency route.
6. Keep CLI screenshots, original/checkpoint/replay, packed public consumers,
   native matrix controls and VFS cleanup tests explicitly unverified. No CLI or
   invocation changed, so these cannot be executed against this candidate.

## Verification receipt

Passes on the final code candidate:

- `npm test --workspace=safe-bash-command-pdftotext`: 21 passed, zero failed,
  skipped or cancelled; individual test bodies remain fast. Startup/task duration
  is not a parser performance qualification.
- `npm run lint --workspace=safe-bash-command-pdftotext`: ESLint and source/test
  TypeScript checks passed.
- `npm run build:workspaces -- --workspace=safe-bash-command-pdftotext --no-cache`:
  maintained discovery selected the leaf closure and its fresh build passed.
- Manual QA steps 3–5 passed against built ESM: range `[1,3]`, literal `-f`
  after `--`, raw precedence, mixed-case name `x.Pdf.html`, escaped XML and
  UTF-16 DOS bytes `[0,65,0,13,0,10,0,12,0,12]` were inspected. Abort, sign-only
  DPI and XML NUL were rejected. Runtime imports are relative first-party modules
  only; the private manifest has an empty runtime dependency object.

All expected TDD failures were investigated and fixed; no failure or timeout
remains in these focused routes. Full repository checks were not run or claimed:
this increment is confined to a private leaf workspace and this document. Native
matrix controls, installed public-subpath tests, real CLI/SDK and VFS execution,
screenshots, realm/checkpoint/replay controls and document performance remain
unverified, as listed above. No local commit, verified remote-main delivery,
issue closure, publication or successful release is claimed. No temporary
evidence files were stored.
