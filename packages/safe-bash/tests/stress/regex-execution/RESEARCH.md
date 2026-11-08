# Primary documentation research

Consulted via web on August 27, 2026 UTC (August 26 America/Chicago). Facts below
are paraphrases of primary documentation, not product experiments. URLs are
recorded explicitly for review. Moving documentation labels are not installed
runtime/oracle versions; no native version or runtime flag probe was performed.
No example patterns from the documentation were executed or added as payloads.

## Scheduling, cancellation and isolation

- **R1 — Node globals**, fetched page labeled v26.8.1:
  https://nodejs.org/api/globals.html#class-abortsignal
  AbortSignal notifies observers; `timeout` creates a delayed abort signal;
  `throwIfAborted` throws the reason only when already aborted. The API describes
  cancellation notification, not arbitrary synchronous-code preemption.
- **R2 — Node timers**, fetched documentation labeled v26.7.0:
  https://nodejs.org/api/timers.html#scheduling-timers
  Callback timing depends on event-loop work; exact timing/order is not guaranteed.
  Promisified timers accept AbortSignal to cancel the scheduled timer. That is
  not a RegExp interruption facility.
- **R3 — Node event-loop guidance**:
  https://nodejs.org/learn/asynchronous-work/dont-block-the-event-loop
  Synchronous callback work occupies the event loop. Guidance discusses bounding
  input, partitioning work and offloading, and warns that some regex evaluation
  can be expensive. This general warning is not an empirical result for this repo.
- **R4 — Node worker threads**, version-pinned v22.19.0 documentation:
  https://nodejs.org/download/release/v22.19.0/docs/api/worker_threads.html#workerterminate
  https://nodejs.org/download/release/v22.19.0/docs/api/worker_threads.html#new-workerfilename-options
  Workers execute JavaScript separately; termination is asynchronous and aims to
  stop execution as soon as possible. Worker data uses structured cloning/transfer;
  class prototypes are not preserved. Resource limits concern the JS engine,
  exclude external data such as ArrayBuffers, and do not prevent global OOM.
  **Inference:** pure matching could be separated without transferring live VFS
  objects, but messaging, effects, cleanup and deadline precision need design and
  independent validation. No worker was run in this assignment.
- **R5 — V8, “An additional non-backtracking RegExp engine”**, January 11, 2021:
  https://v8.dev/blog/non-backtracking-regexp
  Documents an experimental automata engine and flags, with linear subject-length
  behavior for supported patterns. The described fallback excludes backreferences,
  lookaround, large/deep finite repetitions, and Unicode/case-insensitive flags.
  This historical article does not establish availability/defaults in any current
  Node deployment. **Inference:** neither native RegExp presence nor a syntactic
  rejection list proves fallback eligibility or a deadline for this product.

## Tool profiles

- **R6 — jq 1.8 manual**, regular expressions and split:
  https://jqlang.org/manual/v1.8/#regular-expressions
  https://jqlang.org/manual/v1.8/#split
  Documents Oniguruma's Perl NG flavor, regex flags and codepoint match offsets.
  `split(str)` is literal; `split(regex; flags)` splits on regex matches, with a
  documented null-flags example. `splits` streams results instead of an array.
  Its `m`/`s` meanings differ from JavaScript's namesakes. **Inference:** byte
  sed/awk matching and literal jq splitting are not interchangeable implementations
  of that complete profile. Local signature rejection is established by source,
  not by running jq.
- **R7 — GNU grep 3.12 manual**, regular expressions:
  https://www.gnu.org/s/grep/manual/html_node/Regular-Expressions.html
  Distinguishes BRE, ERE and PCRE; GNU BRE/ERE are different notations for the same
  matching functionality. This does not certify the local JavaScript translation.
- **R8 — ripgrep maintainer documentation**:
  https://github.com/BurntSushi/ripgrep/blob/master/FAQ.md#how-do-i-use-lookaround-andor-backreferences
  https://github.com/BurntSushi/ripgrep/blob/15.2.0/GUIDE.md
  Default engine uses finite-state matching and omits lookaround/backreferences;
  optional PCRE2 supports those features with different execution tradeoffs.
  The FAQ is a moving branch; the guide is version-tagged. Local rg explicitly
  documents a different JavaScript engine, so upstream complexity claims do not
  transfer to it.
- **R9 — GNU Bash manual**, patterns and conditional constructs:
  https://www.gnu.org/s/bash/manual/html_node/Pattern-Matching.html
  https://www.gnu.org/software/bash/manual/html_node/Conditional-Constructs.html
  Shell globs use wildcard/bracket/quoting rules; extended patterns require extglob.
  Bash's `[[ ... =~ ... ]]` uses POSIX ERE with regcomp/regexec. The two languages
  are distinct; the local unsupported-keyword guard is not implementation of ERE.
- **R10 — GNU sed manual**, BRE/ERE:
  https://www.gnu.org/software/sed/manual/html_node/BRE-vs-ERE.html
  BRE is default; `-E` selects ERE, changing escaping of several operators.
  This syntax fact does not replace the repository's pinned GNU/BSD dialect policy.
- **R11 — GNU awk manual**, leftmost-longest:
  https://www.gnu.org/s/gawk/manual/html_node/Leftmost-Longest.html
  Explains earliest/longest selection and why it matters for replacement and
  splitting. This supports a semantic comparison dimension, not acceptance of
  every capture or locale behavior of the repository's custom engine.

## Evidence separation

Documentation establishes API/profile facts; source inspection establishes visible
call paths/check placement. Conditional reuse/isolation choices are inferences.
No source observation alone measures one regex's duration or proves a deadline
violation. Dynamic execution and verification counts are both **zero**. Existing
historical tests/results remain untouched and are not relabeled by this report.
