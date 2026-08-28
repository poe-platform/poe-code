# M1B fca6f81d independent executor preseal

Status: HOLD_SCOPE_MUTATION — concrete source checkpoint, not a launch-ready preseal
Implemented Through: Exact source/seal commits in the final `/tmp` handoff
Purpose: Prepare one bounded independent review, without launching it or inheriting author acceptance.
Date: Friday, August 28, 2026

## Frozen inputs and physical matrix

Source `fca6f81d2d96db2bbceabf3247cd57ffe240bde6`, evidence
`897e5141b034b59501f576a259d5ea1e7e2673c6`, derived-only tree
`23074ef0c443ca618c4f26204b5f3d2274b86895`, package SHA256
`cc0e75c2d0d12f713f0458e608ddeae157cf3432b4e0b48277a329a98115aa1a`.
The runner independently authenticates all282 selected path/mode/blob/size/hash
bindings from five actual stored origins and complete selected-path tree bodies,
then recomputes canonical Git tree bytes. It never looks up the derived identity
as a stored object, uses mutable HEAD, or substitutes a sparse witness inventory.

S is one strict independent compilation of those selected inputs. Every emitted
file and directory is checked against the fixed908 compiled artifact files before
adoption. Author JS is not copied into S. M is the full910 package, README included,
installed offline by pinned npm with scripts/audit/funding/bin links disabled,
then physically renamed before any invocation. Installed-unmoved is origin and
movement evidence only. There are two semantic layouts, not three; all access is
direct internal module/package file access, not a public Git export claim.

Tools have fresh original and destination projection identities in `runner/TOOLS.json`.
The original npm inventory has2027 regular files plus12 symlinks; directory rows
are separately included. Its copied regular projection omits exactly those12
links. The two domain hashes are not interchangeable. All tools, source, package,
harness bodies and complete memberships/modes are freshly guarded before/after
use. Copied tools and scratch are unique to this review, never Faraday's roots.

## Components and coverage

- Semantic source `656c49fef410b51b85bd905a7824d80c2a0c7a9e`:104 unique stock
  cases,208 S/M case records, maximum320 actual command calls including in-case
  pristine controls. There are36 virtual workflow calls,13 selected M1A cases
  per profile,38 format rows and B01–B12 mappings—not full140 M1A or all old116 variants.
- Mechanical source `2add02bdb0b1170ead2fe0290b63cf068049ab11`, evidence
  `856b0a59846ad09680cd32227c686925db882258`:32 private case calls,10 type calls,
  and six isolated S-only pristine/mutant/restored calls. Two loaded witnesses
  are implemented; CRC/OID/depth transforms have exact inert bodies but no loaded
  actor binding and remain UNRUN. No new actor is invented to close those gaps.
- All32 resource rows/108 variants remain mapped:12 source-only,69 semantic-peer
  dependencies,12 private-mechanical partials and15 unqualified adapter/dependency
  entries. A semantic mapping does not automatically discharge its resource variant.
- Twelve admission controls use real admission/guard functions on data or isolated
  regular copies, without a target import. They are not semantic or loaded-mutant
  passes. G07 executes its mode branch; the symlink branch is source-only.

The M1B native-codec adapter remains UNQUALIFIED. S02 remains an unexecuted source
concern and is not suppressed. Old289/288 notifications do not prove a leak;
Plato's abstract19+5 and Dirac's separate pilot are not inherited adapter proof.
The24 ratified limits, source correction scope and all old090/663-12/699/744
histories remain unchanged. No rows become passes at this preseal.

## Exact execution and capture bounds

There are36 outer workers:18 semantic and18 mechanical/type/loaded. Add one Git
metadata child, one build compiler, one npm installer and ten type compiler
descendants:49 children,50 processes including the coordinator, below168 either
way. The coded peak is three (coordinator + worker + compiler), under the cap4.
Tools deny their own process/network dispatch; an unknown owned resource or
retirement is STOP, not permission for a global process kill or census claim.

Every peer batch shares30000ms across all its cases, setup, captures and cleanup.
The36 windows total1080000ms; this is not30s per constituent case. Build has120s.
The one7200000ms origin is supplied by root's same-host monotonic clock before
launch and includes startup/finalization. Fixed absolute phase ends are300,600,
720,840,1440,4440,5040,6240,6840,7200 seconds. No reset, retry, per-layout clock
or extra finalization allowance exists. These are ceilings, not a forecast.

`RECIPE.json` accounts246.8125MiB maximum selected capture categories under256MiB,
including framing, job/load metadata and a2MiB terminal reserve inside the cap.
Worker streams are512KiB each. Git stdout/stderr are8MiB/256KiB; build/install
2MiB/256KiB; type streams128KiB each. Product output limits are not these host
capture limits. Semantic legs separately cap each output at128KiB and128 chunks.
All overflow is explicit FAIL/unsafe STOP, never silent truncation.

Each case raw file contains repeated unsigned32-bit big-endian header length,
UTF8 JSON `{label,encoding,bytes}`, then exactly that many payload bytes. Headers
are at most256 bytes, frames at most576/case, framing at most64KiB/case. Payload
and case receipt ceilings are separately charged. The parent flushes each capture
before acknowledgement; assertions follow acknowledged raw evidence. Worker/tool
stdout and stderr use bounded binary spools, not unbounded JSON arrays.

The1GiB working cap covers captured files and explicit live scratch grants.
Tools copy159186899 bytes; build reserves10MiB, install/cache64MiB; the largest
ordinary active batch reserves24MiB. Deleted case/projection grants are released
only after known retirement, full guards and verified owned-path absence. This
is logical file accounting, not physical blocks, hard RSS, opaque host preemption,
an escaped-descendant proof, or native codec lifetime evidence.

Any nonzero child is sticky aggregate FAIL, even if a receipt says PASS. In
particular, the eight expected-negative type compiler exits remain failures;
exact diagnostic matching is separate counterproof, not a waiver. Ordinary
assertion failures end that batch; its unstarted tail is UNRUN. Only independent
later batches may continue after capture, integrity and known retirement.
Escaping actor/setup/schema/cleanup errors are unsafe STOP. TERM/KILL/reap and
cooperative cancellation use the same fixed deadline and a5s internal reserve.

## Composition choices and launch fence

Type fixtures retain their exact bodies except the two declared quoted tokens.
The concrete compiler binding uses absolute POSIX `.js` specifiers paired with
guarded `.d.ts`, not `file:` URI specifiers. This is an explicit composition
correction to the mechanical TYPES prose “file URLs”; no diagnostic or source
fixture is changed. Actual filesystem-read instrumentation is not claimed.
S01 transform offsets apply in sealed array order to the progressively changed
body. Both choices are exposed for the different prelaunch reviewer.

Future launch, **not run during preparation**:

```sh
umask 022
NODE_OPTIONS= NODE_PATH= /Users/kjopek/.nvm/versions/node/v22.22.2/bin/node tests/commands/git-pack-independent-20260828/m1b-fca6f81d-review/runner/launch.mjs --root-receipt /ABSOLUTE/ROOT-ROUTE.json --expect-root ROOT_SUPPLIED_RAW_SHA256
```

`ROOT-ROUTE-SCHEMA.json` defines the independently supplied recipe/final-seal
hashes, review references, fixed candidate, unique output path and monotonic
origin. No route/token/reservation is created here. Missing/mismatched routing,
review references, active closure or bounds deny admission. Root already grants
one scoped run after these staging conditions; this author does not auto-launch.

Preparation checks are syntax/source/data only. `runner/PREPARATION-NOTES.md`
preserves failed authoring attempts without product attribution. No fixture
encoder, admission control, peer worker, loader, candidate, compiler or npm was
executed. Final component review and all future dynamic proof remain pending.

## Adjacent successor packets

`mechanical-type-api-v2/` and `semantic-integration-v2/` appeared during finalization.
Their files are pinned as inert packet-membership data only, not selected into
this recipe, worker projection or import closure. No new type API or loaded actor
is silently adopted. Their prospective additions require a separate explicit
composition/count reconciliation; the selected v1 gaps above remain unchanged.

## Finalization HOLD

The before-commit full membership check observed a newly added, unsealed
`semantic-mode-v3/` subtree and stopped. `runner/SCOPE-MUTATION-HOLD.json`
preserves the exact observation. `RECIPE.json` now explicitly denies launch with
`HOLD_SCOPE_MUTATION`; no complete physical membership or final acceptance is
claimed. The prospective CLI above is documented, not authorized for this state.
Root must route sealed selected successors and a bounded additive re-composition
before restoring a runnable recipe. No evolving source is silently adopted.
