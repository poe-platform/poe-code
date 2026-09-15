# Bash background jobs: review and integration

## Scope

Integrate `&`, `$!`, and the `wait` builtin into current main. Review the retained
older implementation against Bash semantics before integrating it. Do not import
its unrelated `exec`, process-substitution, command, filesystem, or test changes.
Do not spawn host processes in the product or enable network/filesystem access.

The starting integration revision is `77505a0e7`. The original checkout at
`dde2f6556` contains unrelated retained work; preserve that work on its original
base before advancing main. No history rewrite, new branch, or blanket staging.

## Review findings

1. The older implementation drains descendants before resolving a background
   child's status. Bash's `wait PID` waits for that child, not its grandchildren.
   A child that backgrounds a blocked command and exits must be waitable before
   the parent releases the grandchild. The old behavior can deadlock.
2. The older implementation closes inherited outputs too early. A background
   writer delayed until the next turn can lose its output in a pipeline or
   command substitution. Child exit status and inherited output EOF must be
   modeled separately; draining all descendants before returning status does
   not fix both requirements.
3. The original numeric wait/status behavior is useful but is not the complete
   Bash interface. Assess jobspecs and modern `wait -n`, `-p`, and `-f` explicitly.
4. Background execution needs the current shared resource admission, state-copy
   ownership, and cancellation barriers. Do not transplant old resource logic
   over newer implementations merely because its happy-path tests pass.

## Required behavior and validation

- An asynchronous list starts in an isolated shell environment and sets the
  parent's immediate status to zero. `$!` identifies the latest direct job.
- Jobs preserve function context where Bash does, but changes to variables,
  cwd and job tables cannot leak back from a child or subshell.
- Default background stdin is empty; explicit redirection still takes effect.
- Wait statuses, repeated waits, unknown IDs, bare wait, multiple operands,
  pipelines/and-or lists and job-table isolation need behavioral tests.
- A job's status becomes available independently of descendant completion.
  Inherited pipe/capture/file output remains valid until its actual writers
  finish; unrelated redirections do not keep that output open.
- Cancellation, error propagation, command/state/concurrency bounds and final
  cleanup need tests through the public shell API, including delayed writers.
- Use small synthetic native Bash comparisons. Never execute the trace corpus.
  Native oracle availability and versions must be stated; untested modern
  behavior must not be labeled native-verified.
- Establish behavioral RED on current main, then GREEN on the candidate. Run
  maintained build/type/lint/test routes before integration; preserve failures
  and resolve them rather than bypassing hooks or weakening guard policy.

## API lifetime qualification

A virtual execution owns its jobs and output resources. `Shell.exec` cannot
return a final immutable output result while owned jobs can still write to it.
The API must join or retire its owned work before settlement and disposal, with
cancellation propagated to cooperative work. This lifecycle boundary differs
from launching a noninteractive native Bash process that can exit while children
continue independently. It must be documented without claiming detached host
processes, terminal job control, or complete Bash parity.

## Evidence

- Initial independent review reproduced descendant-wait deadlock and delayed
  output loss in the older working-tree implementation.
- Native comparisons used installed GNU Bash 3.2.57 and GNU Bash 5.3.0, built
  from the official GNU 5.3 source distribution in a temporary directory. Modern
  option checks used 5.3; no system shell was replaced.
- The integration tests first produced a behavioral RED on the exact current
  HEAD source: all 14 initial cases failed because `&` was unsupported.
- GNU reference: https://www.gnu.org/software/bash/manual/html_node/Lists.html
  and https://www.gnu.org/software/bash/manual/html_node/Job-Control-Builtins.html.
- Candidate regression tests cover the reviewed behavior. Independent review
  added 23 cases; the combined review and cleanup checks passed 65/65.
- Numeric, current and previous jobspecs and `wait -n/-p/-f` are supported. IDs
  are virtual; text-prefix jobspecs, `jobs`, `fg`, `bg`, `disown` and terminal or
  stopped-process job control are outside this change. With no stopped processes,
  `-f` has the same effect as an ordinary wait.
- Unrelated local work is preserved at its original base in the sibling checkout
  `poe-code-retained-local-work`, with a tracked-change stash and a hash manifest.
  Main was fast-forwarded to the integration revision without rewriting commits.
- The main workspace build, root type/contract checks, all 26 safe-bash consumer
  groups, and all 17 package rules passed. The 56 focused background regressions
  and 32 browser bundle tests passed.
- The complete maintained safe-bash unit task ran 320 build/discovery tests
  successfully, then 31,761 runtime/integration tests: 31,658 passed, 17 failed,
  86 skipped and none cancelled. All 17 failures were isolated op prerequisite
  fixtures (14 committed-export checks and three writer-fixture checks), rather
  than background-job behavioral failures. Their corrections are validated
  separately; this initial full run is not represented as a pass.
- Local main contains the reviewed integration. The 17 fixture failures were
  corrected and their focused suites passed (198 archive controls, six writer
  checks); the actual committed-export probe is checked separately after commit.
  Repository-wide gate limitations remain below. No push or release is claimed.

## Repository-wide gate limitations

The full `npm test` attempt used the maintained root orchestrator in the reviewed
checkout, after verifying every changed code and test file matched main. It
reported 312 failures, all in safe-python, and was stopped after that clear
failure result. This is an incomplete failing run, not a full test pass. An
independent package-local run of `session-codec-cstring-replacement.test.ts`
reproduced six failures and nine passes. No safe-python files were changed.

Root `npm run lint:eslint` exited 2 at its 12,000-subject cap, on
`packages/safe-bash/tests/commands/archive-stress/pax-independent/fixtures.ts`.
It reported zero findings before exhaustion, which does not constitute a lint
pass. The current safe-bash AGENTS instructions require other guard limits to
remain unchanged; the cap and file-selection policy were preserved.

These results prevent claiming a clean repository-wide or release gate. The
background-job review and affected-package validation are separate evidence.
No push or successful release is claimed.
