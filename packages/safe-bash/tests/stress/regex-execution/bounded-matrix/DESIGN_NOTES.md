# Source-based design notes, not exposure findings

The matrix halted after one benign grep control. No meaningful stall was
measured; the following are conditional engineering options, not an engine
implementation, approval, or successful remediation test. Source observations
refer to the exact hashes in `frozen.json`; the later shell-runtime drift is
reported separately and is not analyzed as an updated contract.

## Observed local matching profiles

| Dimension | grep | rg | Existing sed/awk matcher |
| --- | --- | --- | --- |
| Implementation | `src/commands/grep.ts:4`, `:49`, `:59`: BRE/ERE translation, native exec | `src/commands/search/matcher.ts:38`, `:89`: wrapped native exec | `src/commands/text-programs/regex.ts:51`, `:196`: parsed instruction machine |
| Text and offsets | Latin-1 byte view; JS indices correspond to bytes; argv encoded UTF-8 | ASCII fast path or decoded UTF-8; UTF-16 indices converted to byte offsets; invalid-byte fragment handling | C-byte strings; offsets/capture boundaries in byte-oriented strings |
| Selection | Native JS ordered alternatives; not complete POSIX leftmost-longest | Native JS ordered alternatives, zero-length iteration and byte-offset bookkeeping | Earliest start, longest whole match; longer capture preference for equal whole matches, not exhaustive POSIX capture parity |
| Flags | `g`, optional `i`; byte presentation does not implement full locale folding | `gu`, optional `i`; Unicode properties; generated Unicode word lookarounds | Constructor BRE/ERE and ignoreCase switches; no drop-in `g/u/i` native state interface |
| Backreferences | Translation passes numeric references to JS; semantics remain JS | Numeric references/user lookaround rejected by current validator | Closed capture groups 1–9 supported, byte comparisons charged to budget; open/undefined references rejected |
| Limits | Translated source ceiling 65,536 characters; no instruction budget | Pattern byte ceiling 8,192; max 1,024 patterns; line/output/record quotas outside regex | Source 8,192; nesting 64; repetition bounds 1,000; instructions 16,384; invocation steps/state buffer bounded |

Additional concrete reuse gaps from source inspection (not extra test cases):

- The custom parser's escaped-character handling recognizes a small control
  escape table; other escapes become literal characters. It is not JS shorthand
  classes, word boundaries or Unicode property syntax. Named captures and JS
  special groups are not its grammar. Grep rejects `(?` itself; rg wraps ordinary
  groups and may generate lookaround for Unicode word matching, despite rejecting
  user lookaround. A reuse boundary must distinguish generated structure from
  unsupported user syntax rather than silently reinterpret it.
- Custom dot accepts a byte, including newline; native JS dot without dotAll
  excludes line terminators. Anchors and empty-match advancement need explicit
  record/CR/NUL handling. Rg's invalid UTF-8 splitting and offset mapping cannot
  simply be replaced with one Latin-1 pass.
- Longest-whole-match selection versus JS alternative priority affects grep
  `-o`, rg submatch/count/JSON modes and offsets, even if a line-selection-only
  boolean happens to agree. Backreference behavior for unmatched/empty/repeated
  captures and case folding also needs explicit conformance, not an API cast.
- Custom `Budget.step()` checks the signal and spends steps synchronously;
  interpreter `checkpoint()` yields every 256 checkpoints. Inside matching,
  state/capture queues and backreference byte comparisons spend budget, but
  caller timer delivery still needs the event loop. This is bounded logical
  work, not asynchronous preemption or an exact millisecond budget. It is not
  a proof of linear complexity for every capture/backreference program.

## Conditional ranking: zero runtime dependency options

1. **Pure matcher worker isolation** if existing JS compatibility must be
   preserved. A narrow Node-builtin worker could own compilation and matching,
   receive only bounded pattern/flag/subject data, and return match ranges and
   captures. Preserve lastIndex/empty-match rules, Latin-1 versus UTF-8/Unicode
   conversions, alternative selection and existing supported syntax; keep live
   VFS objects, commands and effects outside. This trades startup/messaging
   latency and worker heap/state for an independently scheduled host. Pools add
   queue/deadline/accounting and reset hazards; batch size affects responsiveness.
   Termination must be awaited with late replies discarded and no silent retry.
   Node documents asynchronous termination, not a hard-real-time deadline [N2].
   Resource limits exclude external buffers and are not process-wide OOM/RSS
   confinement [N3]. No workers were implemented or tested in this cohort.
2. **Bounded byte-matcher reuse**, conditionally strongest for a separately
   specified grep C-byte/POSIX-oriented profile. It reuses zero-dependency source
   and deterministic step/state accounting but must resolve every table gap,
   lower pattern/repetition limits, diagnostics, captures and output selection.
   It could move grep toward POSIX selection while changing current observable
   JS behavior; that is an explicit compatibility decision, not a transparent
   safety patch. Rg needs a Unicode-aware solution, preservation of byte offsets
   and invalid-byte boundaries, and different syntax/word semantics. No broad
   shared-engine migration or global API decision is justified here.
3. **Cooperative checks and quotas only as adjuncts.** They can bound records,
   buffers and interpreted work, but a signal/Promise.race on the same thread
   cannot independently schedule its callback while synchronous JS is occupied
   [N1, V1]. Tightening length or rejecting all valid nested forms is not a
   demonstrated remedy and would silently reduce accepted utility semantics.

An external dependency/native/WASM engine is outside the requested implementation
scope and zero-runtime-dependency preference. Experimental V8 engine switches
are not a library-level guarantee: the cited historical article excludes
backreferences, lookaround, some large finite repetitions and `u`/`i` flags
from its described fallback [V1]. It does not establish this runtime's enabled
flags, current fallback coverage or performance; no fallback probe was run.

## Primary documentation verified via web

Reviewed August 27, 2026 UTC. These are documentation facts, not native oracle
executions. Successful search/open results support the claims below; some
batch URLs supplied no useful result and later find calls reported invalid
reference IDs. No failed fetch is treated as a successfully verified page.
Moving documentation can differ from measured Node 22.22.2; version scope is
explicit. No full docs snapshot or hash of remote pages is claimed.

- **N1 — Node timers:** <https://nodejs.org/api/timers.html#settimeoutcallback-delay-args>.
  The returned moving page identified Node 26.8.1. Timer callback timing/order
  is not guaranteed; delay is not a synchronous-regex preemption mechanism.
- **N2 — Node worker termination, version-pinned 22.19.0:**
  <https://nodejs.org/download/release/v22.19.0/docs/api/worker_threads.html#workerterminate>.
  Termination is asynchronous and its promise resolves on worker exit; it aims
  to stop execution promptly rather than promise a fixed real-time bound.
- **N3 — Node worker resource limits:**
  <https://nodejs.org/download/release/latest/docs/api/worker_threads.html#new-workerfilename-options>.
  Search result identified 26.5.0. Limits constrain the JS engine, not external
  ArrayBuffers; global OOM can still abort the process.
- **N4 — Node synchronous hooks, version-pinned 22.18.0:**
  <https://nodejs.org/download/release/v22.18.0/docs/api/module.html#synchronous-hooks-accepted-by-moduleregisterhooks>.
  `registerHooks` was added in 22.15; hooks run in the loading thread/realm,
  unlike the asynchronous loader-hook mechanism. This informed the static
  allowlisted native-type-stripping harness, not a general sandbox claim.
- **V1 — V8, January 11, 2021:**
  <https://v8.dev/blog/non-backtracking-regexp>.
  Describes backtracking costs, an experimental non-backtracking engine and
  limited fallback eligibility; documents ordered alternatives. Historical
  engine design guidance is not a current Node feature/default certification.
- **G1 — GNU grep 3.12 manual:**
  <https://www.gnu.org/s/grep/manual/html_node/Regular-Expressions.html> and
  <https://www.gnu.org/software/grep/manual/html_node/Basic-vs-Extended.html>.
  GNU BRE/ERE are different notations for the same matching functionality;
  PCRE is a distinct profile. This does not certify the local JS translation.
- **S1 — GNU sed manual, regex sections:**
  <https://www.gnu.org/software/sed/manual/sed.html>.
  BRE is default, `-E` enables ERE, several operators change escaping; the
  manual describes earliest/longest matching. Existing pinned GNU/BSD policy
  evidence remains immutable and is not replaced by this documentation.
- **A1 — GNU awk, How Much Text Matches?:**
  <https://www.gnu.org/s/gawk/manual/html_node/Leftmost-Longest.html>.
  Documents leftmost-longest selection and its relevance to replacements and
  splitting; not exhaustive parity evidence for local capture rules.
- **R1 — ripgrep maintainer FAQ, moving master:**
  <https://github.com/BurntSushi/ripgrep/blob/master/FAQ.md#how-do-i-use-lookaround-andor-backreferences>.
  Default finite-state engine excludes lookaround/backreferences; optional
  PCRE2 changes the feature/execution profile. Upstream complexity claims do
  not transfer to this repository's differently documented JS-backed rg.
