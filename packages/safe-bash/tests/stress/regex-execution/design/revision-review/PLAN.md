# Independent revision verification

Ownership is exclusively this new `revision-review/` tree and the explicitly
requested `/tmp/regex-revision-*` coordination outputs. Original author and
`review/` files, historical evidence, product code, package/API remain untouched.

Before author edits, `freeze.mjs` captures exact source bytes using commits
4484026/aba917c and the original independent assertions at ad4c5ad/3b27782.
The existing source bundle preserves historical dirty-source bytes; each copied
file must match the original source SHA-256. Toolchain files are copied and hashed.
The ready marker identifies the resulting immutable baseline snapshot.

Run all sixteen original benign child assertions, unmodified, with their original
static one-child watchdog runner. Expected baseline: fourteen pass; idle-exit and
live-source fail. Keep the actual failures. The original runner's historical risk
labels are archival labels, not this revision's risk ledger; no risk mode is run.
Compile output hashes must match the historical seventeen emitted assets exactly.

After author readiness, snapshot exact committed fixed source identities before
execution and rerun the same sixteen expectations, expecting sixteen pass only
if actually observed. Add bounded benign guards for exit/error/abort races,
listeners, capacity, promises, source-read ownership, live partial batches,
downstream close, pending read rejection/cancellation, and actual queue semantics.
Do not modify author code to resolve failures. Report substantive failures early.

After validation readiness, inspect test-only adapter/policy and package evidence:
declared targets versus accidental JavaScript extensions, equal-work gates and
benchmark caveats, static compiled Node 22 ESM Worker asset, default narrowing,
global capacity rejection and idle capacity ownership. No broad suite rerun.

Risk budget: twelve historical probes remain archived. This revision has a
separate authorized-six tranche: author two, verifier at most two, root two
reserved unused. Verifier defaults to zero probes unless needed. No old risky
rerun or retry of a claimed/failed probe. Any new probe requires fixed benign
controls first, committed static checked-in harness and expectations, one exact
child, <=250 ms after ready, bounded heap/output, exact child/Worker cleanup,
fixed `^(a+)+$` against tiny a24!, and no eval/main-thread risky regex. No process
group kill, external target or unrelated temporary cleanup is permitted.
