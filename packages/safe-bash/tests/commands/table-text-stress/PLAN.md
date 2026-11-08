# Independent bounded checkpoint

The first native call reproduces the original `comm - -` input exactly through
both actual Shell pipeline and VFS redirection. GNU 9.7 produces stdout hex
`0909610a0909620a630a`, status 1, `comm: -: Bad file descriptor\n`;
both Shell paths produce identical stdout, status 0, empty stderr. This remains
an explicit native disagreement, not blanket rejection of shared stdin. Native
`src/comm.c` closes both input FILE pointers; the virtual Inputs cursor closes
once. No fabricated host descriptor failure is proposed.

The reused metadata oracle is GNU 9.7 but is a different binary build from the
author oracle. Archive and pinned manual hashes match author evidence; all
three current binary hashes are frozen in first-discrepancy.json. Online GNU
manual lookup was used only for orientation; current online manuals are newer,
so local pinned 9.7 source/manual and measured output govern this corpus.

Predeclared corpus: 48 seeded cases (seed 0x51a7, 16 each command), plus the
explicit edge cases in cases.ts. No adaptive random expansion. Every case runs
through real Shell pipelines and memory VFS, with exact native stdout/status,
stderr presence and unchanged file bytes/namespace. Native diagnostic hex is
retained, but GNU wording is not a product requirement. The original duplicate
close exception is separately characterized, never counted as a native match.
Positive workflows cover repeated stdin, byte delimiters, incomplete/CR/NUL
records, invalid UTF-8 C-byte keys, duplicates/Cartesian groups, headers, outer
joins and order checking. Contract tests separately cover quotas, cancellation,
backpressure and producer-owned Buffer reuse across next() calls. ByteSource
does not promise permanent ownership; readBytes forwards chunks and collectBytes
copies them. Mutation controls must copy the owned module, never dirty live code.

Freeze initial inputs, native rows and original red product observations before
any source fix. Commit fixtures/evidence separately, then cause-specific source
fixes, then acceptance evidence. Author files and all root exports stay frozen.
Run unchanged historical author 311 cohort separately from independent tests;
do not rerun root build or emit TypeScript. Hash dependencies before/after every
acceptance; record concurrent drift rather than claiming whole-tree green.
Independent final review is reserved for a different root-assigned agent.
