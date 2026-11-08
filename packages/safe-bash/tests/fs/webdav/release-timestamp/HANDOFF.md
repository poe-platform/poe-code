# Helper author handoff

## Exact candidate

Helper/tests commit: `456a0738b0d2dc130ebbd9b7ccf5e299bcf177da`.
Changed helper: `tests/fs/webdav/consumer/provider.mts`.
Helper SHA-256: `af9ffdb0f991696818512c5f50dab94fdb76387d3b66a2abca80fb799d6d30b6`.
No production adapter, root integration, contract, manifest or independent-review
file changes. The original consumer test/example/type inputs are byte-identical
to failed release `02a78bf64c29dedcd69071551ed5848b0765c107`.

The helper now persists/readbacks the declared timestamp property and keeps the
representation validator stable for a verified timestamp-only update. This is a
helper semantics correction, not an expectation waiver or changed product promise.
The real-server unsupported timestamp profiles and prior release failures remain
immutable. Production EAGAIN on missing/mismatched post-readback remains required.

## Results, separated

| Cohort | Consumer13 | New helper19 | Unchanged postcondition5 |
| --- | --- | --- | --- |
| exact failed `02a78bf…` | 12 pass / 1 fail | not run | not run |
| initial current `96e051e…` | 12 pass / 1 fail | not run | not run |
| red regressions `96e051e…` | 12 pass / 1 fail | 3 pass / 16 fail | not run |
| dirty helper overlay on `96e051e…` | 13 pass / 0 fail | 19 pass / 0 fail | not run |
| final helper overlay on `f534134…` | 13 pass / 0 fail | 19 pass / 0 fail | 5 pass / 0 fail |
| committed `456a073…`, no overlay | 13 pass / 0 fail | 19 pass / 0 fail | 5 pass / 0 fail |

Every executed cohort has zero cancelled/skipped/todo tests. The nineteen helper
tests consist of four positive property/readback cases and fifteen rejection or
invalidation controls. These counts are not merged into old provider matrices.
All committed-candidate commands exit zero: isolated build, strict public consumer
types, declaration-resolution inspection, original consumer, new helper controls,
strict scoped postcondition types and unchanged postcondition tests.

The committed candidate's 164 actual loaded package modules are individually hashed
in `evidence/committed-candidate/runtime-closure.json`. Earlier cohorts loaded 157.
The seven added time-env modules originate in concurrent parent commit `41298e6`,
not this helper patch. No source fallback or repository package self-reference is
used. The separate consumer package is `webdav-release-timestamp-consumer` and the
actual extracted package export map is captured in each cohort's `package.json`.

## Reproduce / qualified release follow-up

```sh
node tests/fs/webdav/release-timestamp/run.mjs faraday-replay-1 456a0738b0d2dc130ebbd9b7ccf5e299bcf177da --regressions
```

Use a new label each time. To qualify a newer candidate, pass that actual frozen
commit instead; do not relabel this commit as current after further source changes.
Omitting `--regressions` runs only the original thirteen consumer tests plus its
strict build/public-consumer checks. No real-service download or full historical
release rerun is needed. Faraday's existing qualified consumer group already copies
the four unchanged filenames, including corrected `provider.mts`; no runner, export
or inventory migration is requested. Root/Faraday must independently rerun their
qualified candidate. This is not whole-release or independent acceptance.

## Hashes and cleanup

All exact archive/package/Node/compiler/fixture/source hashes and moving-worktree
status are preserved in each `baseline.json`, `package.json`, and runtime closure.
Final key hashes (SHA-256):

| Input | Hash |
| --- | --- |
| `src/fs/webdav/webdav.ts` | `e66a66e2745852c6bd12be12a18c855df069152cf6b8089d2ecee8880c62de94` |
| `src/fs/webdav/index.ts` | `d359fa8a89c30fa7fa06b256c524b4bc1022b3217763051961e579c5fcfd7764` |
| `src/fs/webdav/xml.ts` | `c5b2798ef847acb480be70348d59bb0bc0a0d80624c313880cd53ff1b293dec1` |
| packed product archive | `886abaa12224883a4c6efe728347e06fa1b17965b756b37f1dba1bea2f1d245f` |
| unchanged `consumer.test.mts` | `b69e78c54d5afb844cef7f59c4d530e1ddad6634394a32e56e455b7a7bce752a` |
| unchanged `example.mts` | `7a51aed0e78cc30d54dfa1b616c9e659710bed4f0a4cd7e42e28258a974f7b15` |
| unchanged `types.mts` | `90ad547d0b4ff13cb0b5fc4f79b26b8b59ceac144adea8de4f511b421663d028` |
| unchanged postcondition test | `4aa5f6f6b79b4952e282cdbc68d00c43869ff5536ebcd35ba23dba8fbbd6a263` |
| new `timestamps.test.mjs` | `49b8d03876f3d7912018d54bb2a2f1c6631668fd0f7353afc0ca904ff3eccd21` |

The three production WebDAV hashes match both exact failed and initial-current
baselines. The runner records the actual loaded binary closure, not only source
hashes. All six owned workspaces are removed in finally; no `.work-*` remains.
HTTP servers/connections close in helper finally, no service child is spawned, and
test processes exit. Downloads/dependencies/global/private writes: none. Unrelated
concurrent changes and staging are not included in either owned commit.

## Remaining limits

The helper's one-property parser, metadata-only validator profile and backing stamp
are intentionally bounded (see README). They do not establish general DAV support,
concurrent host mutation safety, ABA protection or real-provider timestamp support.
No rollback is promised after partial backing failure. No change is made to accepted
atomic-empty-directory source or any source lock/token/authority validation. This
helper-only author checkpoint fixes the measured consumer blocker; it does not
substitute for the separate qualified-release decision.
