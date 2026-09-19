# Common input compression implementation

The behavioral authority remains released csvkit 2.2.0, source archive SHA-256
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`,
under the profiles in `reference-profile.json`. Both frozen optional-module
profiles lack zstandard. This update does not claim full suite compatibility.

Failing original domain regressions preceded common opener corrections:
absent zstandard `.zst` input is ordinary text; injected provider metadata cannot
widen the exact case-sensitive `.gz`, `.bz2`, `.xz`, `.zst` suffix set; raw
binary byte sources bypass the common text opener. `Runtime.bytes(path, true)`
selects common text decompression; `Runtime.bytes(path)` reads raw binary bytes.
Text inputs and csvpy's common source use the former. Source-backed regression
tests also distinguish Python `splitext` from last-dot scanning: `.gz`, `..bz2`,
`...xz` and `.zst` basenames have no compression extension, while `.real.gz`
does. `in2csv` format guessing deliberately retains its different last-dot rule.
No binary Excel/DBF
operation has been qualified by this API separation.

Stdin has no extension-based dispatch. Hosts can explicitly supply an already
decoded stdin stream, but no compressed stdin profile is inferred from bytes.
`in2csv` still guesses the outer extension before opening: `.csv.gz` does not
implicitly select CSV. Missing `.gz`, `.bz2`, `.xz` capabilities remain explicit
status-78 blockers. A `.zst` provider explicitly selects the optional-capability
profile; its presence is not automatically inferred from the host environment.

`createGzipCompressionProvider(createCompressionCodec())` accepts an explicit
structural office-package codec binding, with no product processes, filesystem
access or codec discovery. Import `createCompressionCodec` from the existing
`@poe-code/office-package/compression` public route; the csvkit package has no
runtime dependency on it. Supply the returned provider in SDK `compression` or
the safe-bash plugin's `compression` array. The engine accounts compressed and
inflated bytes separately, awaits output backpressure and enrolls cleanup before
acquisition. The provider requests bounded 64 KiB output chunks and owns its
reader's closure, preserving primary source failures including falsey values.
An empty gzip byte source decodes to empty text.

Inspection and a failing office regression found that Python-style zero padding
must permit later members and reject subsequent invalid bytes. The CSV adapter
explicitly selects the shared codec's `padding: "members"` policy, which skips
padding and resumes decoding across source chunk boundaries. The default
`"terminal"` policy preserves existing Node-compatible archive behavior. An
initial global policy change failed the original safe-bash archive regression;
that regression passes after introducing explicit policy selection. Padding
scans check cancellation and yield cooperatively. In-memory office regressions
cover concatenation after padding and rejection of junk after padding. These
are codec correctness tests, not new native csvkit differential observations.

Exact corrupt/truncated gzip exception classes, messages, traceback identities
and partial-output timing remain unqualified. The adapter returns an explicit
status-78 diagnostic instead of claiming native status/message parity. Trusted
providers can supply measured `PythonException` diagnostics themselves.
Bzip2/xz/zstandard implementations and real provider qualification are still
blockers; existing provider injection is not a shipped implementation of them.
The adapter requires the codec's explicit `memberAdmission` capability. A
failing original regression preceded adding the office `onMember` hook before
the first member and every subsequent decoder reset. The runtime supplies
`maxArchiveMembers` as the provider's optional third argument; direct adapter
calls default to the engine's finite member limit. The adapter refuses excess
members before decoding them, retaining earlier member output. Third-party
providers that ignore this optional argument remain unqualified for member
admission. Internal CPU,
memory, cancellation and allocations of arbitrary trusted codecs remain host
responsibilities. No additional compression reference profile is claimed.

Independent actual-Shell stress tests are registered in maintained discovery.
They measure extension dispatch, stdin, outer-format guessing, byte budgets,
file preservation and cleanup independently of the domain tests. QA procedure:
`docs/plans/csvkit-compression-qa.md`.

## Focused check results (dirty worktree, not release qualification)

The initial domain regressions observed status78 instead of status0 for plain
`.zst`, a `.GZ` decoder invocation instead of bypass, and a compression refusal
on raw binary bytes. The initial office regression emitted only `a\n` instead
of both padded members' `a\na\n`. A further member-budget regression resolved
instead of rejecting excess members. Each correction followed its failing case.

Final domain unit tests pass 1,344 with five explicit TODOs; TODOs are not passes.
Office unit tests pass 47. After the padding-policy split, 41 selected codec
and independent Shell consumer tests also pass. Domain/office lint includes product and test
typechecks and passes. Ten independent compression Shell tests plus the existing
csvkit Shell files cover 90 tests (the prior combined 89-test cohort and the
subsequent independent dotfile case pass). Post-policy-fix independent stress
passes all ten cases, and the original archive compression file passes 65/65.
Real office-codec Shell cases cover concatenation,
split padding, every-byte fragmentation, explicit-format compressed `in2csv`,
input-byte preservation, inflated-byte admission and zero/one member limits.
They do not measure native corrupt-stream diagnostics.

Maintained integration discovery tests pass 109/109. Public cleanup consumers
pass 22/22 with the new export. Selected domain/office build closures and the
final safe-bash dependency closure (ten maintained builds) pass after the
padding-policy split; the
normal repository build passed before the final member-admission addition.
Safe-bash source/tests and 26 consumer-group typechecks passed after member
admission and before the final padding-policy split. Guarded repository ESLint completed with zero errors and two unrelated
warnings; repository type lint and workflow lint also passed. These checks do
not certify full csvkit compatibility or a successful full repository unit run.

Compiled public opener/format-guess and member-budget output screenshots were
rendered and inspected: help alignment and diagnostics were readable without
clipping. Owned temporary evidence is removed after reduction. No README,
staging, commit, push or release operation is authorized or claimed.

The source archive was authenticated again during this update: 3,820,365
compressed bytes, 41,328,640 inflated tar bytes, matching the required SHA-256.
Initial research input/output caps of 1,000,000/32,000,000 bytes refused the
inspector; those incomplete attempts are not source-inspection passes. A bounded
streaming retry authenticated the same archive and admitted only exact regular
Python source entries of at most 100,000 bytes. Subsequent inspection used a
48,000,000-byte inflation bound. `cli.py:279–292` supplies exact `splitext`/codec
dispatch; `utilities/in2csv.py:115–125` confirms separate Excel binary and common
schema paths; `utilities/sql2csv.py:76` uses the common query input opener;
`convert/__init__.py:8–21` retains last-dot format guessing. Source inspection
does not requalify the frozen CPython/dependency runtime itself.

The first full repository unit attempt stopped after the shared group with four
gzip test failures (130,794 passed, two skipped, five TODOs). That live run began
before the member-admission change and loaded the older office codec. Rebuilt
focused tests pass; the mixed live attempt is not credited as a current full
gate. A maintained full-route retry passed the shared group with 130,799 tests,
two skipped and five TODOs, then exposed the original safe-bash archive padding
regression. The post-fix focused checks above pass; that broad attempt cannot be
credited as a green gate. The committed Pandoc build-metadata case also fails;
an isolated current-code rerun reproduces `committed build input differs from
reviewed authority: scripts/build.mjs`. The clean packed S3 export case fails
as well; its isolated name-filtered rerun reproduces the same authority error.
An earlier unfiltered rerun imported the full archive-control cohort and was
terminated; it is not credited as a completed check.
These committed-authority blockers cannot be resolved by committing
under the current instruction, and the archive verifier remains unchanged.
The full retry completed with exit 1. Its safe-bash group reported 40,541 tests:
39,715 passed, three failed, 823 skipped, zero cancelled and zero TODOs. The
three failures are exactly the now-fixed archive padding regression and the two
independently reproduced committed-authority checks above. This is not a green
current-source full gate; post-fix focused results are recorded separately.
