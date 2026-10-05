# Bounded data matching

The internal regex engine supplies the shared text/query matcher and ERE
algorithms used by Safe Bash commands. It preserves capture behavior, explicit
work limits and cooperative cancellation without executing host utilities. Rg alternations and repetitions accept Unicode
literals, preserve UTF-8 byte offsets, and retain work limits and cancellation.
ASCII case-insensitive searches also accept Unicode subjects.
Replacement buffers preserve Unicode with finite or unlimited limits and do not
require the Node.js `Buffer` global. Sed, awk and query patterns accept shorthand
classes (`\d`, `\s`, `\w` and their uppercase complements) inside brackets.
Sed BRE supports `\(?:...\)` without allocating a capture. Query patterns support
inline and scoped `i`, `m` and `s` flags for case folding, multiline anchors and
dot-all matching; scoped flags restore the enclosing settings.
Large and deeply nested patterns use the caller's compilation budget. Parsing
and compilation avoid recursive traversal, and cancelled compilation can be
retried without exposing a partial program.

`Pattern.supportsStreamTest(budget)` identifies sed/awk patterns that can answer
match existence without retaining input or captures. For those patterns,
`testStream(chunks, budget)` consumes asynchronous text chunks with working memory
proportional to the compiled pattern. UTF-16 chunk boundaries, word boundaries,
anchors and cancellation are preserved. `supportsStoredTest(budget)` and
`testStored(input, budget)` additionally support sed/awk backreferences through
caller-owned random-access UTF-16 text and a deduplicated work queue. The caller
can keep input-dependent state in external storage with bounded caches. Pure
matching code does not choose a filesystem. Unicode `BytePattern` subjects must
use the existing decoding APIs; these new matching paths explicitly decline them.

Use commands through `@poe-platform/safe-bash` and its existing command exports. This
private workspace is bundled into Safe Bash and is not independently published.

`Pattern` accepts an optional sixth argument, `PatternLimits`, to bound instructions, source length (`maxPatternSource`) and group depth (`maxPatternDepth`) before eager compilation. `TextProgramOptions.maxPatternInstructions` bounds expanded regex instructions during preparation and matching. The same limits apply through `TextProgramOptions` on preparation and matching. Omission or `Infinity` disables each quota; a finite limit includes the final match instruction and applies to reused and eagerly compiled patterns.

`compilePythonGlob` from `safe-bash-regex-engine/python-glob` compiles Python 3.9
filename patterns with the existing Unicode matcher. Braces and backslashes are
literal, hidden filenames match ordinary wildcards, and matching spans newlines.
Pass `PatternLimits` to bound source, program and depth, then use the returned
pattern with the caller's normal matching budget and cancellation checkpoints.
