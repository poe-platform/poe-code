# Read / execution chronology and auxiliary invocation record

All times are UTC on 2026-08-27. Exact shell tool outputs also remain in the
session transcript. This document distinguishes reads/hashing from execution.

| Time/order | Activity / exposure |
| --- | --- |
| Before 19:04:11 | User instructions, parent/root AGENTS, Git root/status; first shell command fails as recorded below. No implementation read or run. |
| 19:04:11 through freeze | Immutable README 1–149; evidence handoff 1–122; selected index declaration lines 7/9/50/54 and options interfaces 1–20 only. Candidate and supplemental/evidence Git objects resolve. Handoff development summaries exposed, test bodies unexposed. |
| 19:06:39 | Three-file post-commit freeze committed as e761af2ed973e07b9b8cf09aae68ccbfbd475ca1; SHA printed immediately. |
| 19:06:52 | FIRST implementation read: exact index body 1–60, public CommandContext/registry, package/config/root export declarations. |
| After 19:06:52 | Exact parser 1–180, renderer 1–189, entities 1–54, budget 1–83, input 1–102, options 1–67. Truncated multi-file outputs recovered using narrower reads. README bounds reread. |
| After source read | Public io.ts read/write/cancellation, plugin.ts middleware types/body, shell public types/entry methods, memory VFS entry/constructor/read signatures; dependency closure materialized by immutable Git reads without private checkout access. |
| Before setup | Supplemental tsconfig.build, verify-compiled first 55 lines, comparison driver first 110 lines; evidence verifier and metadata schema. These are post-freeze exposures, not independent expectations. |
| Setup and execution | Exact times/commands/status/stdout/stderr are in capture state and per-phase receipts. 34-source closure build, actual offline pack/install, move, poisoned-source sentinel, filesystem-denied installed execution. |
| After frozen execution | Source-backed fixture corrections created separately; candidate limits.test first 100 lines and io.test test-name/cleanup lines inspected. No full author suite or mutants rerun. Two source-regex suspicions independently reproduced, then semantic followups and native ASTs. |
| By 19:16:36 | All 16 baseline rows rerun with installed module and authenticated Pandoc; semantic output inspected. |
| 19:18:46 and after | Supplemental protocols, report, comparative classification, authenticity/freeze verification and seal. No product repair or later-candidate substitution. |

Some pre-final hash scans read complete immutable files solely to authenticate
bytes. They are not claims of substantive inspection of every author test or the
entire host closure. Detailed author aggregate outcomes remain author evidence.

## Auxiliary failures preserved verbatim

The initial shell command used `for path in ...` in zsh, overwriting special PATH.
Tool exit: 127. Relevant complete returned output:

```text
/Users/kjopek/Workspace/safe-bash
/Users/kjopek/Workspace/safe-bash
?? tests/commands/diff-patch-stress/fuzz/.native-bvNFwI/
?? tests/commands/search-stress/.native-1m4O1e/
?? tests/integration/safejs-owned-output-prototype-review/zero-cap-overlay/independent/replay-v3/capture.py
?? tests/shell/getopts/
# Orchestrator Policy

- The root agent delegates all substantive work to subagents.
- The root agent only coordinates subagents and synthesizes their results for the user.
- Subagents perform all implementation, investigation, and verification.
- User statements are authoritative. Preserve every instruction and fact without expanding, reinterpreting, or inventing. Record durable context here concisely when appropriate.

--- AGENTS.md ---
zsh:1: command not found: cat
zsh:1: command not found: date
zsh:1: command not found: git
zsh:1: command not found: git
```

The corrected read-only command used `file`; no write or implementation exposure
occurred in the failed command. A later speculative `git show` of a nonexistent
public contract path emitted:

```text
fatal: path 'src/contracts/middleware.ts' does not exist in '2272feb'
```

The actual public middleware contract is `src/contracts/plugin.ts`, subsequently
read and used for the v2 correction. A speculative supplemental filename read
emitted:

```text
fatal: path 'tests/commands/html-to-markdown/companion.test.ts' does not exist in '21ca7b8c'
```

The actual file inventory was then read; no invented test was executed. In both
cases the containing grouped shell invocation returned 0 because later read-only
commands succeeded; the failed git subcommand's stderr is retained, not hidden as
a successful file read. No build/pack/install setup invocation failed.

The first frozen progress stream was briefly redirected to
`/tmp/html-independent-frozen-progress.log`, rather than the unique scratch
directory. This was a reviewer path-policy mistake, not product behavior. The
complete log is preserved in the evidence bundle and that scratch log is removed
at finalization. All product build/install/execution/artifact directories were
unique, owned external scratch; all repository writes stayed in the assigned new
directory. Later invocations use the captured per-phase receipt paths directly.

The supervisor busy-loop control prints an initial generic `FAIL` because its
child is killed; the receipt then explicitly classifies this **expected timeout**
as PASS only after asserting SIGKILL and process-group absence. Product timeouts
remain FAIL. No frozen expected value or failed raw output was changed.
