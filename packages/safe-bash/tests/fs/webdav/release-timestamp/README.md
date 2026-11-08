# Qualified-release timestamp helper correction

Author checkpoint only; not an independent or whole-release acceptance.
Production `src/fs/webdav/**`, atomic-extension implementation, contracts,
qualified-release runners and every original/independent matrix remain unchanged.

## Root cause and scope

The unchanged failing consumer is `../consumer/consumer.test.mts:38`,
`built public consumer: existing-target mv to-remote through actual serialized HTTP`.
The exact failed release source is `02a78bf64c29dedcd69071551ed5848b0765c107`.
Its serialized loopback helper `../consumer/provider.mts` claimed timestamp
support but returned PROPPATCH success without storing/returning the property.
It also changed the ETag when backing mtime changed. Production correctly rejected
the missing/mismatched timestamp binding with EAGAIN before reporting move success.
The production post-readback requirement from `4143efd` is not relaxed.

Only the owned helper changes: persist the correctly namespaced timestamp property,
validate the single-property update before effects, verify actual backing times,
and preserve the representation validator for this verified metadata-only change.
Canonical directory trailing slashes share the same property/validator key.
PUT, DELETE/recreation and observed representation-stamp changes discard retained
metadata. Invalid namespace/shape/value/body validator or stale If-Match cannot
publish successful metadata. Unavailable/ignored backing utimes returns failure.
The server does not pretend PROPPATCH succeeded because it accepted a header.

The original thirteen consumer tests, typed public example and declaration tests
are unchanged. No new maintained `.mts` input or consumer inventory entry is added.
`timestamps.test.mjs` is a runtime driver staged beside the strictly compiled helper;
it is not runnable in place. Captured `.mts.txt`, `.ts.txt` and `.mjs.txt` files under
`evidence/*/inputs` are immutable input data, not canonical TypeScript fixtures.

## Bounded reproduction

From the repository root, using the already installed TypeScript/tsx tools:

```sh
node tests/fs/webdav/release-timestamp/run.mjs unique-label COMMIT --regressions
```

The label must be new. The runner resolves COMMIT once, archives committed source
and the four consumer inputs, builds in its own temporary directory, packs and
extracts `virtual-bash` into a differently named consumer package, and compiles
against that package's declarations. It runs plain Node against the extracted
runtime with filesystem reads confined to the consumer and no filesystem-write
permission. The actual Memory-backed HTTP server binds numeric loopback only.
Public root imports are unchanged; every actually loaded package module URL and
SHA-256 is captured. No repository self-reference, source fallback, network download,
new dependency, shared dist, global/home configuration or private filesystem occurs.

`--regressions` additionally runs nineteen new real-HTTP helper controls and the
five unchanged production postcondition tests, with strict scoped typechecking.
Each helper test records request/response status/body and backing observations even
when its assertion fails. The runner removes its entire owned workspace in finally;
each helper closes its server/connections in finally. No service child is spawned.
`--working-helper` explicitly overlays only the live helper for author experiments;
such a cohort is not labelled a committed candidate.

## Preserved cohorts

| Evidence directory | Frozen source / helper | Original consumer | New helper tests | Postcondition |
| --- | --- | --- | --- | --- |
| `exact-failed` | `02a78bf…`, original | 12 pass / 1 fail | not run | not run |
| `current-before` | current-at-start `96e051e…`, original | 12 pass / 1 fail | not run | not run |
| `regression-before` | `96e051e…`, original | 12 pass / 1 fail | 3 pass / 16 fail | not run |
| `helper-candidate` | `96e051e…`, explicit helper overlay | 13 pass / 0 fail | 19 pass / 0 fail | not run |
| `precommit-current` | current-at-run `f534134…`, final helper overlay | 13 pass / 0 fail | 19 pass / 0 fail | 5 pass / 0 fail |

The helper-candidate input also contained an incidental PROPPATCH href-encoding
change; it was removed before the author commit to keep this correction bounded.
All earlier inputs/results remain intact, not overwritten by the final replay.
Every listed cohort resolved 157 extracted runtime modules and removed its workspace.
The final committed replay and author commit are recorded in `HANDOFF.md`.

`baseline.json` records exact commit, source/helper/input/tool/node hashes and dirty
status; `package.json` records packed archive SHA-256 and actual public export map;
`runtime-closure.json` records loaded URLs and binary hashes; `commands.json` retains
full exit statuses/stdout/stderr; `summary.json` separates all test denominators and
cleanup. Original release 12/13, stock-provider matrices and native failures are not
reclassified or made green by this helper-only cohort.

## Limits

This is the existing bounded Memory-backed HTTP fixture, not Apache/WsgiDAV or a
general WebDAV implementation. Its parser supports exactly one timestamp `set` and
rejects mixed/remove/other-property transactions before effects. Its backing stamp
is dev/inode/size/mtime, not a content digest, lease, concurrency or ABA guarantee.
It verifies requested backing timestamps before publishing the property, but does
not promise rollback of an uncooperative backing operation that partially changes
state and then fails. Real providers may change validators on metadata updates or
omit the property; production must still reject unsupported readback as before.
No real-service download or replay is necessary to establish this fixture defect,
and none is performed. Root/Faraday must rerun the qualified candidate separately.
