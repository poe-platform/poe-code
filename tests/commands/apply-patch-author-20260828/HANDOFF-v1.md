# apply_patch module author handoff

2026-08-28. Candidate `58be2d6c5706f3e90f01d48e695ecfd9daa52669` is frozen
for DIFFERENT independent review, not self-accepted or default-integrated.
`CANDIDATE-v1.json` provides exact source/package/capture digests and denominators.

## Exact implementation and API

Six new production files only: `index.ts`, `options.ts`, `shared.ts`, `parser.ts`,
`matcher.ts`, `apply.ts` under `src/commands/apply-patch/`. No shared source,
root export/package/README/default change. `createApplyPatchCommand(options?)`,
`createApplyPatchCommands(options?)`, `applyPatchCommands(options?)`, and types
`ApplyPatchCommandsOptions` / `ApplyPatchLimits` exist in that internal module.
Options may REDUCE ratified caps; exceeding a maximum fails at factory creation.

The source implements the actual envelope parser, literal original-buffer hunk
matching, initial whole-patch metadata/content preflight, bounded staged bytes,
revalidation and ordered VFS mutation. It does not call the existing unified
`patch` command or a host executable. Final success output follows patch order.
Malformed syntax makes no VFS calls. Known aliases, symlinks, conflicting paths,
readonly and observable permission denials refuse before command writes.

## Executed evidence — one primary attempt

- Precode protocol `7ce2ed91`; executable freeze `4a2f9a38` predates all execution.
- **63/63 expectations in each of three layouts**, not 63 successful patches:
  21 successful literal cases, 11 expected literal refusals, 24 supplementary
  families, six writable backend Shell flows and one readonly refusal.
- Writable flows actually create, update, move and delete files, then read their
  results through a Shell `cat | sed` pipeline. Backends: Memory, configured Real
  temporary root, Mount, Overlay, S3 mock, WebDAV mock. The Real case includes
  native backing-file byte observation only within the task-owned root.
- Strict source build passed. In EACH layout: one positive type consumer, two
  exact expected diagnostics, and two passing repaired inversions. A root export
  negative deliberately proves the API is not publicly exported yet.
- Each main layout authenticated **216 loaded emitted modules**, including all
  six new modules. Full offline tarball contains **882 files** (858 accepted base
  plus 24 new JS/declaration/map emissions), zero runtime deps and 78 defaults.
  Curl/SafeJS remain optional; apply_patch is explicitly installed in test shells.
- Six actual loaded behavior mutants killed: premature parse-time write, fuzzy
  matching, early move unlink, retained Buffer view, raised cap, dropped caller
  check. Every original was restored and its targeted positive rerun passed.
  Three separate negative bindings rejected changed hash, omitted manifest entry,
  and outside-package routing. No loader rejection is counted as a behavior kill.
- 24 main-layout Shell instances disposed; all **36** test/build/install/type/
  control children settled naturally with expected statuses; unique task-owned
  root removed. Negative exit codes are deliberate observations, not discarded.

All raw outcomes and packed bytes are in the immutable compressed capture. There
were no failed build/runtime baseline attempts to relabel on this author run.
Initial inspection tried `git cat-file` on 8437 and found no stored object; this
was a tooling lookup, not a candidate failure. Its identity is derived-only, as
already documented. The authenticated composition recipe was used instead.

## Reconstruction and bounded replay

The runtime input is EXACT accepted computed composition
`8437e4eda904e1248c25eeef0d9d455b1d251495` from the coherent78 manifest, plus only
the six module blobs at the candidate. Never run a raw current/candidate HEAD as
equivalent: unrelated pending code may be present in that history.

Development replay (no native Codex apply_patch):

```sh
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node \
  tests/commands/apply-patch-author-20260828/run.mjs \
  58be2d6c5706f3e90f01d48e695ecfd9daa52669
```

The runner verifies frozen source-recipe hashes before materialization. Compiler
and offline npm are existing development tools, run with task-owned HOME/cache/
configuration and ignored lifecycle scripts. No installation from the network,
new dependency, native oracle, private engine or real remote service is involved.
Source layout means compiled output of the isolated selected source, not direct
TypeScript execution. Installed and moved use the whole admitted package. Actual
load and declaration digests exclude source fallback. Package README stays the
accepted historical base README, not documentation claiming integration.

MockDav is the unchanged test helper at base `67eab12e...`, SHA256
`177f79ee640460822cfe0486c87f7cc61ac7c8b84389abe32b48ef27f4b4ef36`.
It is development-transpiled and its emitted resource-binding import is explicitly
routed to the admitted package. That harness routing is disclosed; there is no
new mock behavior, fake per-client identity, or real-provider inference.

## Honest boundaries / suggested independent challenges

Reference remains Codex 0.145.0 source inspection, not latest/full/native parity.
Exact-first/no-fuzz matching, original final-newline and LF/CRLF retention,
traversal/symlink refusal, Add-overwrite and absent-only Move are intentional.
No move-only empty Update, binary update, numeric unified hunk interpretation,
atomic multi-file application, inode/ACL preservation, or overwrite-Move promise.

Initial content reads can cause provider atime/Overlay garbage housekeeping.
Command writes start only after initial preflight, but later races/IO failures
can leave earlier files/parents and partially failed writes. Revalidation is not
CAS/ABA/namespace locking. Unknown alias relationships are not called distinct;
only actual exclusive destination creation authorizes new-path moves. S3/DAV
positive results here are injected-mock interoperability, not service acceptance.
Unsupported W_OK with permissions not true stays unobservable, not authorization.

Cancellation and sink/iterator reasons keep identity; supplied parent signals and
budgeted sinks remain authoritative. No fresh Shell/Budget or diagnostic exemption.
Private loop/byte/record caps are logical admission controls, not RSS limits or
hard preemption. Existing raw opaque input next/return and provider cancellation
limits remain; no new preemption contract is claimed. FS mutations are not owned
by stdout, and output failure after publication cannot roll back file changes.

Please independently challenge fresh/unknown/changed identities, repeated mounts,
all real cap boundaries beyond the reduced-cap controls, error/cleanup races,
newline/EOF neighborhoods and loaded candidate provenance. Author data is not a
substitute for that review. Root/public/default wiring belongs to Curie later.
