# Independent rg stress verification

Verified on 2026-08-26 with native ripgrep 15.2.0 (e89fff89ac), Node 22.22.2.
The transferred baseline was 107 passing tests, including 86 native fixture
comparisons. Source exports remain `searchCommands()` / `createSearchCommands()`.
No contracts, shell, registry, jq, or other command implementation is owned here.

## Reproduction and recorded results

```sh
node --import tsx --test 'tests/commands/search/**/*.test.ts' 'tests/commands/search-stress/**/*.test.ts'
npm run typecheck
npm run build
git diff --check -- src/commands/search tests/commands/search tests/commands/search-stress
```

- Focused suites: **631/631 pass**, no skipped or cancelled tests.
- New strict native comparisons: **505** (486 deterministic command cases,
  10 Bash/rg versus virtual-shell pipelines, 9 minimized review cases).
  Including the baseline's 86 comparisons gives **591** equality comparisons.
- JSON comparisons replace only `elapsed` / `elapsed_total` values, preserving
  object member order and every other field. Non-JSON output is byte-exact.
- The safety wrapper separately runs **10 isolated tests**, including three
  native closed-stdout repetitions. Four additional tests deliberately record
  non-parity: three unsupported Rust regex syntaxes and one catastrophic-regex
  probe killed by the external harness, not by the library.
- Ten repetitions with `--unhandled-rejections=strict` pass: **100 isolated
  tests**, including **30 native EPIPE runs**.
- Build passes. Final whole-repository typecheck reports only foreign errors at
  `tests/commands/diff-patch-stress/compatibility/helpers.ts:58` and `:59`
  (byte-sink callbacks return `void`, not `Promise<void>`). No owned errors.

The native command timeout is three seconds; virtual batches are killable Node
children with ten-second deadlines and 16 MiB capture limits. The catastrophic
probe has a one-second SIGKILL deadline. Isolated safety checks have a five-second
outer deadline. Fixtures are deterministic, use a seeded content matrix, and
native temporary trees live in this owned subtree and are removed after each
probe. The native Bash wrapper retains fixture-parent ignore rules for explicit
subdirectory roots; direct probes disable external parent/global ignores.

## Fixed defects

- Empty only-matching output and literal-empty byte offsets, including UTF-8,
  malformed input, and unterminated records; match-count limits remain enforced.
- CRLF only-matching terminators; explicit line-number precedence; columns on
  real matches rather than selected/nonselected status alone.
- Inverted JSON context submatches; quiet JSON summary/statistics; max-count
  after-context classification, statistics, and fixed window length.
- Native JSON summary member ordering after timing-only normalization.
- Positive directory globs no longer implicitly select descendants; reopening
  ignored directories does not rescue excluded or hidden children.
- Literal unmatched brackets in ignore files retain following rules; nested
  repositories reset inherited VCS ignore rules.
- Followed cycles report native-style diagnostics before ignore filtering and
  do not prevent searches of later siblings.
- Malformed UTF-8 no longer falsely matches replacement characters or consuming
  regex atoms. Matching fragments preserve whole-record anchor meaning.
- The reviewed binary/context no-match case and fragmented-input lost warning.
- Stdout EPIPE stops traversal successfully, without diagnostics or later writes;
  cancellation wins races, and uncooperative iterator cleanup cannot hold EPIPE.
- Legacy auto-input empty chunks yield to cancellation rather than starving it.

The fragmented warning regression keeps the review's original **single-write
native** expectation unchanged. The virtual side receives one-byte chunks. This
is evidence for that delivery comparison only, not matched scheduling or global
chunk parity. Initial binary-aware output staging is bounded at a 64 KiB
input/output threshold; later NUL discovery cannot retract flushed bytes. Native
reader/mmap heuristics and other scheduling patterns remain a comparison gap.

## Upstream stdin metadata blocker

The inspected contract still has no `stdinIsDefault` field. The proposed
addition is `readonly stdinIsDefault?: boolean` on **both** `CommandContext` and
`CommandInvokeOptions`: true means the implicit no-input default, false means
connected/supplied/redirected/closed input, omitted means legacy/unknown. Reading
or exhausting a stream must not change the metadata. Shell descriptors, exec,
pipelines, nested invoke, and transparent core forwarders must propagate it.

Once the actual contract lands, auto-selection must use metadata without reading
stdin: false selects stdin, true/unknown selects cwd. Explicit operands,
configured defaults, `--files`, and pattern-stdin precedence remain intact.
Legacy callers relying on inferred nonempty input will need metadata or an
explicit input mode. Simultaneous pattern/data stdin (`-f - -`) needs its own
native error regression during that integration.

Four independently executed native/virtual acceptance probes remain **failing**:

| Input origin, with `match.txt = "foo\n"` and `empty = ""` | Native | Current virtual |
| --- | --- | --- |
| `printf '' \| rg foo` | status 1, empty output | status 0, `match.txt:foo\n` |
| `rg foo < empty` | status 1, empty output | status 0, `match.txt:foo\n` |
| Empty heredoc into `rg foo` | status 1, empty output | status 0, `match.txt:foo\n` |
| `Shell.exec("rg foo", {stdin: ""})` | status 1, empty output | status 0, `match.txt:foo\n` |

These are genuine unmet acceptance requirements, not parity passes, and explicit
`-` is not the final fix. The optional field was not invented in search code, and
no upstream files were edited. Passing focused tests must not be read as passing
these four integration checks. JavaScript/Rust regex differences, nonliteral
zero-width edge cases, and lack of hard in-process regex preemption also remain;
this work does not establish general rg parity or superiority to just-bash.
