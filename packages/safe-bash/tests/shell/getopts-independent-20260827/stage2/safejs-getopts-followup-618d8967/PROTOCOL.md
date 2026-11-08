# Bounded SafeJS getopts followup — August 27, 2026

Exactly two real guest probes; no full25 replay or native cohort. Candidate
618d8967009117547ab476256bc6eb0a9463309a and accepted independent evidence
2dcefd4f26588f6dc662148e3713e41b09537333 remain authoritative. This is a
NONBLOCKING component followup, not a new acceptance or runtime authorization.

Chronology: the existing component, public bridge implementation, original guest,
real engine entry/hooks, original loader/private guard and prior reports were
inspected before writing these tests. This is NOT a preimplementation freeze.
Preparation authenticates and copies dependencies without running product/engine.
Commit FREEZE.json and all executable inputs BEFORE starting either guest.

The inspected existing guest API is `import * as shell from "shell"` followed by
`await shell.exec(sourceString, {cwd?, env?, stdin?})`. It returns string stdout,
string stderr and exitCode. There is no argv or guest cleanup/child ownership API.
The same existing explicit host injection as the accepted surface04 uses
makeSafeJsShellModule, read-side-effect and actual declareHostOperation, with a
host-owned separate Shell executor. No guest capability is added. Each exec has
fresh shell state; shell subshell syntax tests cloned child scan state. A second
exec tests fresh sibling state. Parent command locals are checked around SafeJS;
they are not claimed to be inherited by the separately configured bridge Shell.

G1 asserts the clustered `-ab`/required Unicode argument loop, successful statuses,
termination status, OPTARG presence/removal, OPTIND and unchanged positional args.
G2 asserts fresh unexported OPTIND/OPTERR, subshell scan-state isolation, parent
continuation and fresh sibling exec. Guest assertions must finish inside actual
run; host duplicates completion/trace checks. Outer parent locals/args must survive.
Expected builtin counts: G1=4, G2=5. Expected bridge calls: G1=1, G2=2.
Strongreadonly/ASCII/N04/Bash5.3 policy remains unchanged; readonly/N04 and explicit
non-ASCII-option refusal are not newly tested. Unicode argument success is in G1.

The original hash/allowlist loader and private guard are copied unchanged. The
binding helper changes only its broad /private/tmp prefix to the exact owned
regular root, as already approved for this location. A second test-only loader
adds one read-only callback at the actual compiled Runtime.getoptsBuiltin entry
in memory, after the original loader authenticates disk bytes. Original and
transformed hashes, needle cardinality, source state and active guest-script hash
are recorded. No product bytes on disk change. This witness is not a guest module.

The original private HEAD/tree/index/status/staged/metadata and264 eligible-file
profile must match exactly before and after. Additional eligible path-shape checks
include empty directory/new-entry changes; original excluded cache/build/module
directories remain excluded, not claimed fully guarded. Real source regular copies
only; no private source committed. Source/package/compiler/loader/driver inventories
are append-aware. Reuse the sealed candidate archive and actual full npm tarball;
install offline with scripts disabled. No build or live product overlay.

Two sequential children: 256MiB old-space heap, strict unhandled rejection,
20-second watchdog, 256KiB process-output bound, existing SafeJS bounded budgets
and shell command/output/loop limits. Natural close is required; killed children
or loader errors are infrastructure nonpasses, not tested product outcomes.
Stop after first nonpass; retain attempts without rescuing/relabeling them.

Older phase/stage/policy/review membership is authenticated against the accepted
evidence Git tree with ONLY this explicitly authorized new sibling excluded.
Old seals are never rewritten. Own freeze and later evidence memberships are
separate. Capture hash/import evidence only, then remove only the enumerated,
manifest-authenticated .scratch tree after all children close.
