# Independent bounded table-text checkpoint

## Outcome

No new production bug was confirmed; production is unchanged. This is not final
independent-review approval. A different root-assigned reviewer owns that gate.

First, the historical GNU9.7 `comm - -` case was reproduced exactly. Input hex
`610a610a620a620a630a` gives stdout `0909610a0909620a630a` on native and actual
Shell pipeline/VFS redirection. GNU exits1 with `comm: -: Bad file descriptor\n`;
virtual exits0 without stderr. Native src/comm.c assigns both streams to stdin
(line288), then closes each (line386). The virtual shared cursor closes once.
This remains a mismatch, not a parity pass, input refusal or synthetic EBADF fix.

## Frozen evidence

- Fixture commit `0a1167d`: initial-inputs.json preserves original source/author
  hashes. No author fixture or oracle expectation was edited.
- frozen-corpus.json:71 cases,23 explicit and48 seeded (16 per utility,
  seed0x51a7). Native rows and original-red.json were frozen before any possible
  source fix:70 matches and the known disagreement, zero newly confirmed reds.
- isolated-acceptance.json: independent104/104 =71 Shell cases +32 lifecycle/quota
  tests +one live recheck of71 native rows. This is71 native workload calls,
  plus3 version calls, not104 native calls. Ordinary comparisons use exact
  stdout/status/file bytes/namespace and stderr presence. The native recheck
  compares full stderr bytes too. The disagreement is separately characterized.
- Unchanged author311/311:260 table +31 aggregate +20 diagnostics/structured
  interoperability tests. Its216 native workload calls plus3 version calls are
  separate from Node counts; historical215/216 parity remains unchanged.
  The historical six built-package checks were not repeated.
- Scoped TypeScript --noEmit passes. No root build, JS siblings, global test
  audit, broad diff rerun or comparison expansion was performed.
- Final acceptance brackets all src, author files, extra cohort dependencies,
  independent inputs, package locks/config and installed tooling manifests.
  All cohorts show zero measured content drift and stable native binaries.
  Earlier acceptance.json lacks the expanded extra-test dependency hashing;
  it is preserved, not silently upgraded into the final acceptance.

After acceptance-final.json, unowned src/commands/structured/input.ts,
src/commands/structured/jq.ts and src/shell/shell.ts changed. From the very first
capture, src/commands/filesystem.ts, src/fs/s3/README.md and
src/fs/webdav/README.md also changed. closure.json preserves that earlier
checkpoint; it is not current-tree acceptance. The exact path/hash changes are
retained, not waived. A byte-verified isolated snapshot then reran the same
104/311/noEmit scope successfully with no snapshot drift. See
isolated-acceptance.json for its complete source/test/dependency manifest and
retained ignored snapshot path. No production or author table-text file changed.

Actual memory-VFS pipelines cover repeated stdin, delimiter cycling/empty fields,
CR/incomplete lines, NUL/invalid UTF-8, C-byte ordering, order modes, duplicate
multiplicity,35x31 Cartesian products, headers and outer joins. Contract checks
cover all10 quota keys, producer failure, cooperative blocked VFS stat, exact
errno-shaped cancellation during blocked output, no reads while writes remain
blocked, and producer-reused Buffer fragments. ByteSource does not guarantee
indefinite ownership; mutations occur only when next() resumes the producer.

## Pinned native and delivered profile

Read-only metadata oracle: GNU coreutils9.7, LC_ALL=C. Its binary hashes differ
from the original author's build and are recorded in first-discrepancy.json.
Archive SHA256:e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf;
manual SHA256:39b126752866fff675e462bd44d76f3e034abafe462a069cebd53ef39fc53eca.
Both match historical evidence. No metadata/shared oracle changes, Apple runs
or silent oracle fallback. Online primary GNU manual lookup returned newer
manuals; pinned9.7 source/manual and observed output govern this checkpoint.

Actual profile: paste parallel/serial, delimiter escapes and NUL records; comm
column suppression, totals, output delimiters, order checking and NUL records;
join selected fields, duplicate products, outer/unpaired output, output lists
and auto, headers, ASCII case folding, single-byte/NUL/whole-record delimiters,
order modes. Unknown flags, help/version and legacy join syntax remain rejected.
comm/join require C/POSIX; this existing explicit profile is not oracle picking.

Unchanged defaults: maxInputBytes/maxOutputBytes256MiB;
maxRecordBytes/maxChunkBytes1MiB; maxGroupBytes8MiB; maxGroupRecords100000;
maxFields65536; maxFiles64; maxSteps2000000; maxArgumentBytes65536.
Overrides must be positive safe integers. Root/subpath exports remain
tableTextCommands, createTableTextCommands, TableTextCommandsOptions,
TableTextLimits; aggregate forwards tableText limits. No root change requested.
Only paste/comm/join are in this family; cut and runtime dependencies unchanged.

## Mutation controls and reproduction

mutation-final.json: copied-module baseline4/4; Buffer.slice regression rejected
by3/4 tests; missing stdin cursor reuse rejected by1/4. These run the same four
independent contract tests. Exactly one source substitution is required and
module/setup/type failures are rejected as false proof. Live production is never
mutated. Ignored copies and raw output/hashes remain available. This is worker
evidence only; a different reviewer must independently run final controls.

Run `node --unhandled-rejections=strict --import tsx --test
tests/commands/table-text-stress/*.test.ts` and
`node_modules/.bin/tsc --noEmit -p tests/commands/table-text-stress/tsconfig.json`.
The exact oracle is required: missing/changed binaries fail, never skip.
Run acceptance.ts or mutation.ts through node --import tsx with a fresh JSON
filename argument. Existing evidence cannot be overwritten. Native directories
are owned/sentinel-checked/ignored; no generated binary enters commits.

Remaining: different-agent final review; independent positive remote/wrapper
workflows beyond inherited tests; cancellation/failing cleanup at every stream
boundary; broader options/locales/platforms. Noncooperative host work cannot be
forcibly stopped. No universal GNU/BSD/Bash parity, whole-project completion,
superiority,72-hour-work or new built-package claim follows.
