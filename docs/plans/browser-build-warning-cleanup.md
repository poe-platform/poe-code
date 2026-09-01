# Browser build warnings

The current playground build still reports two direct-eval warnings and a
3.69 MB minified session chunk. Guarded ESLint is clean; these are separate
build findings and must not be hidden by warning filters or higher limits.

Both eval sites belong to browser VM polyfills. Inspection of the actual bundled
input graph identifies `browser-crypto.mjs` re-exporting the entire JSPM crypto
implementation, including VM and unused asymmetric algorithms. The prebundled
filesystem is not the cause; there is no need to wait for a new engine release
or change the pinned poe-code 14.0.4 engine.

Replace that broad crypto polyfill with the six checksum algorithms actually
used by the command bundle from exact `@noble/hashes` 2.4.0, plus Web Crypto
random bytes and version-four UUIDs. Retain incremental hashing, encoded input,
binary digests, bounded entropy requests and all existing browser commands.
Keep the dependency development-only and emit its MIT license with the existing
license assets. No warning filters or chunk-size-limit increases.

TDD: the old bundle fails the no-VM dependency assertion and deterministic host
entropy control. Compare every checksum algorithm with Node, including chunked
binary input, empty input, string encodings and finalized-state rejection.
Run the full kernel/platform suites and production build; inspect browser
screenshots before delivery. Preserve worker cleanup and cancellation controls.

All 49 kernel/platform tests pass. The production build has no eval warnings and
the session chunk falls from about 3.69 MB to 1.301 MB. The remaining chunk-size
warning is not suppressed; address module splitting as a separate improvement.
Headed browser QA verifies all six `cksum -a` algorithms, gzip round trips, tar
listing and grep worker execution. Screenshot inspected at
`output/playwright/browser-crypto-checks.png`; output is readable and error-free.
