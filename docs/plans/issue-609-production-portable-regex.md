# Issue 609: production portable regex provider

## Requirement and ownership

Supply a package-owned bounded regex provider through the published Safe Bash
browser entry. Consumers configure budgets and register portable search; they
must not copy or maintain the acceptance-only regex adapter. A deliberately
limited supported profile is permitted, but unsupported grep BRE/ERE/fixed,
rg Unicode/glob, and enumeration semantics must be rejected explicitly rather
than silently reinterpreted.

The top-of-list issue lane owns #609. Root coordinates public integration,
test membership, Git, publication, and artifact identity. Separate workers own
the provider implementation and independent real-workerd acceptance fixture.
Do not modify unrelated SafeJS work or immutable historical fixtures.

## Baseline

On September 4, 2026, the source exports a trusted `BoundedRegexProvider` seam
and public cooperative ERE primitives, but no production provider. The existing
portable-search workerd adapter is explicitly test-only. Registry version
0.1.58 is the baseline for all three scoped safe packages; verify the installed
browser export surface before counting the missing behavior as reproduced.

The installed 0.1.58 browser entry exposes the seam and ERE primitives but no
factory. The extended maintained browser smoke fixture fails at its named
`createBoundedRegexProvider` import against that installed baseline. This is
the public-integration red result, separate from the provider's focused tests.

Independent review reproduced a second red case: raw BRE `a^b`, `a$b`, `a^`,
and `$a` select literal text in native C-locale grep but were initially passed
unchanged to ERE and silently failed to match. The supported BRE profile must
reject those interior-anchor forms explicitly, including zero-row admission;
only boundary anchors are claimed. Preserve the valid bracket-literal cases.

## Implementation requirements

- No host processes, Node workers, browser Worker assumption, native guest
  RegExp execution, or new runtime dependencies.
- Explicit profile validation even for empty input batches.
- Admit request, pattern, input, intermediate state/capture, and result bounds
  before allocation; document concrete accounting and aggregate endpoint bounds.
- Cooperative work checkpoints through admission, parsing, matching, encoding,
  output construction, and retirement; timers alone are not work limits.
- One reply per admitted request; reject concurrent endpoint submission rather
  than retaining an unbounded queue. Close admission before retirement, cancel
  admitted computation, observe its completion, and await idempotent termination.
- Preserve original-byte result spans and exact output bytes for supported
  inputs. Explicitly reject unsupported encodings instead of lossy conversion.
- Keep custom-provider injection available and do not change default command
  registration or implicitly enable network/host capabilities.

## Verification and release sequence

1. Reproduce missing behavior against the installed baseline and add focused
   failing tests before implementation. Independently exercise supported modes,
   unsupported descriptors, empty batches, malformed/invalid UTF-8, hostile
   patterns, boundary budgets, cancellation, duplicate replies, and retirement.
2. Register new canonical tests by exact literal path. Run focused maintained
   tests, the normal workspace build, public consumer checks, and guarded lint.
3. Package the normal built artifacts into a fresh consumer. Bundle only public
   installed browser imports with workerd/worker/browser conditions; inspect the
   module graph for repository source, Node modules, shims, and unresolved imports.
4. Execute the independent fixture using pinned workerd 1.20260904.1, no Node
   compatibility flags. Require exact-byte, hostile-pattern, abort/budget,
   invalid-UTF8, cleanup/recovery assertions and an explicit completion marker.
   A successful browser bundle alone is not runtime acceptance.
5. Commit only this issue's owned files, push main, and monitor both root and
   scoped-safe publication. A local packed artifact is not a registry release.
6. Install exact newly published registry versions in a fresh consumer. Repeat
   the same real-workerd acceptance against those imports and record versions,
   integrity/tarball hashes, resolved module paths, runtime version, commands,
   raw logs, and actual results. Close #609 only after this evidence passes.

## Manual acceptance record

Keep candidate and registry runs separate. Record failed attempts beside fixed
reruns. The acceptance fixture supplies assertions, not another implementation;
this markdown document is the QA procedure. A local workerd result does not
claim a deployed Cloudflare service or full regex dialect parity.

## Local candidate result (September 4, 2026)

Candidate based on main `3deecc0c4`, with only #609 edits intended for this
commit. Existing SafeJS edits were preserved, not staged; the local candidate
is not a claim about a clean published SafeJS runtime. Registry acceptance
against GitHub-built artifacts remains required after this commit is pushed.

- Normal `npm run build`: passed.
- Provider focused red/green and independent follow-up review: 14 tests passed.
- Serial node:test through `npm exec --workspace=virtual-bash` for the ten
  regex-execution suites, grep-pattern-admission, and integration-inputs:
  249 passed, zero failed/skipped. This includes exact new-test membership.
- `npm run lint:eslint`: complete, 9,654 configured/linted files, zero errors
  or warnings, all 25 receipts retained.
- Installed-package browser smoke and strict NodeNext public types: passed.
- Pinned workerd 1.20260904.1: all 63 acceptance cases passed, including actual
  active cancellation across two cooperative turns and fully awaited retirement.
- Bundle graph: 30 inputs, all from installed artifacts or the two acceptance
  fixture modules; no external imports or repository-source aliases.

Local artifact version is `0.0.0-issue609`, not an npm publication.
Tarball SHA-256 values:

| Package | SHA-256 |
| --- | --- |
| safe-fs | fb2838a63799f8b66e228e7847ece7fff3d2bbaad08c5cfd26a125a721071250 |
| safe-js | 9b2d2be08e0cc471c217f93f2e2dcd5742b94ab24eb9f7dd0b66bd29a559cb64 |
| safe-bash | cd61b9599048dc71c2640b3ed5b9069b9b85f7a5a8448ce20672b3a2d97f0691 |

Evidence is retained in `/tmp/poe-regex-609-tools.mdWabe` (build, lint, unit,
baseline failure, artifact identity, and workerd logs),
`/tmp/poe-regex-609-consumer.PoqOHI` (installed candidate), and
`/tmp/poe-regex-609-workerd.pNvtED` (bundle, config, and metafile).
The installed browser entry SHA-256 is
`637573e0e99fe529f966d7924d66d40ffb32c83e0caa326f2e94e63da3494be3`.
Record the separate registry acceptance and successful release runs on #609;
do not turn this local record into a claim of publication.
