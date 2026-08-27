# Dangling output correction: baseline and regression evidence

Author source freeze: 1836795aed012ad734fedbd0ed56c2c98ab57f56; final author
handoff: 4244e9a. `author-*-original` files preserve the complete original
handoff, README, contracts test and final result without changing their claims.
The original 43-test evidence remains in the parent evidence directory;
`baseline-author43.tap` independently reruns those exact tests: 43/43 pass.
That count included an incorrect expectation of EEXIST for a stable dangling
final output symlink, not native-compatible behavior.

The expectation correction and added native regression precede the product fix
in a separate commit. `initial-corrected-tests.tap` records 29/31 passing tests,
two failing tests (corrected author expectation and aggregate native regression).
`native-initial.json` preserves all fixtures, exact status/stdout/stderr, recursive
namespace/file bytes/link targets, platform, binary pins, source hash and failures.
Its 11 GNU cases replay on two backends: 6/22 backend-case observations pass,
16/22 fail. These are 11 native inputs, not 22 independent inputs. Six successful
dangling creation inputs fail on both backends; missing-parent and completed-output
then missing-parent also fail on both. Loop, non-directory and input alias controls
already pass on both. No independent reviewer fixtures were inspected.

GNU9.7 is the supplied pinned Darwin binary, not GNU/Linux evidence. Apple is
recorded separately: the six positive inputs also create targets; negative statuses
are 74 rather than GNU's 1, and Apple's nested input alias run succeeds destructively.
Do not substitute Apple for the GNU input-protection policy. Native absolute links
are explicitly rooted under test scratch; snapshot comparison strips that exact
prefix only, while virtual links retain virtual absolute targets. This mapping is
fixture setup, not a changed oracle or altered native output bytes.

Primary references consulted through web.run: GNU Coreutils `split invocation`
and POSIX.1-2024 `open`. The latter specifies that O_CREAT plus O_EXCL rejects a
final symbolic link, including dangling links. Live documentation is context only;
local pinned captures govern the tested GNU9.7/Darwin behavior. No downloads or
native builds occurred. Negative diagnostics are separately asserted typed-error
human-readable profiles, with exact original raw strings retained, not blanket
stderr normalization. Successful outputs require exact empty stderr.
