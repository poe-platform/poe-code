# Independent apply_patch actual-v1 — STOPPED, not accepted

August28,2026. Different independent execution leaf; Poincare is the author.
Owned scope: only this `actual-v1/` directory. Candidate
`58be2d6c5706f3e90f01d48e695ecfd9daa52669`, evidence
`767b6729d3acac0dd17c42dfb9e0b93e6e9c4de5`. Current user GO was honored; historical
ROOTGO-null records were not treated as a new authorization requirement.

## Decision and concrete blocker

**No independent runtime acceptance.** The one attempt stopped at its candidate
tree-authentication guard, before materialization/build/import. The defect is in
this reviewer's metadata/runner, NOT an observed apply_patch semantic failure.

`capture-metadata.mjs` saved non-NUL human-display `git ls-tree` output.98 of50002
candidate paths are C-quoted (backslash, newline, octal-escaped bytes, etc.). The
controller used those display strings as literal path bytes and reconstructed
`bd69c1a1dd0e65e442017ab27f86ed72a284fa95`, rather than the authenticated commit's
`189bef24a927241d7c47a662f1ac447b56da1835`. The mandatory mismatch guard stopped
all68 dependent jobs. There was no retry, runner repair or resumed execution.

After the failed capture was committed, the separately committed DATA-only
`forensic-data.mjs` decoded the captured path spellings to raw bytes. Its canonical
tree exactly equals the stored candidate tree. This diagnoses the harness defect;
it does NOT admit the candidate, erase the failed guard, or prove the8437 selected
composition. A future repair must use authenticated raw NUL-delimited path bytes
and qualify that transport; this failed attempt remains immutable.

## Chronology and commits

1. Read current parent/root rules and frozen matrix preseal7df79906, then admission
   preparationb58b3726/evidence291bd9c1/correction19fc5c36. No matrix/admission files
   changed. The preparations were independent of candidate implementation; this
   actual review took place AFTER candidate commit.
2. `7561d077`: metadata-only transition committed before implementation inspection.
3. Inspected committed six-module source and existing author/qualified machinery;
   `dd85482c` promptly committed `EARLY-FINDINGS.md`.
4. `d381c7e7`: concrete execution preseal, runner/guard/tool/input/physical-layout
   rules,70 finite jobs, coverage gaps and mutation intentions committed before
   any compiler/product execution. Author counts were never independent passes.
5. Single controller started `2026-08-28T17:54:03.741Z`; both Git children settled.
   Pre-finalization clock receipt is1162.037208ms; `FINAL.json` was written at
   `2026-08-28T17:54:04.970Z`, after archive/cleanup. `elapsedMs` is a PRE-cleanup
   checkpoint, not an exact end-to-end duration. No duration/superiority claim.
6. `0297e41c`: original failure, raw fragments, archive, STOP and forensic recipe
   committed. One later DATA-only forensic check returned successfully, without
   subprocesses or product imports. Its result is `FORENSICS.json`.

## Actual counts

| Role/result | Planned | Actual |
| --- | ---: | ---: |
| Controller attempts |1|1, stopped |
| Developer Git children |3|2, exit0/closed/groups absent |
| Guard-control children |4|0 |
| Source compiler/build |1|0 |
| Type-consumer children |15|0 |
| Product children |47|0 |
| All children |70|2;68 NOT_RUN |
| Command entries |401|0 |
| Product case receipts |422|0 |
| Actual loaded product JS modules |required full closure|0 |
| Loaded semantic mutants |6 planned of18 intents|0 |
| Installed/moved consumers |1/1|0/0 |
| Owned worker instances / servers |0/0|0/0 |
| Network/native/private-engine execution |0|0 |

Twenty finite own-data controls and five thrown-reason identity checks succeeded
inside the controller: **25 DATA controls, zero product passes**. The base raw
tree matched its stored root before the candidate check failed. No loader control,
compiler, package882-file check, default78 runtime inventory or type test ran.
All original32, supplement80 (94 expanded variants),14 limit rows/28 endpoints,
two extra limit probes, providers, lifecycle/ownership tests and holdouts remain
NOT_RUN as runtime obligations. Source-accounting notes are not semantic passes.

## Resources, source integrity and capture

- Controller children: Git PIDs85679 and85682; both close events observed, exact
  owned groups absent, records retired. Peak owned processes2 (controller+one
  child), below4. Zero owned processes/servers/resources remain from the attempt.
- Raw child capture8,029,711 bytes;126 persisted evidence files total10,750,569
  bytes. `FORENSICS.json` includes complete path/size/mode/SHA256 inventory and
  its aggregate digest. Fragments are<=65536 decoded bytes, sequence/hash checked.
- Work payload bytes0: candidate materialization was never reached. The immutable
  gzip/base64 archive holds only empty `home/` and `tmp/` directories; compressed
  bytes88, SHA256
  `5420e0f08e0995c54719d02e87294994219d4926d709d2452e50b37f2bb7471a`.
  Archive verified, original exact owned root removed. RSS was not measured.
- All six committed candidate modules were authenticated from preserved Git
  objects in DATA forensics. Their live post-stop SHA256 values equal their
  committed candidate hashes; see the exact six rows in `FORENSICS.json`.
  This is not a before/after census of the entire concurrently edited workspace.
- No source/root/export/package/foreign file was edited. No AGENTS plaintext was
  copied into snapshots or evidence. Full source/build/package append guards were
  planned but never reached; no append-proof product-tree claim is made.
- Full controller command/argument/stdout/stderr/status/PID/retirement evidence
  is in the two child receipts and numbered fragments. Preparation's eight
  metadata-capture Git calls and one authenticated builtin-scan Git call are
  separate; interactive read/commit tools are not folded into controller totals.

## Source findings and API qualification

`EARLY-FINDINGS.md` records F01: exported INTERNAL factory/options types permit
lower configured limits despite the independent fixed-only profile. Root export
absence is acknowledged; this is not a newly exposed public root command. F02:
bulk charge/copy paths exceed a4096-unit checkpoint interval in source accounting.
Neither finding is a runtime observation, and neither caused the admission stop.

The authenticated `src/commands/apply-patch/index.ts` declares
`createApplyPatchCommand(options: ApplyPatchCommandsOptions = {}): CommandDefinition`,
`createApplyPatchCommands(...)` and `applyPatchCommands(...)`. These names are an
authenticated source API excerpt, not a tested consumer example. A runnable
minimal module example remains NOT_RUN/withheld because no build or consumer
evidence exists. No default wiring or public export is approved by this report.

## Remaining acceptance work

The full mandatory runtime review remains outstanding. Even the sealed scoped
plan had explicit gaps: S32/S54/S57/S61, eight fixed-cap rows/two extras, actual
DAV/Mount/Overlay, full phase-order instrumentation,12 mutation intentions and
complete maintained source/test/type-consumer qualification. Those gaps were
declared before dispatch and cannot be called completion or silently dropped.
Neither25 DATA checks nor the corrected DATA tree diagnosis certifies them.

**Final root acceptance/default wiring stays unestablished.** Preserve this failed
attempt and original expectations; do not rerun it or reinterpret its guard as
a candidate pass. The actual execution reviewer stops here as required.
