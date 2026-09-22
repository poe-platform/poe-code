# csvstat independent qualification

## Candidate and disposition

Inspected 2026-09-20: HEAD `35d01c57f8078d8afa916dc59929395d857e9c55`
plus the existing dirty working tree. This is not a frozen source candidate.
Inspection runtime: Node v22.22.2, npm 10.9.7.

**Qualification incomplete: candidate implementation absent.** No
`packages/safe-bash-command-csvstat` directory, csvstat public export, or
csvstat dependency exists. No admitted csvsort/shared CSV inference engine is
available. These are repository findings, not failing runtime cells. There
are no candidate stdout/stderr bytes, statuses or effects to compare.

The requested pattern is locally deleted; its
[archived copy](archive/safe-bash-command-package-pattern.md) was read without
restoring it. Preserve unrelated edits. XAN remains integration-held; its
implementation was not read or adopted. See the
[engine prerequisite evidence](safe-bash-csvstat-engine-prerequisites.md) and
[wiring prerequisite evidence](safe-bash-csvstat-wiring-prerequisites.md).

Do not create a placeholder package or claim compatibility from oracle-only
results. Implementation belongs in the private, dependency-free
`safe-bash-command-csvstat` workspace; safe-bash only composes/exports it through
`@poe-platform/safe-bash/commands/csvstat`. Installed implementation and
declarations must resolve without that private package being installed.

## Independent semantic controls

Use the exact twelve fixtures and operation/output goldens in
[the acceptance matrix](safe-bash-csvstat-acceptance.md). The following additional
hand-calculated controls discriminate common implementation mistakes. Strings
define UTF-8 bytes without BOM; each invocation uses `-y 0 -c v`. All listed
scalar expectations include final LF, empty stderr and status 0. These are
independent expectations, **not executed candidate or newly captured native
results**. No tolerance applies to scalar bytes or counts.

| ID | Exact input string | Separate flags and expected stdout | Discriminates |
| --- | --- | --- | --- |
| SAMPLE | `v\n2\n4\n6\n` | `--sum`: `12\n`; `--mean`: `4\n`; `--stdev`: `2\n` | Sample variance versus population variance |
| SINGLE | `v\n2\n` | `--stdev`: `None\n`; `--median`: `2\n` | Unavailable versus zero |
| NULLS | `v\nNA\nNULL\n.\n` | `--unique`: `1\n`; `--non-nulls`: `0\n`; `--sum`: `None\n` | Null included in identity but excluded in arithmetic |
| TIES | `v\ny\nx\ny\nx\nz\n` | `--freq`: `{ "y": 2, "x": 2, "z": 1 }\n` | First-occurrence tie order |
| SIX | `v\na\nb\nc\nd\ne\nf\n` | `--freq --freq-count 0`: `{ "a": 1, "b": 1, "c": 1, "d": 1, "e": 1 }\n`; `--freq --freq-count -1`: `{  }\n` | Zero defaults to five; negative means empty |
| CODEPOINTS | `v\n😀\nÁ\nﬀ\n` (A then U+0301) | `--len`: `2\n` | Neither UTF-16 length nor grapheme count |
| CANCELLATION | `v\n10000000000000000\n0.1\n-10000000000000000\n` | `--sum`: `0.1\n` | Binary64 sequential addition loses the middle term |
| FRACTION | `v\n0.1\n0.2\n-0.3\n` | `--sum`: `0\n` | Exact decimal cancellation |
| EXTREME | `v\n9007199254740993\n9007199254740992\n` | `--unique`: `2\n` | Identity must precede float serialization |
| RECORDS | `v\n"x\ny"\n"z\nw"\n` | `--count`: `2\n` | Records versus physical lines |

For EXTREME structured output, independently expect sample stdev
`0.7071067811865476`; both JSON frequency values round to
`9007199254740992.0` while remaining separate entries. Compare native JSON
bytes separately from internal exact Decimal identity. For a numeric semantic
stdev comparison only, predeclare absolute tolerance `1e-15`; this does not
authorize byte differences, omitted keys, or differences in other statistics.

Repeat all scalar fixtures with whole-input, one-byte, every two-part byte
split, and producer-reused chunks. In particular split inside the emoji, CRLF,
escaped quote and quoted newline. Input producer fragmentation must not change
bytes/status/effects. Candidate SDK and CLI must agree using equivalent explicit
options and memory VFS; invoke through the real registry, script and pipeline.

## Manual oracle procedure and evidence ledger

Execute QA from this Markdown once a real candidate exists. Native processes
are manual controls only; do not spawn them or fetch fixtures from unit tests.

1. Freeze the candidate commit and record dirty-file hashes if any. Record exact
   public artifact hashes for installed-consumer checks. Authenticate exact
   csvkit/agate distributions and the temporal source hashes recorded in
   [the acceptance matrix](safe-bash-csvstat-acceptance.md) before reruns.
2. Record Python, csvkit, agate, Babel, Unicode, parsedatetime, isodate and
   pytimeparse versions; Decimal precision 28/ROUND_HALF_EVEN; explicit UTF-8
   input, output encoding, C locale, timezone and clock/reference-day policy.
   Do not reuse historical relative-date output as frozen-clock evidence.
3. Run the acceptance fixture set and the ten supplemental fixtures above.
   Capture exact argv, fixture bytes/hash, raw stdout/stderr, status and effects
   independently for native and candidate. Keep release 2.2.0/1.14.2 controls
   distinct from csvkit `194c904256a09dc203c460944d35e9d414244503` / agate
   `34856488cfcbe9077af8e3e557cbf98a044fdd64` source-derived expectations.
4. For each difference record a minimized fixture and reproducible seed if
   generated. Add a fast failing memory-VFS regression before repairs. Record
   whether the fix implements compatibility or an explicit bounded deviation.
5. Run maintained package lint/test/build closure after repairs, then public
   packed runtime and strict NodeNext declaration consumers without private
   workspaces. Inspect a CLI screenshot for any visible behavior change.

The ledger must contain, per cell: candidate identity, oracle profile, fixture
ID/bytes/hash, argv/SDK options, chunk schedule, capabilities/quotas, expected
and actual raw stdout/stderr/status, completed VFS/capability effects, cleanup
settlement, comparison rule, difference and disposition. Store temporary logs
in `/out`, purge after durable capture. Performance timings belong in a separate
bounded measurement ledger and cannot establish semantics.

## Required negative and boundary cells

All cells below are **unverified**, rather than passing, failing, or skipped.

| Family | Required controls |
| --- | --- |
| Grammar/order | Each pair of operations; operation with CSV/JSON/count; names shortcut; CSV+JSON precedence; count bypasses invalid selectors/inference; unknown flags; repeated identical switches |
| Shared reader/selector | Tab overrides delimiter; output comma/LF; physical `-K`; headerless a..z/aa/bb; numeric header positions; duplicate first wins; repeated selectors; no whitespace trimming; open ranges/zero; sniff failure; explicit dialect overrides |
| Parser profiles | Quoted newline/CR/CRLF; escaped quotes; strictness and input quoting modes including QUOTE_NONNUMERIC float collapse; invalid UTF-8/encoding; BOM; NUL; malformed EOF; versioned diagnostics/status |
| Formatting | Python JSON spacing/float spellings/no LF; Unicode; indent zero/negative; CSV frequency without counts; unavailable omission/blanks; nonfinite serializer policy; custom-format quirks, invalid directives and bounded width/precision |
| Inference | Boolean precedence; whole-column elimination; leading-zero/currency/grouping/Unicode-digit controls; exact extreme Decimals; maxprecision cap; explicit formats; relative clock boundaries; duration defects; aware-instant identity and mixed-awareness errors |
| Cancellation/cleanup | Pre-abort without acquisition; abort during input/inference/aggregation/output; producer throw; sink reject; cleanup registered before acquisition, idempotent and awaited; cancellation/quota/internal failure never converted to unavailable statistic |
| Quotas/effects | Input, records, cells, codepoints, distinct-map/frequency work, decimal expansion, inference work, format/indent/output limits at boundary and boundary+1; no partial success; rollback of failed reservations; explicit completed-effect ledger |
| Authority/realms | No host files/process/network/download/native fallback; denied VFS paths; canonical byte/error/argument identities; owned retained chunks; backpressure; realm execution without ambient process/Buffer/require |
| Integration | CLI/SDK/script/pipeline equivalence; installed export/types without private workspace; opt-in registration; original/checkpoint/replay where affected, with deterministic injected capabilities |

## Current receipt

Repository inspection passes: missing package directory, missing export/dependency,
and held XAN paths are confirmed. No runtime candidate exists, so semantic,
syntax/runtime/lint/build, native comparison, installed artifact, screenshots,
realm, cancellation, quota and replay gates are incomplete. No native controls
or performance measurements were executed. No numeric tolerance was applied.
No code repair or regression test was fabricated for absent APIs.

Only this qualification document was added. Local commits: none. Verified
remote-main delivery: none. Successful releases: none. No private package was
published. Full compatibility remains unclaimed.
