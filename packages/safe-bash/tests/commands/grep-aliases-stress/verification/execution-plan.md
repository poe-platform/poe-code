# Frozen-candidate execution policy

Candidate input is the full committed product source subtree and its package,
lockfile, README and TypeScript configurations at c9bd0dbb. No live product file
is overlaid. Every extracted file is checked against its Git blob before building.
This is a scoped committed-product archive, not a whole-repository gate.

The GNU cohort and comparison policy are committed as b99c959e before candidate
execution. The original 28a8ad15 payload remains byte-identical. Always report all
26 GNU and BSD exact tuples, the explicitly stderr-excluding GNU payload projection,
and bounded-profile acceptance separately. Native warnings are never stripped.

The build uses the installed TypeScript, Node declarations and undici declarations
read-only only after comparing every file to locally cached tarballs authenticated
against the candidate lockfile's SHA-512 integrity. No installation or download
is performed. npm pack is offline and ignores lifecycle scripts. Its extracted
package is physically moved into a separate standalone consumer; the consumer
imports public root Shell and an explicit internal packed alias module URL. Root
alias exports/subpaths are not present or presumed. Strict consumer checks use
the actual moved declarations, not proposed names.

The test observer wraps Node's actual Worker constructor and forwards construction,
events and messages unchanged, except for explicitly identified S04 scheduling
gates that hold the host postMessage call until released. Those gates provide
deterministic concurrent admission, not performance evidence. Workers still run
the authentic packed worker file. No test forcibly terminates workers; product
termination is observed. Supervisor timeout/forced cleanup is a failed run, never
a passing worker-cleanup result.

The frozen S02 wording says a ByteSource is returned by VFS readFile. The actual
declared readFile API returns Uint8Array, while readStream returns ByteSource.
Execute its owned-VFS producer-reuse condition through readStream, retain the
original wording, and disclose this API-wiring correction rather than claiming
the impossible literal call was tested. The exact input/expected bytes do not
change. Borrowed external Shell stdin, direct-context stdin and owned VFS streams
are reported as separate boundaries, especially for iterator return/cleanup.

Additional pre-observation adversarial checks cover inherited/nonenumerable
CommandContext fields, reusing frozen literal args, both standalone factories,
registration replacement/collision, independent family worker limits, direct and
nested command budgets, and owned/borrowed early-return behavior. These test alias
transparency rather than duplicating the whole grep suite. A proven alias-only
defect may be fixed with a regression and a new committed-source pack. Shared
grep/regex/Shell/runtime issues are reported to root with concrete repros and are
not waived or edited here.

Each explicit capture writes a new isolated directory. Tests never rewrite the
committed corpus or evidence. Raw failures, harness/type errors, retries, candidate
source hashes and package hashes are retained; later successful runs do not erase
earlier attempts. Missing observations and leaked work remain unpassed.
