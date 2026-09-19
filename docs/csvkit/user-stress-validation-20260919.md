# csvkit user stress validation, 2026-09-19

This run exercises the current dirty worktree; it does not qualify a committed
release or establish full csvkit parity. Existing edits and staging were preserved.
No product source change was justified by the new stress cases. No commits,
pushes, publishing or README additions were performed.

## Reference and workflows

Downloaded the profile's PyPI csvkit 2.2.0 source archive into a bounded streaming
SHA-256 calculation without retaining a host file. Its 3,820,365 bytes match
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
The initial 2 MB research bound rejected this archive; the corrected 20 MB bound
completed verification. No new CPython dependency-profile requalification was
performed; differential expectations use the existing frozen captures.

Ran the actual safe-bash tests in `csvkit-request-workflows.test.ts`, including
literal `CommandContext.invoke` argv pipelines and VFS `sh` scripts. Verified
quoted expansion, exact stdout/stderr bytes, immediate PIPESTATUS, csvclean
redirection and absence of legacy side files; TSV/ASV, join, filename stack,
raw streaming JSON and typed statistics; XLSX filename/dash stdin and side-file
naming; injected SQLite WASM CSV stdin queries and an owned memfs database;
injected JavaScript Python reader session with Python stdin and exactly one
session closure. Selected byte-ownership, input-lifecycle, SQL-lifecycle and
final-user suites together yielded 42 passes and one explicit descriptor TODO
out of 43 tests, with zero non-TODO failures.

The separately assigned stress agent added `csvkit-september-user-stress.test.ts`.
Its two tests contain 18 exact-byte round-trip pipelines and one quoted filename
cleaning workflow. Inputs include embedded delimiters and quotes, multiline
fields, tabs, Unicode, NUL, record/unit separators, literal escape characters and
empty cells. Diagnostic label escaping, physical line number, raw leading zeros,
source immutability and namespace effects are checked. These preservation cases
are not newly captured CPython differential evidence. The independent focused
cohort reports 28 passes, zero failures and one input-quoting TODO in 29 tests.

## Maintained checks

- `npm run build:workspaces -- --workspace=@poe-code/csvkit`: passed the maintained
  selected dependency closure (safe-fs, office-package, safe-python, csvkit).
- `npm run test --workspace=@poe-code/csvkit`: 96 files passed; 4,370 tests passed,
  one skipped, five TODO, total 4,376. Skips/TODOs are not parity passes.
- `npm run lint --workspace=@poe-code/csvkit`: passed ESLint and source/test types.
- `node --test packages/safe-bash/scripts/integration-inputs.test.mjs`: 109 passed.
  Added only the new test's literal discovery assertion to the existing edits.
- Focused ESLint on the new stress test and integration inventory test: passed.
- Broader actual registered-command run with `node --import tsx --test
  --test-concurrency=1` and the `csv*.test.ts`, `in2csv*.test.ts` and
  `sql2csv*.test.ts` command-file globs: 2,096 tests, 2,093 passed, one skipped,
  two TODO, zero non-TODO failures. The new stress file was tested separately;
  this cohort's filename glob was expanded before that file was added.

## Limits

Named `/dev/fd/3` XLSX input remains unsupported by the shell VFS; ordinary named
input and `-` stdin are measured separately. Reader input quoting modes 2/4/5
remain explicit compatibility blockers, including csvformat mode 2 returning
status 78 where the frozen reference succeeds. Encoding profile TODOs remain
unqualified. Tests asserting explicit refusal do not prove native behavior.
No configured real-root or deployed remote filesystem was authorized or measured.
No production database credentials, external driver/service, IPython/TTY profile,
full Agate Python library or arbitrary host-work preemption was qualified.
No new visible product CLI behavior was changed; this run did not add screenshot
qualification, a repository-wide gate or a release claim.

Temporary check logs were reduced into this record and removed after inspection.
