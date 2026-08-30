# K08 positional arithmetic: author candidate, not runtime acceptance

## Binding and result

Production commit: ffac894aa98b8cd98476b8ea109ef2e2425c2a07. Only runtime.ts's import and the two approved arithmetic callsites change; arithmetic-parameters.ts is new. Reversing those hunks reproduces the original runtime bytes (SHA256 0c17850b1ceb4f09eec5458315dbb08433aa01721cf1b20fe7385481a20992e1). Parser, evaluator, ERE, LET, public exports/options and all other runtime bytes are unchanged.

The ONE authorized isolated strict TypeScript build completed with exit 0, empty stdout/stderr, qualified direct-child capture/exit/close and no primary/secondary failure. BUILD-RESULT.json retains its raw receipt. No Shell.exec, helper control, mutant, native, Worker, install or npm execution occurred. Existing public declaration files are byte-identical; only a new internal helper declaration exists, so no public consumer execution was needed.

- runtime.ts SHA256: 52b916030e4ca6e5c36bf858d16e26be8e39d124707597e3e601c94641185df6.
- arithmetic-parameters.ts SHA256: cedcbab5ece5b8b109b37a6a2d61945f79168d679040e67feb519d23219f516a.
- BUILD-SEAL.json: 85429 bytes, SHA256 30100c3b0694685825207cb6d9beb2802ba7eee450a45f0a9d63ea711c107470.
- New shipping archive: 981948 bytes, SHA256 0b6ae3340691c1c91b26f40454b8095d2ed346389353aa93e9a43c64d5a1132c, 1006 shipping members; base64 preservation is package.tgz.base64. Decode only after regular-file/type/size/hash admission under a future grant. This is not the historical capture archive.
- Composition: authenticated original 305 inputs, only runtime replaced and helper added = 306. SOURCE-BINDING.json and BUILD-SEAL.json bind individual source bytes; no raw HEAD composition or repeated full-source archive.
- Future SEAL.json: 196558 bytes, SHA256 ba016c4ff6bfa1add722d65c59a0d4f740e43ca652c56bfc12610472bb633d91. All 13 local source/fixture bindings and 9 inherited helper bindings were reauthenticated as files after writing.

## Implemented narrow profile

Plain one-digit $0 through $9 and braced decimal positional references are expanded as TEXT before arithmetic parsing. Thus an argument containing 2+3 is not replaced by an atomic numeric 5; arithmetic precedence follows the resulting expression. $10 is $1 followed by literal 0, while \10 selects position ten. Missing and empty remain distinguishable for the existing nounset callback. Current arg0 and positional function frames are used. Parameter text is not shell-evaluated again.

Unsupported dollar/name/operator, quote, backslash and backtick forms retain the prior evaluator/error path; this is not full Bash arithmetic expansion. Existing bare arithmetic variables, checked writes/readonly behavior, command-versus-expansion error handling, evaluator limits, synchronous evaluation and LET remain unchanged. The callback runs once. Newly owned chunks/join overlap use the existing private ledger and maxExpansionBytes, released in finally; checkpoints cover cooperative loops. No new public cap, whole-invocation/RSS bound, flat-primitive preemption or opaque-host cancellation promise.

## Frozen future proof matrix (ALL UNRUN)

CASES.json records literal programs/options/expected bytes and their expected basis. P01 recursion (keyword and legacy); P02 top-level args; P03 nested frame restoration; P04 zero/multidigit/leading-zero selection; P05 textual precedence/sign; P06 repetition and no shell re-expansion; P07 quote preservation; P08 active/skipped branches; P09 missing/empty/nounset; P10 untrusted parameter text/refusal; P11 writes/readonly; P12 exact byte boundaries; P13 injected helper caller/error identities and cleanup; P14 arithmetic-command/expansion/LET distinction; P15 static evaluator/deferred errors; P16 binding/mutation discrimination.

There are 23 primary identities x 3 layouts = 69 future Shell.exec calls, plus 2 mutant Shell.exec calls = 71. Three baseline helper batches and one mutant helper batch are separate from Shell calls. Eight baseline helper identities expand to sixteen parameter rows per batch. Three mutant children and two binding refusals are explicit. P13 is a PRIVATE helper injection, not actual public Shell abort acceptance; a different reviewer must identify any additional public-boundary proof required before broader claims. Referenced retained test groups are source-derived context, not rerun evidence.

Source-built layout is the actual strict-build output. Installed and physically moved layouts must be created from the admitted same-buffer shipping archive when a future grant activates. Future owner/driver sources are concrete but have not executed or obtained independent preexecution acceptance. Current GO and REVIEW templates remain PENDING; COMMAND.pending.txt has deliberate unresolved authority slots. No authority is inferred from this packet.

Proposed future grant: 25 minutes inclusive, finalization reserve 60 seconds, case 30 seconds, peak 3 known roles, 96 MiB capture/512 MiB sampled logical work. 79 runtime known starts (collector+owner+69 primary+3 helper+3 mutants+2 binding refusals) plus 7 administration = 86; this EXCEEDS the current author grant's 72 and needs explicit new root approval, not silent borrowing. Zero case OS-subprocess, Worker or async-loader permissions. No build needed in that future matrix. Direct-owned functional profile only, not group absence, universal census or OS containment.

## Preserved failures and preparation changes

Historical 47a2311e remains 51/54 primary and 24/24 equal legacy-comparison observations, with K08 failing in both forms. Its 2 MiB administrative capture-archive STOP is unchanged, not retried/rearchived/rescored. No new native goldens exist.

PRELIMINARY-SEAL-V1.json and PRELIMINARY-WIRING-V1.json preserve the unexecuted first future seal and two source-only wiring corrections: collector/owner SEAL environment-name alignment, and inclusion of helper/mutant/binding failures in terminal status. These were not runtime passes or product defects. Original raw build/admin captures are retained and individually encoded, not compressed using the shipping helper.

Next: different-agent source and preexecution review of the helper, literal expectations, declaration closure, owner graph/permissions and current seal; then separately authorized actual targeted execution. Build success alone does not close K08.
