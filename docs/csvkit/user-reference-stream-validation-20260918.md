# Frozen-case stream user review, 2026-09-18

Procedures: [domain replay](../plans/csvkit-user-reference-stream-qa.md) and
[independent lifecycle review](../plans/csvkit-user-final-stress-qa.md).

Fourteen new canonical domain tests perform 658 actual engine executions through
executable argv and independently declared SDK settings. They replay the original
historical inputs and exact stdout/stderr/status at every two-chunk byte split,
then with a reused single-byte buffer and interspersed empty chunks. Named files
use memfs, including two-pass csvstack reopen flows. Assertions preserve complete
file bytes and namespace and require finalization of every acquired iterator.

The selected cases are raw-operation-reference indices 1, 4, 25 and 30;
additional-operation-reference 1 and 6; csvstack-reference 0, 3 and 6;
csvjoin-reference 2 and 5; csvsort-reference 0 and 1; and csvlook-reference 5.
They cover duplicate cuts, invalid zero columns, inverted any-match, quoted
multiline numbering, short/surplus rows, the upstream join-short-rows failure,
line-number collisions, duplicate headings/missing cells, surplus dictionary-key
failure, numeric join identity, Unicode uppercase expansion, duplicate sort
selectors/nulls and display truncation. Historical failure statuses and diagnostic
bytes remain unchanged. No stderr normalization or denominator reduction occurs.

The independent agent added three actual Shell tests: fourteen original version
paths avoid stdin advancement and named-file acquisition; empty chunks and split
UTF-8 work without an iterator return hook; cancellation rejects late named bytes,
closes the cooperative iterator exactly once and permits later Shell reuse.
The new file is explicitly asserted in maintained guarded test discovery.

No csvkit product defect was validated, so no product source was changed. An
initial independent probe incorrectly assumed Shell would not create a borrowed
stdin iterator. Its failure occurred in ShellInput/InputCursor before csvkit
dispatch. The retained test checks no advancement and documents this existing
shell boundary; it does not claim lazy shell-level acquisition.

Completed verification:

- Maintained domain unit route: 95 files, 4,369 passed, one skip and five TODOs.
  These six unresolved cases are excluded from passes and compatibility claims.
- New focused domain tests: 14 passed, 658 replays, 201 ms test execution.
- Maintained domain lint: ESLint and product/test TypeScript checks passed.
- Selected maintained build closure: four declared workspace builds passed.
- Independent Shell tests rerun with TSX caching disabled: three passed,
  no skips/TODOs; focused Shell/discovery ESLint passed.
- Maintained safe-bash runner route: all 536 assertions passed, no skips/TODOs.
- Maintained safe-bash typecheck: source/tests, authenticated historical consumer,
  four source-consumer groups and 26 built consumer groups passed; three negative
  consumers rejected compilation as required. Compile-only, no runtime acceptance.

A mistakenly selected normal safe-bash workspace test run discovered all 1,267
active files because SAFE_BASH_TEST_RG is not a selector supported by that package
runner. Only this run's process group was stopped; its exit 143 is incomplete
evidence, not a pass. The explicit new-file invocation and maintained runner route
above are the completed focused checks. No full safe-bash or repository unit pass
is claimed. This test-only campaign did not change displayed product output.

Historical reference files were replayed; this campaign performed zero fresh
native captures and does not requalify their frozen installations or attribute
all source branches/options/upstream tests. The coverage ledger's unresolved
mappings remain blockers. Workbook/compression/driver/service/interpreter/TTY,
encoding, locale and native signal/buffering qualifications retain their existing
limits. Cleanup assertions are not native csvkit parity evidence. No README,
staging, commit, push or publication action occurred.

Hashes of reviewed bytes (SHA-256):

| Artifact | SHA-256 |
| --- | --- |
| Domain replay test | `7d30a2e61f4154fc31ed99df4633bc7da1f74cbda828878037255338eb373cf9` |
| Independent Shell test | `6e8ed5e25763a51d5f7678a86187d3846a7086b26c4cbae23d85bb0c29ae28ab` |
| raw-operation-reference.json | `4f337e5feb518df030af85af857973a842e38f6631903b79797c339beba46330` |
| additional-operation-reference.json | `fa0eba8cfb1d046a3818671cb9d11d4cf2c6bac5c9a885f14c9571067454c8d8` |
| csvstack-reference.json | `3575e6d6a700d8544ed850fae0169e9f08311d0e8fe1d83ad7b56d9d07894ddb` |
| csvjoin-reference.json | `2e2b61ee6f899add12b4abc712ca583fc833e941a8f70cc15371aa19fd1e6800` |
| csvsort-reference.json | `0119a79c6fa5a2914f1bc723d222eeff6fde363798c856ab6980c43adf816b8d` |
| csvlook-reference.json | `d0f3e873b5c39c57d9b326357fc9cb4e7a312c1f6e75958bb171a893a85b126d` |
| Domain package.json | `46f13dc3461c0320140b35af1725fdcdc9d095681bf91e0b9de5a6893828ea81` |
| Safe-bash csvkit binding index.ts | `419a716f35dc2fbd88367ad488e2247ed032fdccd0a2082e431ad2c26bd7ffd2` |
| Guarded discovery assertions | `07c75c16184ada8ad0dd2901a6085b232b9380db8e1829ec4fd470796d8d9312` |
| Root package-lock.json | `497c60b17eef09628628ed4a14551c706e3005db905b786e7e46ad8ecd872436` |

The dirty candidate domain source manifest has 218 regular files recursively
under packages/csvkit/src, digest
`9cfa25acfe7e981d90b794f60a72688909b83e73ae5ea833d62b51610529f842`.
Definition: SHA-256 of UTF-8 JSON.stringify of lexically sorted
`[repository-relative POSIX path, raw file SHA-256]` pairs, no trailing newline.
This identifies the inspected candidate; it is not a committed/packed-consumer
qualification or a new frozen reference profile.
