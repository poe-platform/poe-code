# unrtf engine destination and realm QA

Execute against the current candidate, using memory byte streams. This engine
has no CLI handler, VFS writes, checkpoint state or visual output.

1. Run the private workspace unit route. Check starred font tables emit a
   skipped destination and no font declarations; field results still survive.
2. Confirm nested font-table controls inside pictures cannot reset inherited
   image-byte accounting. Exhaustion must produce `E_LIMIT`, `imageBytes`, status 1.
3. Check malformed starred destinations fail `E_PARSE`, status 1. Ensure
   objects, instruction URLs and macros remain inert without external capabilities.
4. Confirm a VM-realm Uint8Array works; Uint16Array, DataView and a forged
   Uint8Array tag fail `E_PARSE`. This checks foreign byte views, not execution
   on an actual browser/workerd runtime.
5. Run workspace lint/typechecks and the maintained selected safe-bash build.
6. Assemble and pack safe-bash; unpack into an isolated consumer with no private
   workspaces. Run the maintained runtime fixture with empty PATH and the
   NodeNext declaration fixture. Confirm the public manifest requires no
   unpublished command package.
7. Remove only generated task-owned evidence after recording outcomes.

No native personality parity is inferred from these checks. Native legacy,
recovery, styles/tables, picture exports and CLI/SDK command dispatch remain
unimplemented. Actual browser/workerd runtime cells remain unverified.

Executed results, 2026-09-20:

- Four original tests failed against the incoming candidate before code changes:
  starred font-table admission, inherited picture accounting, malformed starred
  destination leakage, and foreign-realm byte admission. All 29 engine tests
  subsequently passed; no skips (about 0.55 seconds total, not a benchmark).
- Workspace ESLint and source/test TypeScript checks passed. The maintained
  selected safe-bash closure passed all 19 builds (zero build cache hits).
- Artifact assembly and local npm packing passed. An isolated unpacked consumer
  with no private workspace installed passed the maintained runtime fixture
  with empty PATH and strict NodeNext declarations. Additional packed controls
  verified starred font admission, image-budget rejection, and foreign byte views.
  The assembled public manifest has no unpublished unrtf runtime dependency.
- Test fixture construction initially used Object.assign on a getter-only tag;
  corrected to Object.defineProperty. An initial empty-PATH check used an absent
  node path; rerun with process.execPath passed. Neither setup failure is counted
  as a semantic result.
- Repository-wide tests/lint/build, native compatibility matrix, actual browser
  and workerd runtimes, CLI/SDK dispatch and checkpoint/replay were not run.
  No visual CLI behavior changed; screenshots are inapplicable to this engine API.
- No commit, remote push or release. Existing workspace edits were preserved.
  Task-owned temporary artifacts under out/unrtf-engine-destination-check were
  removed after verification; /out is unavailable on this host.
