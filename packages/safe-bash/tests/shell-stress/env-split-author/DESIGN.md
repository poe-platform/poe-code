# Env split preparation — no product implementation

2026-08-27. The current-facts handoff was published first at
`/tmp/safe-bash-env-split-current-facts.txt` and is preserved as `CURRENT_FACTS.txt`.
This directory contains author preparation only. No different verifier's new
holdouts/consumer cases were inspected. This author changed no product files,
shared APIs, root barrels, dependencies, creation modes or lifecycle behavior.

## Concurrent-source qualification

The initial facts are a point-in-time observation at HEAD323d480. Both author
baseline attempts guarded runtime5589f60a and env1d084ab2 before/after, but already
used command-contract9c2f8ecf from concurrent commit07acb1a. They are live selected-
input observations, not a checkout of the archived6e3e316 integration. The initial
facts' command-contract1ec2f290 therefore describes the earlier observation only.

After the captures, foreign edits appeared in runtime.ts, shell.ts and new
cleanup.ts. The seal's source observation at HEADc63eedc recorded runtimef8339cd8;
this is NOT the imported baseline runtime or a stable new acceptance candidate.
HEAD subsequently advanced to b7ae676. These files remain untouched by this
author, and no rerun attempts to chase their changing state. Root must serialize
and re-read the current runtime before authorizing implementation. Design line
anchors below refer to the inspected5589f60a runtime; the env implementation is
still1d084ab2. This preparation does not assess the concurrent cleanup work.

## Exact proposed write scope

After root coordinates and grants implementation:

- `src/commands/execution.ts`: **only the existing env definition**, currently
  lines49–88. Preserve unrelated execution commands and directExecutor.
- New adjacent private `src/commands/env-split.ts`: finite-state split parser,
  bounded option reinsertion, and shared env-only invocation planning extracted
  from the existing env body as necessary. No root export or dependency.
- `src/shell/runtime.ts`: env-shebang planning and existing interpreter/file
  entry seams only. A private prepared-source parameter may be needed to reuse
  the already validated/charged script without applying its header twice.
- Author-only tests/docs in this directory or new `tests/shell/env-split-*`.

No edit is proposed to shared `src/commands/internal.ts`, contracts, command/root
barrels, manifests, parser grammar, FS or Plato's `src/commands/time-env/`.
Current env code resides in execution.ts, not a core/ directory. Its existing
`context.invoke` with `replaceEnv:true` stays the actual core execution route;
the callback fallback stays available. No fake command wrapper or string eval.

## Frozen native profiles and raw evidence

Primary GNU env is already installed (no download/install):
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-byte-gnu.0SnJMX/coreutils-9.7/src/env`

- Actual `env (GNU coreutils) 9.7`, binary SHA256
  `1026eb36ffd2fdca6d064c0ffd6dd99ceb7bb3f49ec5e804df2c53bef372dbf0`.
- Mach-O arm64 on Darwin25.4.0, linked to `/usr/lib/libSystem.B.dylib`, **not
  GNU/Linux/glibc**. Pinned sibling `src/env.c` SHA256
  `ed606a062de3f107cd3cb9e1e73c7215272e2a8c7ad6f362aa14e0f6d390a032`.
- Historical comparison is Apple's `/usr/bin/env`, SHA256
  `9eb7c5aed7f3c7fe07b77d9a84d0a7c6a8c68c17a15aa3dace0d8ff02d352776`.
  Its unsupported --version response is retained, not labeled GNU9.7.
- Shell protocol controls use the actual pinned GNU5.3 and Apple3.2 binaries,
  with versions/hashes and empty-environment child-role witnesses recorded.

`native-frozen.json` contains 45 unchanged core argv cases through EACH env
binary (90 observations); eight one-optional-argument protocol cases with EACH
actual Bash child profile (16); and four actual Darwin-kernel cases with EACH
Bash parent (8). Each layer uses one consistent protocol, not per-case oracles.
The primary/historical env captures differ in20/45 raw tuples; no error text,
status, environment ordering or argument bytes are normalized.

Core controls use a compiled, non-interpreting `recorder.c` reporting exact argv
and selected explicitly seeded exported variables. All90 marker witnesses are
absent, including metacharacter/command-substitution injection strings. Capture
has3-second process-group deadlines,256KiB output bounds, scrubbed C environment,
unique `/tmp` directories, and120/122 group-absence checks in the two attempts.
Scratch trees were removed only after captures; no archive/build is under tests.

### Transparent first-attempt correction

The first whole capture is retained in `native-attempt1.json` with
`cases-attempt1.mjs`; it is NOT the selected primary freeze. Three recorder cases
cleared PATH with -i/lone '-' then could not find the recorder. Additionally its
GNU5.3-labelled empty-environment protocol did not preserve the selected Bash
PATH, so its child role was not5.3; that row must not be treated as5.3-child proof.
The corrected fixtures explicitly restore `PATH=${PATH}` from the incoming env,
then the ENTIRE two-env/coherent-protocol cohorts were recaptured. The recorded
empty-environment role probes now print5.3.0(1)-release and3.2.57(1)-release.
This author changed no product source between attempts; inspected runtime/env
hashes stayed stable within both baseline runs. No per-case native retry was
substituted into the original artifacts.

`baseline-frozen.json` captures the real current Shell+agentCommands env route,
not a stub invoker, against all45 core inputs and8 VFS protocol inputs. The core
has43 unsupported-option status2 results and2 status127 results: exact raw
agreement0/45 with either env profile. This is not45 independent bugs; it includes
non-S diagnostics and intentionally unsupported policy rows. All eight current
VFS env-S/no-S-multiword forms refuse126. Selected before/after source hashes agree;
actual imported runtime resolves to `.ts`. First-attempt baseline also retained.

## GNU grammar to implement, not shell grammar

The official GNU manual currently labels itself9.11; the native target here is
the inspected9.7 source/binary. Relevant source: `src/env.c:196` scan_varname,
`:350` build_argv, `:498` parse_split_string, `:779` getopt loop and `:839`
environment changes. Official manual:
`https://www.gnu.org/software/coreutils/manual/html_node/env-invocation.html`.

- Split unquoted ASCII space, tab, LF, CR, VT, FF only; not generic Unicode `\s`.
  Single/double quotes concatenate pieces and create empty arguments. Maintain
  an explicit active-argument bit separate from accumulated text length.
- Outside single quotes, support documented `\f \n \r \t \v \# \$ \' \" \\`.
  Single quotes recognize only escaped single quote/backslash; other backslashes
  remain literal. `\_` separates outside quotes and inserts a space in double
  quotes. Escaped ordinary space is an **error**, unlike shell backslash-space.
- Unquoted `\c` stops THIS split string, not existing trailing argv. In double
  quotes it is an error; single-quoted `\c` is literal. `#` comments only when no
  argument has started: `''#x` is literal. Existing remaining argv survive comments.
- Only `${[A-Za-z_][A-Za-z_0-9]*}` expands, outside single quotes. Bare `$`, shell
  special variables, `${V:-default}` and `$()` are errors, not shell evaluation.
  Replacement bytes are appended literally, never re-tokenized or recursively
  expanded: spaces, quotes, backslashes and `${...}` inside a value stay data.
- Lookup uses the env command's ORIGINAL incoming `context.env`, before -i,
  -u and assignments. It must never read `process.env` or private shell locals.
  GNU distinguishes an absent unquoted variable (no argument) from a present
  empty variable (creates an empty argument); quotes always create an argument.
- Accept `-S STRING`, attached `-SSTRING`, `--split-string STRING` and
  `--split-string=STRING`, including existing supported short flags before S
  (e.g. -iS). S consumes the remainder of its short-option token as its value.
  Reinsert parsed tokens before unconsumed argv and resume OPTION parsing with
  previously accumulated options retained. Stop at --, lone '-' or first operand;
  -S after a command or assignment is literal, not expanded. Existing option
  arguments (e.g. -u's name) must not themselves be scanned as S switches.
- Finite nested/repeated S is supported by an iterative work queue, not recursive
  JS calls. Each explicit S parse uses the original env snapshot. A cycle or
  repeatedly multiplying value must exhaust a single bounded work allowance.

No -v/--debug, -a/--argv0, native signal options or unadvertised long-option
abbreviations are proposed. Existing supported i/u/0/C options remain. Existing
empty environment-name/NUL refusal is not silently relaxed. Error suffixes are
captured exactly: invalid expansions identify the unconsumed `$...` suffix;
invalid escapes/quotes return125 in GNU env, rather than inventing shell offsets.

## Bounded work and invocation state

Proposed private per-env limits:128KiB cumulative split input/output UTF8,
10,000 generated arguments,32 explicit S expansions, and1MiB cumulative scanning
work. Check bounds before appending/copying; account environment replacement
bytes, not just original source. Use segments/chunks and one final join to avoid
quadratic string rebuilding, with signal checks per bounded chunk and periodic
event-loop yields for cancellation. These are explicit virtual safety limits,
not native maxima. Do not create a new Shell/Budget or reset existing counters.

Shell-private callers can supply tighter existing expansion bounds/fail hooks.
Standalone core env has no public Shell-budget field: retain its own finite
helper cap, and let its actual context.invoke enforce the existing shared command,
depth/expansion/output limits on generated literal argv before child execution.
No new contract is needed merely to expose a budget. Signal identity, stdin
cursor/origin, cwd/env copies, middleware and sink ownership continue unchanged.
No stdin reads or external sink effects occur while splitting/options validate.

The shared env planner should prepare copied exported env, ordered names,
unapplied/validated cwd and literal child argv. Core env keeps its existing
invocation/fallback and environment output behavior. Do not reverse environment
order to match Apple's profile or promote retained private variables.

## Shebang boundary requiring root coordination

No-S remainder stays ONE literal optional argument. In particular `bash -e`
must remain allowlist refusal126, not whitespace-split to win the frozen Darwin
row. Only S requests splitting. `-S bash -e` and `--split-string=bash -e` work as
one argv; a single `--split-string bash -e` argument is **not** equivalent and
GNU rejects it125. Actual Darwin kernel splitting has separately recorded losses
for quoting/variable expansion and must not replace this fixed virtual protocol.

Use the common env planner for recognized /usr/bin/env headers, then preserve
the FULL resulting interpreter argv with original script argument appended after
it. The frozen quote-argument control demonstrates that a preexisting operand
becomes Bash's script filename, not an extra $1 of the original file. The -C sub
control opens `sub/script` and prints `relocated`; reusing the original body
unconditionally would be wrong. Helpers may not force the original target to win.

Proposed runtime seam: a private already-validated/charged source object may be
reused only when the resulting interpreter selects that same bound VFS input;
otherwise existing VFS permission/path/symlink checks load the actual target.
Parse under the resulting child environment/locale, not the pre-env locale.
Never apply the original env header a second time when Bash opens its file, or
cache solely by an arbitrary string while ignoring cwd/target changes. Keep
process isolation and shared budgets; no public filesystem/identity extension.

Root needs to confirm these precise boundaries before source writes:
1. Env-specific shared planner/splitter in the new adjacent module, consumed by
   the existing core env body and runtime fixed env-shebang binding, not a shared
   generic options change or arbitrary host/env registry execution.
2. Preserve the existing recognized virtual Bash/sh target allowlist and override
   refusal126. Prior shebang -c/-s restrictions stay explicit until root authorizes
   broader interpreter-entry forms; the native explicit-c control is a captured
   capability boundary, not permission to generate/eval source in the splitter.
   Full argv/changed-target semantics cannot be silently replaced by positional
   argument shortcuts. The private source-reuse seam must avoid double header
   application and unjustified source-budget resets.
3. Split-specific syntax errors should be125 with an env diagnostic using a typed
   private error, without changing shared UsageError/define (currently usage2).
   Existing non-S env usage2 behavior remains unless root explicitly broadens the
   env-only status migration. Unsupported generated env options need an explicit
   documented outcome, never silent acceptance or a global status waiver.

## Next implementation/verification, only after that relay

Reuse these whole frozen GNU goldens. Add actual public-plugin/VFS script tests,
literal argv/empty values, -i/-u/export/private-local timing, env-C/explicit PWD,
parent isolation, piped binary/default stdin, middleware and shared limits;
hard-bounded cyclic S/growth/cancellation/late-rejection host controls. Preserve
initial raw failures and historical differences. A separate verifier owns hidden
complex quote/injection and consumer tests; do not inspect those beforehand.

No old kernel/fullgate rerun now, no compilation/emission needed for this
source-free preparation. The later explicit Bash-c parameter-error status127/1
investigation, creation masks, traps, inherit_errexit and five first-read cases
remain untouched and separate. This is not full Bash or parity acceptance.

Repro with fresh `/tmp` output names:

```sh
node tests/shell-stress/env-split-author/capture.mjs /tmp/env-split-native-new.json
node --import tsx tests/shell-stress/env-split-author/baseline.mjs /tmp/env-split-baseline-new.json
```

Uses existing Node22.22.2/tsx and system cc; no downloaded runtime dependency.
Native scripts and binaries exist only in verified owned temporary trees, which
are removed. STOP before product writes; root coordinates the next lease.
