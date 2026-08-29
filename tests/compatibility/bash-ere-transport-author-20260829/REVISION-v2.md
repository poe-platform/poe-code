# Source-only v2, before any runtime activation

TYPE-01 strictly compiled12files and both consumers successfully. Source audit
then identified that the initial Worker inherited output streams. v2 requests
owned stdout/stderr, refuses any output as a protocol violation, and observes
stream errors. It does not forward output, grant host I/O or claim runtime stream
retirement. This is not a reproduced Worker defect: Workers remain ZERO/UNRUN.

The v2 seal preserves TYPE-01/SEAL.json unchanged and changes only owner.ts plus
this additive revision/preseal helper. `node typecheck-v2.mjs seal-v2` authenticates
all original12source slots, allowing only the separately recorded owner delta;
all other sources, fixtures, design and tools retain old hashes. It produces
SEAL-v2.json. Commit that seal and the owner correction BEFORE dispatching
`node typecheck-v2.mjs types-v2 TYPE-02`.

TYPE-02 is the final three authorized compiler processes, not runtime tests.
It reuses the exact source/positive/negative procedure with an immutable copied
dispatcher whose only changes are v2 action/label/receipt/seal names and the
revision binding. Both sets of compiler outcomes stay distinct. All32/60 runtime
variants remain UNRUN, R01 HELD, no actual Worker or Shell activation authority.
