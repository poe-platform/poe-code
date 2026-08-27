# Independent WebDAV recognized-scope fix acceptance

August 27, 2026. **Accepted only for the contradictory recognized LOCK-scope
defect at source `69672fe210fbf8a23cc980828bb46d073b078425`.** No production,
author-fixture, root-config or private-repository changes were made by this review.
Later rmdir work is not part of the frozen input or acceptance.

## Frozen source and unchanged oracles

The matched parent is `f73ff3aacd8889fbc2c1e835e2d237f572879ab7`.
Its only product difference from the fixed archive is the additional direct
namespace-aware `davChild(scope, "shared")` rejection in `webdav.ts`.
The fixed source SHA256 is
`d61d6d36eeea65f0c7e6eb5ecbe118e353ffe5a87131e4e26c1a3d772ee71acf`.
The fixed source/config archive SHA256 is
`6415f4081746015a0b42060e93622869e3d3b2fcf3a7b6ed4c5fd5d4ec585c7e`.
Both independently built provider packages match author evidence `da44144`:
`dd1efd2f90061c52bc0c40aee73ba8156e91c6da69e4e22022d1a0e74492a1f0`.

The original `independent.mts`31 cases retain SHA256
`41c2fe53195bc78d7c695836897f6ff1001164b897e68775bf02ce51166d2923`.
Original public/raw/direct fixtures remain pinned to `1c745c3`. Their names,
kinds and results are checked against the preserved original independent report,
not merely compared by total. No golden bytes, expected status or input was changed.
The original source `e8acecc` failures remain in `REPORT.md` and `evidence/`.

## Independent before/after

All table entries are **pass/total**; failed positives are not refusals or skips.

| Actual provider | Original31 parent | Original31 fixed | New16 parent | New16 fixed |
| --- | ---: | ---: | ---: | ---: |
| Apache2.4.66 |28/31|31/31|10/16|16/16|
| WsgiDAV4.3.5 / cheroot11.1.2 |29/31|29/31|10/16|10/16|

The three original Apache regressions now produce typed **ENOTSUP before any
COPY/MOVE**, retain the native nine-byte source and `OLD` target names/bytes,
and release the acquired lock with adapter **UNLOCK204**. The same assertions
fail on the immediate parent: COPY publishes and MOVE also removes source.
Native witnesses and complete request/response observations are retained.
An extra teardown UNLOCK is separately recorded and is not credited to the adapter.

The new16 controls exercise COPY and MOVE for eight namespace/shape variants:
alternate-prefix DAV:shared, default-namespace DAV:shared, foreign shared,
DAV:shared nested in an unknown extension, unknown DAV scope child, duplicate
exclusive under a second prefix, foreign exclusive replacing recognized exclusive,
and mixed scope with a correct modern lockroot. The three mixed-scope variants
catch six failures on the parent and pass unchanged on the fix. Valid extension
positives prevent a deny-all or unknown-child-whitelist implementation from passing.

WsgiDAV's two original binary transfer positives and six new extension positives
still fail at its **unframed Lock-Token** boundary. These are retained failures,
not new product regressions. All16 new WsgiDAV rows are masked by that earlier
token rejection; even the10 passing refusal controls do **not** exercise deeper
scope parsing. Its production headers are never repaired by this review.

## Original matrices remain unchanged

| Profile / original cohort | Positive | Guard | Refusal |
| --- | ---: | ---: | ---: |
| Apache raw |9/9|7/7|0/0|
| Apache public |16/17|14/14|2/2|
| Apache direct |2/2|15/15|0/0|
| WsgiDAV raw |3/9|3/7|0/0|
| WsgiDAV public |10/15|13/13|4/4|
| WsgiDAV direct |0/2|13/15|0/0|

Apache's first directory timestamp update remains the original EAGAIN positive
failure. Default COPY/MOVE with truthful configured native authority still work.
WsgiDAV remains an unsafe overwrite profile in the original conditional/alias
observations: stale destination conditions can publish, alias paths bypass locks,
and late cleanup can leave a grant. Invalid validators/tokens are rejected by the
adapter. Wrong-token423 versus expected412 is a retained status disagreement,
not evidence of data loss. This fix certifies none of those server behaviors.

## Validation, protocol and isolation

At exact69672fe the unchanged **564 backend,23 legacy LOCK,23 authority,
5 timestamp,49 alias** cases pass, plus the author's unchanged **28 scope** cases.
The separately repeated14 constructor cases are already included in564 and are
not additional unique coverage. All these test runs have zero failures/skips.
Strict scoped TypeScript, isolated source/declaration build, packed public
root/subpath consumer compilation and execution pass. Import guards reject
Workspace-source fallback and resolve product imports only inside the extracted
consumer package. Runtime dependencies remain empty. The parent service-only run
does not claim a repeated unit validation gate.

Fresh primary RFC4918 sections14.13/17 and RFC2518 lockscope rules, plus tagged
Apache/WsgiDAV source hashes/excerpts, are archived in `scope-fix-evidence/primary.json`.
Recognized exclusive/shared alternatives are contradictory; foreign and unknown
extension children must not be treated as competing recognized scopes. The change
preserves the existing absent-only legacy lockroot compatibility and other grant
checks. Injected malformed grant bodies retain genuine server token/status/URL
and corrected Content-Length: this is not a claim that Apache emits mixed scopes
or actually grants shared locks in these tests.

Pinned binary/module hashes, wheel locks, synthetic credentials, loopback TLS
configs/certificates, native backing witnesses and public import URLs are captured.
Task-owned service processes exited and temporary service/tool roots were removed.
No existing server, global config, private checkout or external DAV data was used.
Outside capture directories contain evidence only, not active service resources.

The first reviewer attempt omitted `credentials: "omit"` in **manual teardown**.
The explicit test transport rejected it after the unchanged31 run, so both capture
processes exited1 before the full matrix finished. `attempt1/` preserves the input,
logs and cleanup. The one harness correction adds that required teardown option;
no product code, assertion or expected result changed. The completed replays are
`final/` and `parent/`. JSON compaction is checked losslessly; artifact hashes
record original and archived bytes. Raw TAP/diff whitespace is preserved.
The initial evidence archiver stalled while feeding a large patch through a
child-process pipe; only that owned archiver was stopped. It resumed by validating
already archived bytes and supplying apply_patch a regular temporary input file.
No service replay, recorded outcome or source input changed during that recovery.

## Reproduce and acceptance boundary

Use fresh outside directories:

```sh
node tests/fs/webdav/real-service-independent/run.mjs /tmp/dav-fixed-review 69672fe210fbf8a23cc980828bb46d073b078425 --scope-review
node tests/fs/webdav/real-service-independent/run.mjs /tmp/dav-parent-review f73ff3aacd8889fbc2c1e835e2d237f572879ab7 --scope-review --services-only
node tests/fs/webdav/real-service-independent/scope-seal.mjs --check
```

Outer capture exit0 does not mean all behavioral rows pass. Original service
runners still exit2 for the documented matrix failures. Machine-readable
`scope-fix-evidence/CHECKPOINT.json` separates every cohort and the exact three
regression postconditions. There is no full-provider, rmdir, atomic rename,
rollback, arbitrary-server, whole-suite or broader-goal acceptance here.

The separate FS canonical reconciliation review is committed as `ad837f1` under
`tests/integration/full-gate-20260827/authority-reconciliation-independent/`:
original58/83 remains historical, revised85/85 is an explicit fixture reconciliation,
and both original remote-rmdir workflow failures remain outside that acceptance.
