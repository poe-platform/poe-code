# OPC utility reconciliation

Scope: reconcile pinned presentation and shared-package OPC, package URI and
serialization test rows with original observable tests. Source identities stay
in the research ledger; no foreign fixtures or implementation are copied.

Read the root instructions, `docs/specs/pptx.md`, shared Office CLI/SDK contracts,
upstream test audit/inventory and current package/relationship evidence. Research
checkouts are disposable under `/tmp`; unit tests use supplied bytes and memfs.

1. Inspect each pinned source family, including fixture parameter variants.
2. Add original cases for uncovered URI, relationship record and serialization
   effects; use independent expected bytes/records rather than mock call graphs.
3. Distinguish bounded engine equivalence, explicit security/language divergence,
   and unsupported public construction/mutation APIs in a row ledger.
4. Run focused Vitest and the maintained package lint checks. The parent owns
   atomic staging/commits; this work does not push, release or execute a pipeline.

QA procedure: use only generated original in-memory packages for this utility
scope. Inspect stored ZIP member bytes with the existing independent ZIP reader.
No external corpus fixture is needed for the cases here; downloaded research
checkouts remain outside the repository and are never test dependencies.

Completed: three original suites add 76 cases. Exact image/movie and generic-part
occupancy variants, relationship-ID variants, independent serialization and all
34 shared core-properties variants are covered. Fixture-only failures exposed an
invalid orphan slide lacking its layout relationship and prefix-sensitive XML
expectations; both were corrected in original test setup/assertions, with no
product changes. New rows record explicit allocation, XML/ZIP preservation,
byte-ownership and native-I/O differences. The complete ledger covers 356 rows.

Focused checks: 10 existing/new utility suites passed 349 cases; separate new
property and allocation suites passed 34 and 17 cases. Parent final maintained
checks cover the final 25-case utility suite and SDK/CLI integration. No defect
requiring product changes was established in this subtask.

Final root verification: maintained pptx workspace tests passed 6,654 cases in
250 files; workspace lint and selected workspace build closure passed. Five
focused actual safe-bash cases passed. Only explicitly owned files enter the
local atomic commit; no push or release.
