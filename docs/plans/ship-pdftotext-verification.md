# ship-pdftotext packed-export and documentation verification

Executed 2026-09-21 against the current working tree, preserving unrelated edits.
The requested package pattern is at its existing
[archived location](archive/safe-bash-command-package-pattern.md).
This task changed documentation only; no speculative repair or extraction
implementation was introduced and no code TDD cycle was bypassed.

## Markdown QA and results

1. Inspect `packages/safe-bash-command-pdftotext/package.json`, its source and
   `packages/safe-bash/src/commands/pdftotext/index.ts`. The package retains name
   `safe-bash-command-pdftotext`, `private: true`, TypeScript ESM and empty
   runtime dependencies. Safe Bash only exports/composes it; first-party
   contracts are development inputs bundled into the public artifact.
2. Review admission, encoding and invocation ownership. Explicit cancellation,
   conservative argument/encoding accounting, cumulative stdout/stderr limits,
   owned output operations and awaited cleanup remain intact. Extraction fails
   with 99 before PDF input or named output acquisition. No host executable,
   ambient filesystem, network, native/WASM fallback or dynamic download was
   introduced. Existing shell redirects have their own effects; command-level
   output preservation is not a claim of atomic shell redirection.
3. Run `npm test --workspace=safe-bash-command-pdftotext`: 37 passed, zero
   failures, skips or cancellations. Run
   `npm run lint --workspace=safe-bash-command-pdftotext`: ESLint and production
   and test TypeScript checks passed.
4. Execute existing memory-VFS integration controls using
   `node --import tsx --test packages/safe-bash/tests/plugins/pdftotext-{boundaries,independent-controls,wiring}.test.ts`:
   seven passed, zero failures, skips or cancellations. These exercise opt-in
   registration, CLI/SDK equivalence, input/output preservation, pipelines,
   redirects, host/network isolation and unavailable extraction.
5. Run `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`:
   maintained selected build closure passed, including native postbuild;
   shared-cache mode reported 26 builds. This is not a full repository gate.
6. Stage final documentation with `scripts/package-safe.mjs` as
   `0.0.0-ship-pdftotext`. Pack only public Safe Bash, SafeFS and SafeJS with
   scripts disabled. Install offline outside the checkout with scripts and
   workspaces disabled and legacy peer resolution. `npm ls --all` passed.
   The lock inventory contained no private command/contracts package.
7. Execute maintained `safe-packages-pdftotext.mjs` under default, browser and
   workerd conditions: all passed. This tests real Shell invocation, canonical
   argument ownership, opt-in help, strict attached-option rejection, SDK/CLI
   equivalence and preservation of an existing output when extraction fails.
8. Compile maintained `safe-packages-pdftotext-types.mts` with strict NodeNext,
   ES2022, exact optional properties and unchecked indexed access, under default
   and browser/workerd custom conditions: all passed without `skipLibCheck`.
9. AST-scan all 1,346 installed Safe Bash JS/declaration files: no bare private
   command/contracts/CSV-engine specifiers. Public export targets resolve inside
   Safe Bash at `dist/safe-bash/commands/pdftotext/index.js` and `index.d.ts`.
10. Review the package README's exact admitted flags, examples, defaults,
    numeric/password deviations, helper outputs, limits and runtime profile.
    Update only the existing Safe Bash pdftotext support row. Run
    `git diff --check`: passed.

No visible CLI or document renderer changed, so new CLI/document screenshots
are inapplicable. Prior inspected command screenshots are recorded in
[wiring QA](safe-bash-pdftotext-wiring-qa.md). No shared code changed; full
repository routes were not run or claimed, and focused results do not qualify
unrelated shared edits.

## Candidate receipt and capability limits

| Public local artifact | SHA256 |
| --- | --- |
| Safe Bash | `f88fe228cfc6f7e35ca47d1c3ac1170fab56d5f04a2830875bafb6c819842665` |
| SafeFS | `8e24a7b20483f94e06f016c283d120d89a6cf9fcb13c8f16f5569588be8cf1d7` |
| SafeJS | `ae4e291b6289311c1813a426464f4e35e67b83401dee329e57c96d43af365842` |

These are local candidate hashes, not publication evidence. Browser/workerd
conditions were exercised in Node, not actual browser/Workers engines. PDF
parsing, font/CMap/ActualText, glyph geometry, reading order, extraction formats,
password decryption and permission enforcement remain unavailable and
`extractionQualified` remains false. Pure encoding and bbox-word helpers consume
supplied text/coordinates and do not constitute extraction or document rendering.
Supplied pinned Poppler source/controls were not rerun and are upstream research,
not executed first-party parity controls. No permission-enforcement profile is
advertised; no PDF-open/output-open/copy-denied status fidelity is claimed.

Absolute `/out` creation failed because the root filesystem is read-only.
Temporary evidence used task-owned ignored `out/ship-pdftotext-20260921` and an
outside-checkout `/tmp/ship-pdftotext-consumer.*` directory, purged after use.
Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No private package publication, public publication or push occurred.

## Independent current-tree review

Rechecked 2026-09-21 without modifying runtime code or other contributors' files.
The existing package README and Safe Bash support row already document the
current admission-only capabilities, exact flags, outputs, limits and runtime.
Reviewed command admission, SDK option snapshots, output ownership, cancellation,
cleanup, helper accounting and the public composition boundary. No validated
repair or supported simplification was identified in this shipping scope.
PDF extraction remains unavailable; this receipt does not complete the separate
parser/font/layout/security acceptance work or supersede historical findings
about those prerequisites.

Fresh package tests: 37 passed, no skips. Package lint and both TypeScript checks
passed. All seven memory-VFS boundary/independent/wiring controls passed. The
maintained selected Safe Bash build closure passed with the shared cache.
No shared code changed, so full repository routes were not claimed.

Packed public libraries at candidate version `0.0.0-ship-pdftotext-review` and
installed offline outside the checkout, with scripts/workspaces disabled and
legacy peer resolution. After installation completed, `npm ls --all` passed
and lock inventory contained no private command, contracts or CSV-engine
package. Maintained pdftotext runtime and strict NodeNext declaration fixtures
passed under default, browser and workerd conditions, without `skipLibCheck`.
Additional installed helper controls verified bbox/raw precedence, page-range
sentinels, checked uppercase PDF suffix removal, UTF-16 DOS EOL/formfeed bytes
and XML escaping/six-decimal coordinates. An AST scan of 1,346 installed Safe
Bash JavaScript/declaration files found no bare private-package imports.

An initial consumer check ran before asynchronous installation and fixture
copying completed and reported a missing fixture; rerunning after completion
passed without changing product code or assertions.

| Public local artifact | SHA256 |
| --- | --- |
| Safe Bash | `81096b5b6b58a0df7991d50b30cb1b22e2e7cb1b159fe81f711be5df144c7403` |
| SafeFS | `75a022e9c7f7582d14dd7070125fefb71c95c7b1ac1a40d03b7ab05ffc59c300` |
| SafeJS | `c6b5b524fc2ad7e56e51f11d9ffc556e58920d5e5670a65b52e0a3639cf45eea` |

No CLI appearance or document rendering changed; new screenshots are
inapplicable. Browser/workerd conditions were checked in Node only. `/out`
creation again failed on the read-only root filesystem; task-owned ignored
`out/ship-pdftotext-review-20260921` and an isolated temporary consumer were
purged after use. Local commits: none. Verified remote-main delivery: none.
Successful releases: none. No package was published or pushed.

## Fresh packed-candidate verification

Executed 2026-09-21 for this task against the current working tree. Preserved
unrelated edits and followed the archived package pattern. Changed only the
command README example to a self-contained memory-VFS Shell invocation and
clarified that the pure helpers make no extraction/security compatibility claim.
The existing exact flag/limit/output tables and Safe Bash support row already
describe the implemented admission profile; no runtime code changed.

Markdown QA executed:

1. Inspect the private manifest, public composition/export, admission, byte
   encoding, cancellation, quotas and owned-output cleanup. The command remains
   `safe-bash-command-pdftotext`, private, TypeScript ESM, with no external runtime
   dependencies. Extraction is unavailable before input/output acquisition.
2. Run maintained package tests and lint: 37 tests passed, no failures, skips or
   cancellations; ESLint and both production/test TypeScript checks passed.
3. Run the memory-VFS boundary, independent-control and wiring tests: seven
   passed, no failures, skips or cancellations. These cover CLI/SDK equivalence,
   byte preservation, pipeline/redirect effects and negative host/network authority.
4. Run `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`:
   selected maintained dependency closure and postbuild passed in shared-cache
   mode. This is not a full repository gate.
5. Stage with `scripts/package-safe.mjs` at `0.0.0-ship-pdftotext-fresh`, pack
   only public SafeFS/SafeJS/Safe Bash with scripts disabled, and install offline
   outside the checkout with scripts/workspaces disabled and legacy peer
   resolution. `npm ls --all` passed; the installed lock has no private command,
   contracts or CSV-engine packages.
6. Execute maintained pdftotext runtime and strict NodeNext declaration fixtures
   under default, browser and workerd conditions: all six cells passed, without
   `skipLibCheck`. AST-scan installed JS/declarations: no private specifiers in
   1,346 files.
7. Execute the README example in the installed consumer. Independently check
   first/last sentinels, reversed ranges, short and uppercase PDF suffixes,
   bbox/TSV precedence in both orders, degenerate DPI, early colspacing/URL
   rejection before help and propagation of explicit cancellation identity:
   all passed. `git diff --check` passed.

| Public local artifact | SHA256 |
| --- | --- |
| Safe Bash | `b072492486ef6cd4eea486fcd4c298d4f745b17e5dfcdc11bb46184d6e8d068d` |
| SafeFS | `bff063c54527393fd6e4a84eed8a44a53819b528607cc1a84d6d02f8dca78d33` |
| SafeJS | `7b6452cdf8002bd20cfdb0ca28eafd63dcd666fd3d3071c0fd53eb6bbbe8b452` |

No failed or incomplete runs occurred. Full repository gates and upstream
native controls were not rerun: this task changed documentation only. Actual
browser/Workers engines remain unverified; condition selection was exercised
in Node. PDF/font/CMap/ActualText/layout, password and permission-profile parity
remain unsupported. No CLI appearance or document rendering changed, so new
screenshots are inapplicable. Original/checkpoint/replay execution was unaffected.

Absolute `/out` remains read-only. Temporary evidence used ignored task-owned
`out/ship-pdftotext-fresh` and `/tmp/ship-pdftotext-fresh-DpzZmk`, removed after
verification. Local commits: none. Verified remote-main delivery: none.
Successful releases: none. No package was published or pushed.
