# Independent fraction semantics review — bounded, qualified

Reviewer: new independent TIME-ENV fraction semantics thread, neither Curie nor
the prior fix verifier. No delegation; production, canonical tests, runtime,
exports, manifests and dependencies are untouched. Only this new directory is
owned. The packed reviewer’s new cases were not read, before or after freeze.

## Decision

| Change | Verdict |
|---|---|
| `%N` widths/ordered flags, f6406cd | **ACCEPT within the documented grammar/limits**;3114 new ordinary-directive comparisons agree with independently hashed GNU9.7/Darwin. |
| `%g`, c782363 | **ACCEPT qualified profile** for successful rendered calendar0000..9999. **REJECT** the unrestricted claim that GNU always uses `abs(ISOyear%100)`; two native/source counterexamples exist. |
| Exact bare `%-N` | **ACCEPT qualified virtual-clock policy**, already documented; **REJECT strict GNU9.7/Darwin parity**. GNU's hardware-resolution rewrite is genuine documented behavior. |

No supported-domain source defect was observed in this bounded cohort. This
does not approve source/docs self-correction, whole GNU date parity, three-tool
integration, default integration, performance superiority, or a full test gate.
ROOT should route the overgeneralized `%g` rationale to Curie. Source acceptance
is based on branch reasoning and domain boundaries, not a passing score alone.

## Freeze and execution boundary

`FREEZE.json` and commit `c7e7145` freeze312 new product cases plus1624 separate
native/source-proof groups before product execution. Frozen JSON SHA256:
`9dcdf67fbbf41076c96a5160d7a44edebd081b7b067bb11f919e1f10c71932f5`.

The candidate is the entire committed source at
`c7823633ee99f711f1319ace59d4cf2b7f622ecc`, tree
`47b9a9d5763c036bdb8eab8ee25091ae5bd64a20`; no old-baseline overlay or dirty
current source is substituted. All215 committed source/config/package files
are independently checked against `git show`. Both tsconfigs stay unchanged.
The archive excludes tests/evidence, not any product source. TypeScript builds
successfully using the existing read-only development tooling. Source and
compiled hashes are checked before/after execution; all temporary trees are
outside repository test trees and removed.

The consumer imports the compiled root Shell/MemoryFileSystem APIs and the
compiled `src/commands/time-env/index.ts` **leaf source entry**, never the private
formatter. There is no package-exported time-env entry at this commit, and no
claim otherwise. Every case runs actual Shell dispatch with exact argv checked
by middleware. The defaults remain65 with no date default and no root time-env
export; these assertions ran before the312 rows. Future integration is separate.

Synchronous import hooks reject outside-dist/symlink imports and SHA256-check
each loaded module against the freshly built archive. An intentional import
of this review's `cases.mjs` is rejected before product imports. Node22.22.2
uses a256MiB heap cap, a60-second parent process deadline, and2-second per-Shell
signals. Native processes have3-second deadlines and bounded buffers. No host
clock-setting invocation, private runtime, new dependency, or host config change.

## Exact results, not a green rerun

| New cohort | First-run result | Strict native result |
|---|---:|---:|
| Fraction width/flags |18/18 groups,3114 directives|18/18|
| Bare-N explicit/escaped controls |18/18 virtual-policy assertions|1/18|
| ISO arithmetic / year and century neighbors |228/228|228/228|
| Epoch boundaries across six zones |18/18|18/18|
| Injected-clock precision / sample count |10/10|not measured against a host clock|
| Allocation/width/output admission |4 pass,6 harness failures|2/2 bounded native witnesses|
| Unsupported modifiers |3/3|not claimed native parity|
| Invalid Gregorian dates |5 harness diagnostic failures|not measured|
| Proposed legacy-positive inputs |2/2 virtual assertions|1/2|
| **Total** |**301 pass /11 fail of312**|**268/286;18 strict mismatches retained**|

Every row has exact status/stdout/stderr hex, argv, locale/zone, clock value,
sample count, middleware dispatch, write count and elapsed time. Explicit input
samples the injected clock zero times; now/relative cases sample it once,
including repeated directives and fractional-millisecond negative boundaries.

The six limit failures are harness expectation errors: the harness expected
a thrown direct-command FsError, but real Shell returns status1 and exact
`shell: line 1: EFBIG: ...` stderr, with zero stdout writes. The five date
failures omitted `or time` from expected diagnostics. Those11 remain failures;
offline classification does not promote them. All exact errors are retained.

After all312 rows, the harness's environment assertion fails because it compares
Node's exotic `process.env` object to a plain copy with deepStrictEqual. It
prints identical entries but has incompatible prototypes. The product process
therefore exits1. The later import-list/environment summary was not written;
that evidence limit is explicit. No successful final environment assertion or
import-list file is invented. There was no product retry or weakened expected
byte. Read `ATTEMPTS.md`, `consumer.stderr` and `classification-v2.json`.

Separately, the1624 native/source proof groups all match GNU's actual branch,
but two refute an unrestricted magnitude rule. These are not product passes.
See `SOURCE_PROOF.md` for the general algebra and independent ISO arithmetic.

## Immutable historical evidence stays historical

The old223 author corpus's two rejection assertions remain unchanged and are
not claimed passing at this source. Original305/304/83 corpora are not replayed
by this reviewer; the distinct packed verifier owns that work. The historical
36-group native matrix remains unchanged: its18 label groups still have five
strict ICU/native differences. `preserved-ICU-profile-v2.json` copies exactly
those five rows with the original source-file hash; these are not new measurements
or new passes. The initial offline extraction mistake (18 rather than5) remains
in the unsuffixed files and is explicitly superseded, not erased.

## Exactly two proposed canonical substitutions — NO edits

Only if ROOT accepts the qualified source/policy, replace these two legacy
rejection checks in `tests/commands/time-env/date.test.ts:76` with positive
checks using the **same argv**. Do not change any other immutable fixture:

1. `['-d@0', '+%12N']`: exit0, stdout `000000000000\n`, stderr empty.
   Native exact stdout hex `3030303030303030303030300a` agrees.
2. `['-d@0', '+%-N']`: exit0, virtual stdout `0\n`, stderr empty.
   Ordinary native `%--N` backs hex `300a`. Exact native bare `%-N` is
   `000000\n` (hex `3030303030300a`) on this measured binary and MUST remain
   a strict mismatch, not be rewritten to agree with virtual policy.

`canonical-native-proposals.json` records exactly these two native inputs and
the ordinary-formatter witness. These three native-only classification calls
are outside312/1624 denominators; no additional product run or canonical edit.
If ROOT requires strict GNU semantics for bare `%-N`, substitution2 is NOT
acceptable as a parity assertion; resolve that policy decision first.

## Reproduction and artifacts

`verify.mjs --check` checks the durable seal, freeze, pinned source hashes and
exact retained classifications without rerunning product cases. Run from repo:

```sh
node tests/commands/time-env-stress/fraction-independent/semantics/verify.mjs --check
```

For a fresh reproduction, copy the harness `.mjs` files to a clean owned review
directory in a checkout with the same relative layout, then run `freeze.mjs`,
`native.mjs`, `run.mjs`, `primary-sources.mjs`, `classify.mjs`. Generated artifacts
use exclusive creation intentionally; do not overwrite this sealed first run.
The original harness defects are retained, so reproduction is not a green gate.

`source-manifest.json` records archive/build/guard hashes and cleanup;
`native-profile.json` and `primary-fetch.json` record actual source/oracle profiles;
`product-results.jsonl` / `native-results.jsonl` preserve raw measurements.
`MANIFEST.json` seals this owned evidence. No72-hour duration is claimed.
