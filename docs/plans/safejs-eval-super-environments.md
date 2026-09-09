# Eval constructor and super environment coverage

Readonly native comparisons matched all ten direct eval cases (58737) and
five checkpoint cases (59532) before adding tests. No implementation defect
was reproduced, and no runtime fix is claimed or needed for these probes.

Preserve coverage for super construction from eval/default parameters/arrows,
public and private field initialization, repeated super rejection, super getter
and setter receivers, and strict eval declaration isolation. Recovery coverage
retains an uninitialized derived-constructor environment through an eval-created
arrow after the original constructor has returned a different object, then
initializes its instance correctly after restore. Also cover repeated calls and
private fields after that delayed construction.

These two test files depend on the uncommitted guest eval implementation. Do not
commit them alone against the current committed runtime. They are outside the
1,163-file frozen full-suite snapshot running as 11849. The focused run passes
all 15 tests across both files; its chained lint step also passes (68322, exit 0).
No push or release.
