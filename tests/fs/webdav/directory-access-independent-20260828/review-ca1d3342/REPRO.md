# Reproduction and data-only audit

From this directory in the final committed review, data-only checks are:

```
node verify-final.mjs
node audit.mjs
```

They import no provider, run no cases, and require no live historical Git source
objects. Original freeze bytes and their Git path proof, selected source blobs,
raw commits/tree proof, complete built tarball and every executed fixture/driver
are retained. Git IDs are content-addressed identity, not a signer-attestation
claim. The full selected265-file build closure is composition.json.gz; no whole
moving ca1d/HEAD overlay is used.

For a separately authorized fresh replay, use a clean copy of the final review
with the same relative repository layout and unchanged seven parent freeze files.
Do not replay into or overwrite the canonical evidence tree. Exact pinned local
tools must be available at the TOOLS.json origins (or restored byte-identically);
missing/changed tools fail without installation or network fallback.

```
node verify-final.mjs
node recreate.mjs
node replay.mjs replay-unique-name
```

recreate authenticates regular copies of the complete tools, source and fixtures
against the prepared inventory, without consulting Git source objects. replay
builds and packs again, REQUIRES the rebuilt package to equal candidate.tgz,
executes102 independently in source/installed/physically moved modes, checks the
corrected ES2023 type environment, and runs the same five source/three load
controls. It uses unique output names and rejects reuse. It does not overwrite
RESULT.json, RESULT-v3.json or any original raw run. New capture additions are
not covered by the existing final seal and must receive a new authorized seal.

The replay orchestration is syntax-checked but not executed as a fourth full
batch here. Its build/pack/install/move/runner steps are those actually exercised;
its type frontend is the executed types-v2. The original run.mjs intentionally
reproduces the retained incidental-DOM type failure and is not the successful
handoff recipe. run-v2 preserves the exclusive-config admission error; run-v3
preserves the successful continuation from the authenticated recorded state.

Broad suites, author680/108 cohorts, real services, native oracles,
cd-runtime, directory stack and SafeJS runtime are outside this reproduction.
