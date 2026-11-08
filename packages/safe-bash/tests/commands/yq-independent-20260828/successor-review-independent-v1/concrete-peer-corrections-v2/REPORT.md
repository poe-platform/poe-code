# Concrete Peer Corrections: Independent Static Review

Status: Proposed

Implemented Through: Not applicable

Purpose: Audit the routed CW-F01/CW-F02 overlays and BUILD leaf against presealed
PC01–PC08, without changing product policy or approving compound execution.

## Verdict and Boundary

**STATIC CORRECTIONS CONSISTENT; BUILD LEAF REVIEW COMPLETE; COMPOUND REVIEW
PENDING; NO GO.** No new actionable leaf-source defect was identified in this
bounded inspection. This is not acceptance by absence of dynamic failures.
The original CW-F01/CW-F02 findings against c035 remain exact and unrescored.
The two replacement branches address those findings by static source reasoning;
their deferred controls and real compiler/mutant behavior remain UNRUN.

Criteria were committed at `671b49f0d3aa71aba7c3d97fa19ed4edb9d24e72` before
the correction/build bodies were inspected. This is post-candidate static work,
not blind precode evidence. Core83eed587 and in-progress composition-v2 bodies
were neither inspected nor imported. No product, compiler, classifier, worker,
loader, materializer, packing, control or authored-module execution occurred.

## Authenticated Inputs

| Component | Exact source revision | Final-seal SHA256 |
| --- | --- | --- |
| CW-F01 | `89bc7bd545f8b6f7215b7c2a49cccf644a08e07f` | `2ddd402a35916f4fb7ab29b33c9f740aebde5134a2feca43383b5abf6c427fb6` |
| CW-F02 | `9fe3c8574b32df9839284307942be5003d87d0a0` | `e124f052e7bf148073ac6831b48fe7436ee4b54fc2ca06ea1f595bb12dca1197` |
| BUILD | `937c1f6a35c620146e62924b16d90e808319024f` | `e796e30489e031c4ab6d58882542e7f3b6c644ead90ae29474c2744003f73c9d` |

`AUTHENTICATION.json` binds all33 files across the7/9/17-file component scopes,
their exact membership, Git blobs, sizes, regular/nonexecutable Git classes and
source/final seals. `ASSEMBLY-AUDIT.json` additionally checks the BUILD source
seal's six `activeProjection` descriptors against ASSEMBLY-MAP and source bytes.
Its exact map SHA is
`3d3040400ee14017a2eed7277603b7421c4348a6ae67db1c2b49799278d802bd`.
Git100644 is not a historical full POSIX-mode attestation; fresh active copies
still require the declared0644 mode and physical regular-file admission.

Parent workers remain `c0353685540288d504b93f206735fe4c448268ef`. The unchanged
ABI is `9d582d791336fd66d865f6592b830c39a359d344`, SHA
`c5e36798741667981f21f002755be3f420fbd6103b8a4b3f8783531a9f6fc412`.
Both overlays'29 parent references were checked (58 reference checks, not58
distinct inputs). Exact text substitution reconstructs each postimage: one
F01 hunk and five F02 edits. `OVERLAY-DELTAS.diff` preserves the actual deltas.

## Correction Conclusions

Paths in this section are under
`tests/commands/yq-independent-20260828/executor-b8f5d60d-v1/`.

- **PC02 / CW-F01:** `workers-cw-f01-v2/type-worker.mjs:88` selects exactly two
  literal continuation lines only for the frozen replace-undefined/TS2379
  fixture. Lines91–103 require the exact line count, positions and one matching
  file/line/code diagnostic. An extra indented warning, blank interior line,
  missing/reordered/extra continuation, additional diagnostic or unknown output
  cannot satisfy the corrected branch. Raw capture and compiler code1/2 rules
  are unchanged. Postimage:
  `f1d7b464a7018807289080a563ea4735a3902565ecdf16a32d0deab5200571fd`.
  The two continuation strings are a sealed static expectation derived by the
  author from templates, **not** independently observed native compiler output.
  No new continuation waiver or public-export substitute was found.
- **PC03 / CW-F02:** `workers-cw-f02-v2/loaded-worker.mjs:53` checks primitive
  contradiction/projection FAIL before INCOMPLETE. Lines102–115 return the two
  retained-view slots UNRUN before materialization/import; lines134–137 keep
  matching UTF22 positives INCOMPLETE even if core mislabels the assertion BOUND.
  Lines139–148 preserve other prerequisite and kill distinctions. Postimage:
  `be03ad51d6ef185093236776bf0b0f7dde17e520be6a4ed8505656dbeef4e26c`.
  Two positive gaps plus two retained-view gaps remain; six other mutant slots
  still require actual proof. OBSERVATION-PROPOSAL authorizes nothing and adds
  no adapter. A late UNRUN cannot excuse missing core pre-import prerequisite
  admission. Worker/parent nonzero is never waived by these leaf branches.

## BUILD Source and Data Conclusions

- **PC04:** `build/build-worker.mjs:24` authenticates a fixed canonical plan,
  selected271 source manifest, full870 package manifest, baseline configs and
  full copied-tool trees. Static map arithmetic confirms217 TS sources produce
  868 unique paths:434 JS/declarations plus434 maps. README and package.json
  exactly match their selected-source descriptors. The selected map hashes
  remain9b0e0d62…/aef2daac…, already authenticated by independent DATA dffc3047;
  no archive re-extraction or candidate-data execution was repeated.
- **PC05:** `build/build-outputs.mjs:9` checks source-map shape and permits only
  the proven package-relative `sources[0]` relocation, preserving raw maps and
  every other field. Nonmaps are byte-exact comparisons. Package publication
  rereads fresh compiler outputs plus the two source metadata files, not author
  output bytes. Lines81–101 bound exact870 tar membership, header/name/length,
  padding, terminator and one gzip construction. Data arithmetic yields5,031,936
  tar bytes; **no serialization or future byte-exact reproduction was observed**.
- **PC06:** `build/build-worker.mjs:70` generates one isolated config extending
  the exact baseline build config, overriding only outDir and typeRoots.
  Line175 requests one parent-supervised120s compiler inside the existing300s
  BUILD slot. Lines88–118 publish raw return/capture/output-map evidence before
  evaluating compiler completion. Reap/provenance/capture violations are unsafe;
  nonzero, signal, timeout, overflow or unexpected completion cannot produce a
  successful build. Lines124–135 retain comparisons and archive descriptors
  before corresponding assertions. Lines140–161 recheck source/tools/config,
  complete work membership and retained raw/package data; they make no
  change-and-restore detection claim.
- **PC07:** No leaf spawn, retry, timer/reset, product import or ambient lookup
  was found in the three BUILD modules. `build-fs.mjs:28` and its tree/file
  routines reject path aliases/symlinks, hardlinked files and extra entries,
  enforce bounds and require isolated roots. Tool pin equality with the parent
  TYPE plan is recorded in `TOOL-BINDINGS.json`; this does not admit future
  physical tool copies or attest actual invocation provenance.

## Required Future Compound Checks

These are concrete integration obligations, not new leaf defects or policy
questions. This review does not claim the excluded core already implements them.

1. Seal a fresh exact assembly union: both corrected postimages plus all six
   BUILD projections. Neither overlay's unchanged-parent list may revert the
   other's target. Parent seals are audit references, not postoverlay authority;
   all controlling projections need fresh path/hash/size/kind/mode membership.
2. Implement and seal `runTool.provenance` under the existing ABI, including
   actual copied Node/TS identity, fixed argv/cwd/environment, parent start/end/
   reap times and overflow. The ABI's short result omits this field; BUILD's
   `INTEGRATION.md:35` explicitly requires the refinement and fails if absent.
   No new method is invented, but compatibility cannot be assumed from paper.
3. Enroll deterministic generated-config bytes and bounded partial build outputs;
   publish large artifacts locally via writeJson/writeBytes, not262144-byte IPC.
   Reconcile16MiB files/32MiB metadata/8MiB compiler capture with actual core
   transport and cumulative guards. Reserve cleanup inside fixed deadlines;
   validate the leaf's120s start-through-reap condition, not just start-to-exit.
4. Rehash compact stageOutput references, full870 generated tree, entry and
   declarations, comparisons, archive, proof and final integrity after actual
   outer zero exit and known-owned reap. Source/tools/raw maps use `/manifest`;
   sourceBuiltManifest is a plain map. `build-worker.mjs:137` is explicitly
   pending; it cannot authorize imports. Line204's returned schema matches the
   declared artifact-reference shape statically, not a captured future result.
5. Keep A freshly source-built and B full-package installed then physically
   moved: two149-job profiles, not three. Enforce same-candidate/environment/GO
   pristine prerequisites before mutant materialization; actual mutated module
   load/invoke and changed expected behavior are required, never hash-denial
   credit. Retain the four UTF22 gaps and public-five UNRUN. Expected negative
   compiler results may be accepted only inside an otherwise verified zero-exit
   worker; any actual worker/parent nonzero remains aggregate FAIL.
6. Verify sticky ordinary failure with integrity AND known-owned reap before
   continuation; unsafe source/provenance/admission/integrity or unknown reap
   stops admission. Bind source, tools, recipe, loader, role maps, copied modes
   and root GO before any run. Opaque escaped descendants are not proven reaped.

## Scope and Validation Accounting

PC01–PC08 are addressed by static inspection/data or explicitly deferred core
proof, not eight passing controls. The336 outer/18 compiler maximum/24,165s
ceiling is unchanged, with cleanup inside and no retries. The194 IDs plus eight
overlapping overlays,149 jobs per profile,80 gap records/135 missing bindings
remain unchanged. Six direct type fixtures per profile remain12 future calls;
five public calls stay UNRUN; one build compiler gives18 reserved maximum.
Source23/at-C/masked-boundary evidence remains source-role evidence, not public
runtime, memory or progress proof. The2MiB fixture capture is not the16MiB public
Yq cap. No old semantic success is inherited or incomplete record rescored.

Five exact Git module bodies passed syntax-only Node parsing; raw stdout/stderr,
exit/status, parser PIDs and completion are in `SYNTAX-CHECKS.json`. These are
not compiler or control runs. All candidate executions/control/runtime passes
are0. Two reviewer-only static enumeration errors (missing mode-field location,
then entryOrder object shape) retain their original exit1 in ASSEMBLY-AUDIT;
the corrected data enumeration changes no authored input or expectation.
No new leaf-source finding was frozen because none was identified. Dynamic
controls remain UNRUN, and sealed compound review remains required before GO.

The normative criteria's write-spec check exits0 with no warnings. Applying that
same specification-shape checker to this non-normative audit report exits1 with
seven required-spec-format diagnostics; its raw outcome is retained in
FINAL-CHECKS.json. This report is not converted into a competing specification to
make that unrelated shape check green. No all-validation-success claim is made.
