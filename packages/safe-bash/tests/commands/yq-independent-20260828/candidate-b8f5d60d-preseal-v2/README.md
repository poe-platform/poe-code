# Successor artifact bindings — DATA_BOUND, admission DENY

One root-authorized v2 static data inspection completed in 5.332 seconds, exit 0,
reaped, with empty stderr. This is data comparison, not product/harness acceptance.
The immutable v1 0.922-second exit-1 failure is preserved without rescoring.

## Verified identities

- Source `b8f5d60d75452e1dd181167fb87abd995221f6e3`; evidence
  `644460b932feb6fa87222b7042d705da1219cf0c`; handoff
  `065f824d06e36de3fafaee1b7a5baa278f40407c`.
- Raw source archive SHA-256
  `fe76de08017859b066ecb8830846e109cdab6fa3953b0317e5fc6f27777fd878`;
  2,727,936 bytes, 273 regular entries.
- Raw full package SHA-256
  `1d06350cdef1a5f6c7d70c7d55a19b63537037bd97b2de5a5d8b8b8f722229ca`;
  786,778 bytes, 870 regular entries.
- Author manifest 281 entries minus eight test-data entries yields the 273-entry
  archive. Removing only baseline `package-lock.json` and `scripts/typecheck.mjs`
  yields the 271-entry consumer source projection: 264 accepted base plus seven
  new-origin YQ/query-adapter paths. No author fixture/protocol enters production.
- Exactly five selected source paths and 17 package outputs change versus old35da:
  five JS files, ten JS/declaration maps and two declarations. The other two
  selected additions are unchanged. Every baseline package entry remains exact.
- Complete package composition is verified as all 846 baseline entries plus
  exactly 24 authorized emissions. Root README is the complete 36,273-byte baseline
  file with SHA-256 `87e92b73c7339b104212a9fb11006d339694f65575a7b79debfaa902ef9cf9d1`.

`COMPOSITION.json` provides compact full-map reconstruction using immutable full
base maps and exact new descriptors/deltas. `GIT-IDENTITIES.json` separately records
whole Git tree `7d573d3214404f98f9664c79c16f1d7e9ce5d05e`: its 301-entry product
scope has 30 extra paths and eight differing selected paths. It is not the selected
271-entry source graph and is never a replacement source authority.

## Corrected mode binding

All 15 old candidate files, 21 build files and 1,719 actual-review files pass exact
original byte/mode/membership binding, including 340 actual-review directories.
The compound result uses the original seal's `0600`, independently of Git100644.
Ten in-memory data controls cover the valid pair and strict rejection cases.
No file is chmodded, omitted, retried or accepted by comparing expected to actual.

The prior b8 v1 packet's 13 files and directory remain byte/mode/membership-equal
before/after. Twelve files have exact original full-mode authority. Its self-excluded
`FINAL-SEAL.json` lacks a located committed original POSIX-mode record: its golden-mode
check explicitly rejects with `MODE_AUTHORITY_MISSING`. Git class, committed bytes
and observed before/after mode are checked, but are not substituted for that missing
authority. Thus full historical golden-mode admission remains DENY. The data-audit
process's exit 0 does not waive this rejection.

## Root route

`SOURCE-AUTHORITY.proposed.json`, `SOURCE-RECEIPT.proposed.json` and
`FULL-RECEIPT.proposed.json` are exact new-origin data for future root routing.
`AUTHOR-ARTIFACT-RECEIPT.json` is **BOUND_AUTHOR_BUILD**, not independent compilation;
its root-trusted flag is false. No consumer/runtime API or old authority is changed.
`PLAN-BINDINGS.proposed.json` and `API-BINDING-REVIEW.json` map future plan slots and
the unchanged consumer schema. Old guards were read, never invoked.

Zero product imports/runs, compiler/build/type/loaded-mutant/native/proposed-harness
cohorts, artifact materializations, repacks or dependency installs occur here.
New independent build and affected source/installed/moved semantics require fresh
evidence. Public/default YQ integration remains absent; direct module bindings do
not establish it. No global typecheck or feature-wide green is claimed.

Root must resolve the exact missing historical self-mode authority, independently
review this correction/receipt, finish fresh executor bindings and issue a new GO
before actual review. The old409 refusal, failed postprocessors, 4b219 FAIL, CMD-22
and deadline-UNRUN remain unchanged. This worker stops after the data handoff.
