# Baseline selection, before implementation

This is a new reduced TEMP experiment, not a current-release candidate. Observed
working HEAD: `3b33f9a8e10ca5c697b7eb23727e1cc173b1672c`; root previously observed
`76fe3b86726d5e55624c83d923f95a6eb5ad513c`. Neither is a clean/frozen claim.
The index was empty and foreign untracked evidence/native artifacts were present.

Authenticated sealed v1 `1ff82cb748c60145740dba354610ac7ed7a7f15f` and rejected
prebuffer v2 `9b65787d4d6805aa182ff138996bf4ab7bacd764` from their inert archives.
Fresh reconstruction verified both source/test/compiled identities and 358 v2
compiler inputs. Exact v2 source manifest:
`2896bd6108a90e19abee682db729960cc85f71d0ecd15562e4f9cb93b5f3399c`.
Authentication copy is read-only and is not the new mutable candidate.

Chosen baseline: authenticated v1 plus narrow frozen current producer-retention
fixes, then v2 explicit parent.child implementation only. No v2 upload prebuffer,
delayed enrollment or usesStdin API is retained. New next-only stdin adapter is
internal, not a lease or a cursor-conservation API. The transfer remains streaming.

Read-only drift review against historical `c9b96263d1204bdf54e89324cc0c7d1ef6bd3f79`:
contracts io/command, shell input/runtime/shell, curl/transport and cleanup are
unchanged in the observed live tree. Existing 07ac cooperative invocation hook
and shared ShellInput ownership therefore remain the base, not a reimplementation.
Relevant retention fixes are frozen from the observed HEAD: network/body cache
uses new Uint8Array (b282159921ce530e932b02f90c64eca987de2704), internal collect/lines
and byte-tail retention (7a517cecab21d9fbff204df01a6a2ad2712a7673), and amortized
tail trimming (7d7dce7ced596b24e60e1ab3fea5bcd50c070755). The adjacent one-line jq
program copy from b282 is also retained rather than restoring its known bug.
These four files' exact deltas are archived separately from the new design.
Current network byte-ownership tests were inspected, not executed as a live gate.
Unrelated env/tree/export/plugin changes are deliberately not rebased.

All old proposals, original input cohorts, old author8, historical new7=3/7,
independent 688c4623 and native5 remain untouched historical evidence. D01 framing
and handback are not acceptance requirements; D02/D03/D07 do not establish bugs
under unchanged top-level Shell.exec ownership. No new probe reads independent
streaming-review/holdout bodies or private coordination.
