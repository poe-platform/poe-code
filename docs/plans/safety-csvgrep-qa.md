# csvgrep resource and failure boundary QA

Qualify the working tree using the moved package pattern at
`docs/plans/archive/safe-bash-command-package-pattern.md`. Preserve unrelated
edits. Native executables are not unit dependencies; do not inspect held XAN
sources or publish the private command workspace.

1. Run maintained csvgrep workspace tests and lint (including source/test
   typechecks). Test exhausted diagnostic budgets, each independent quota,
   fresh invocation, blocked output cancellation, idempotent cleanup, chunk
   splits, hostile byte constructors, match-file whitespace and CLI/SDK parity.
2. Build the maintained selected safe-bash dependency closure. Then run actual
   Shell csvgrep boundary tests: VFS `.sh`, pipeline, redirects, partial quota
   failure, conditional success gating, same-file and symlink aliases, missing
   host files/URLs and absent executable/network command dispatch.
3. Run maintained private bundling, package-safe, publication admission and
   publication verification suites. Their memory-VFS isolated consumer must
   retain canonical contracts without private workspace availability.
4. Execute built public entry manual controls with memory VFS only. Import
   modules before instrumenting host filesystem reads, child process, HTTP(S),
   socket and fetch capabilities. Deny credential-name environment reads.
   Compare CLI and SDK bytes; exercise VFS match files, host paths and URL
   operands; dispose. Restore monitored APIs before process exit.
5. Inspect a terminal screenshot of actual Shell-dispatched csvgrep output and
   failure. No screenshot tests. Temporary evidence goes in `/out`; if the
   host root is read-only, record that failure and use task-owned ignored
   `out/safety-csvgrep`, then purge it.

Required limitations: stdout streaming and Shell redirects are not atomic.
Same-file redirects truncate before reads; a conditional follow-up is not an
exclusive publication primitive. Unqualified regex/CSV profiles are unsupported,
not passing compatibility cells. Actual browser/workerd engines and independent
original/checkpoint/replay qualification require separate receipts. Bounded work
assertions are deterministic accounting checks, not performance measurements.

## Findings and receipts

The independent outputBytes2 fixture reproduced a diagnostic reservation throwing
`CsvError LIMIT` instead of returning status1. Diagnostic emission now checks
remaining work, retention and output capacity; insufficient diagnostic capacity
leaves the failure status intact. Reservations still cover all emitted bytes;
sink errors and cancellation are not swallowed.

Initial test-authoring failures: the patternBytes0 cell used file mode, which
correctly does not charge a losing regex. It now selects regex mode. Initial
typecheck rejected a two-argument test sink against the one-argument public
output contract; the cooperative test sink now observes its controller signal.
An initial Shell quota run imported the previous command dist while the build
was in progress and reported an internal error; qualify again after the build.

Creating `/out/safety-csvgrep` failed: host root filesystem is read-only.

## Final candidate verification (2026-09-20)

Dirty working tree based on HEAD `ab1fa8d34101e1e7f61272973f3bc28a842043d8`;
these receipts qualify the recorded code, not a frozen committed archive.

| Candidate input | SHA256 |
| --- | --- |
| csvgrep command | `7b0370aaa991537c4cfbd9f3cde8fb35cef744ec8d0fcda0672d0bd24f2b8143` |
| command unit controls | `d39b64f9cf033da9ad9fd22272722a1fb123fa40f0068e2ab2ba890824a4e1ef` |
| Shell boundary controls | `12cc6ffb7502d1cb063cfdc96b6f0b83e421bf00d94edf9eee59171211050fa0` |

Passed:

- Final maintained csvgrep workspace unit route: 40 passed, no failures,
  cancellations or skips. Maintained lint/source/test typechecks passed.
- Shared CSV engine maintained unit route: nine passed, no skips.
- Actual Shell boundary selection: four passed, no skips; scoped ESLint passed.
  VFS scripts/pipelines/redirects and SDK parity, conditional follow-up gating,
  destructive same-path/alias redirects, quota partial output, absent host and
  network dispatch all executed. Existing byte-split, Unicode, multiline,
  hostile constructor, regex rejection and cleanup/error controls remain active.
- Maintained selected build closure:
  `npm run build:workspaces -- --workspace=@poe-platform/safe-bash` passed;
  resolver reported 89 workspaces, 21 builds, 242 edges, ten layers, no missing
  build declarations in the selected closure; optional CLI postbuild completed.
- Maintained artifact suites: 224 passed across four files (`package-safe`,
  `bundle-safe-bash-private`, `safe-command-publication`,
  `verify-safe-publication`). The isolated memory consumer removes workspace
  sources and executes in a Buffer-free realm with canonical contracts.
- Fresh public SafeFS/SafeBash tarballs installed offline, lifecycle scripts
  disabled, outside the checkout. Maintained private-command runtime fixture
  and csvgrep strict NodeNext declaration consumer both passed. No private
  command package was installed or published. Temporary consumer removed.
- Built-entry manual authority QA: CLI `csvgrep -cx -f/matches /input` and SDK
  exact parity with independent `a SPACE LF` match-file bytes. Missing host
  file/URL failed; absolute host executable returned127; disposal passed.
  After module imports, instrumented fs read/open/write/stream APIs (sync,
  callback and promise variants), child-process spawn/exec/execFile/fork,
  HTTP(S) request/get, socket connect/createConnection and fetch all had zero
  calls. Credential-name environment reads were denied for AWS access/secret/
  session, OpenAI and Anthropic keys; zero calls. Restored all monitored APIs.
  This qualifies these fixtures/APIs after loading, not hostile-JavaScript or
  module-loader isolation or every possible credential mechanism.
- Actual Shell-dispatched terminal screenshot inspected: selected rows and
  invalid-regex concise error/status are visible without a traceback. Generic
  maintained screenshot route was used for the Shell driver; poe-code's
  configure UI is not this command's entry. Task-owned screenshot/driver and
  staged evidence purged after receipts. `git diff --check` passed.

| Public tarball | SHA256 |
| --- | --- |
| SafeFS | `ddf729d64286d35322255b3af2be02ea9bbd8c08bb55c5135f3a5634d3137e7d` |
| SafeBash | `32b8a7bb726baee9aff4ba6fa3a68c0e39afacf34a416b895aecbbe16cef6ff8` |

Failed gate: `npm run typecheck --workspace=@poe-platform/safe-bash` exited2
before source compilation or consumer execution. Investigation traced it to
`resolvePeerProfile` in `tests/plugins/qualified-current-release/peer.mjs`:
the checkout profile requires root `poe-code` export `./safe-fs` mapping to
`./packages/safe-js/dist/safe-fs.js`; the current root manifest lacks that export.
The historical peer profile cannot qualify this standalone export graph.
Unrelated root/package/peer edits were preserved; no admission assertion was
weakened. The separate installed csvgrep declaration pass does not replace this
failed maintained gate. Initial regression/typecheck/stale-dist/test-authoring
failures above remain failed attempts, not passing reruns.

Not run/unverified: broad `npm test`, repository-wide lint and root suffix build
(implementation change is confined to the private command; shared runtime code
was not changed). Actual browser/workerd/Bun engines, native version matrix and
independent original/checkpoint/replay execution were not run. Upstream pinned
source variants beyond the existing documented profile remain unqualified.
Python regex captures, lookbehind, repetition and scoped flags, alternate
codecs/quoting modes and open ranges retain explicit unsupported profiles; full
csvkit compatibility is not claimed. Exclusive/atomic publication and automatic
same-source rollback remain unsupported. No bounded performance/RSS measurement
or generated fuzz acceptance is claimed; fixtures are fixed deterministic cells.

Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No publication occurred. This boundary repair is verified within the
passing selections; the failed typecheck and broader acceptance cells remain
open.
