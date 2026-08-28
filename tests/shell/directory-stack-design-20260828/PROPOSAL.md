# Proposal only: genuine directory-stack builtins

No implementation authorization or production edits. This proposal follows the
sealed observations in `REPORT.md`, not assumed zsh/FreeBSD behavior.

## Intended profile and exact write set

Target the observed GNU Bash **5.3.0 Darwin** common profile: `pushd`, `popd`,
`dirs`, virtual cwd/HOME, signed indexes, `-n`, `dirs -c -l -p -v`, literal
operands and `--`. These are real shell builtins, discoverable by `type` and
`command`, subject to normal function shadowing. No registry plugin, command
count increase, new Shell, host cwd/env lookup, native subprocess, or eval.

Proposed implementation write set, **pending root approval**:

- NEW `src/shell/directory-stack.ts`: private bounded argument parser,
  transition planning, cloning and streaming display primitives.
- `src/shell/runtime.ts`: builtin discovery/dispatch, State field/clone/fresh
  interpreter initializer, shared checked cd helper and precise middleware cwd
  restoration bookkeeping. Preserve getopts and cancellation/owned-output code.
- `src/shell/shell.ts`: initialize an empty remembered stack for each exec.
- NEW `tests/shell/directory-stack/**`: helper/runtime/host controls and docs.
  Keep this precode evidence immutable; version additions separately.

No public contracts, limits, exports, manifest, parser, expansion grammar or
command plugin edits are proposed. `DIRSTACK` array reads/writes/unset semantics,
`~+`, `~-`, `~N`, `~+N`, `~-N` expansion, completion, `cdspell`/`dirspell`, `cd -P`
improvements and arbitrary shell-option parity are **additional/deferred scope**.
D32 records their native existence and virtual parser dependency, not support.

## Representation and state ownership

Store only remembered entries, in display order, not a duplicate current cwd:
`DirectoryStackState { readonly entries: readonly string[]; readonly bytes: number }`.
The displayed full stack is `[state.cwd, ...entries]`. Current cwd is authoritative,
not user-supplied `$PWD`. A plain `cd` therefore updates the visible top without
touching remembered entries. `dirs -c` empties entries but keeps current cwd.
The byte count is checked logical UTF-8 storage accounting, not memory/RSS.

`-n dir` stores the supplied string **without resolving, statting or checking
existence**. Relative remembered entries remain relative until later selected
for a real cd. Ordinary successful pushes save the prior logical cwd. Unicode,
spaces and newlines in path values are data; this is not a quoting renderer.

Fresh `Shell.exec` and fresh interpreted `bash`/`sh` processes start empty.
`cloneState` deep-copies the entries for pipelines, subshells, command substitution
and host `context.invoke`; clones share neither an editable tail nor accounting.
Functions, sourced files and brace groups use their current shell's state. Local
variable restoration does not implicitly restore the stack. Separate exec calls
on one Shell retain the existing fresh-state behavior.

Invoke's explicit cwd replaces only the child's implicit top; the tail is cloned.
Merge/replace env maps cannot synthesize or mutate hidden stack state. A new
interpreter process resets the stack; an intermediate shebang forwarding clone
must preserve it until that process boundary, following existing state ownership.
Neither sibling completion nor cancellation can write back to the parent.

## Native transition facts to implement deliberately

Use full display indexes: +N counts left from zero; -N counts right from zero.
Reject out-of-range indexes without mutation. Checked decimal parsing must not
wrap overflow. Leading zeros are accepted; malformed/overflow numbers are usage
errors. The observation set does not justify arbitrary-width native integer parity.

- `pushd dir`: run checked cd; only after success prepend old cwd to the tail.
  An ordinary missing/file target leaves stack/cwd unchanged.
- `pushd` swap and indexed rotation: plan/reorder the tail **before** attempting
  cd to the selected top. Failed cd retains the reordered tail with the old cwd
  still the implicit top. S02 proves this is not a transactional operation.
- `pushd -n dir`: prepend raw dir without cd and display the stack.
- `pushd -n` with no operand: observed no-op, status 0, **no automatic display**.
- `pushd -n +/-N`: rotate as if a new top was selected, but retain old cwd as
  the actual top, thereby dropping the selected entry from the tail. No automatic
  display. S01 preserves the exact resulting sequences, including duplicate cwd.
- `popd`/`popd +0` without `-n`: cd to first remembered entry, then remove it only
  on successful cd. Failed cd leaves the tail intact (unlike failed push rotation).
- Non-top pop removes that tail entry without cd. `popd -n +0` and `+1` both
  remove the first remembered entry; higher full-stack indexes remove their
  corresponding tail entry. Bounds still use the displayed stack. Successful
  pops display the resulting stack, including `-n`.
- `pushd +0` on a singleton succeeds and displays cwd; empty no-argument swap
  and pop fail. `dirs +/-0` on a singleton succeeds; a missing nonzero index fails.

Do not implement a generic "mutate then rollback on any error" helper. Plan
separate publication points: before-cd tail, checked cd, after-success tail,
then output. Cancellation/limits/sink failure stop subsequent steps but cannot
undo already-published state or external provider effects.

## Display and parsing profile

Default output uses spaces between entries and a final newline. `-l` preserves
full strings; otherwise abbreviate a matching **virtual HOME component prefix**
with `~`, not an arbitrary string prefix or host home directory. D21 proves a
sibling `home-suffix` is not abbreviated, and empty/unset/trailing-slash HOME
does not justify normalizing the variable into a different value.
`-p` uses one entry per line; `-v` uses Bash's index prefix (` 0  ...` for the
small observed indexes) and dominates `-p` regardless of separate flag order.
Full large-index padding needs a bounded helper test, not a claim from these rows.

**Pinned Bash rejects bundled `dirs -lp`, `-pv`, `-lpv`, `-ll` with status 2.**
The manual's compact synopsis does not establish bundled-option acceptance.
Accept separate `-l -p -v`; do not silently rescore the original invalid probes.
`dirs -- +1` in S01 displays the full stack rather than selecting index1;
multiple dirs selectors use the last observed selector. `dirs -c +9` clears
successfully without checking that otherwise invalid index. `pushd` extra
operands fail with status1; the observed popd extra-selector case succeeds.
Preserve these selected rules or obtain explicit root approval for stricter
grammar; avoid generic option-parser assumptions. Literal `-- -dash` and
`-- +1` directory operands are positively observed.

## Current code seams and failure ordering

Inspected source hashes are in `FREEZE.json` (unchanged through execution):

- `runtime.ts:39`: builtin name/discovery sets; `:169` State; `:278` cloneState.
- `runtime.ts:677`: checked writeVariable rejects readonly before assignment.
- `runtime.ts:870`: one normal Budget.tick per admitted command and the existing
  128-command scheduling yield. Do not charge every stack element as a command.
- `runtime.ts:1292` and `:1360`: middleware overlays cwd then conditionally
  restores it, with an existing name-specific exception for cd.
- `runtime.ts:1492`: fresh interpreter process state; `:1617` shebang clone;
  `:1983` invoke child clone/env merge; `:2321` substitution clone.
- `runtime.ts:2098`: current cd resolves logical path and stats directory, then
  **checked OLDPWD write → cwd assignment → checked PWD write → export flags**.
- `shell.ts:237`: fresh exec state initialization.

Readonly policy: retain current stronger fail-fast writes. Readonly OLDPWD
prevents cwd publication; readonly PWD may leave cwd changed after the earlier
OLDPWD publication. No builtin-specific removal of readonly attributes or
unchecked writes. Native D28/S03 changes cwd and PWD even though OLDPWD is
readonly and returns1: that divergence must be explicitly retained. Native
failed direct push on either readonly publication does not add a remembered
entry. Honor checked-write failure before later tail/output publications.

Middleware needs **actual cwd publication tracking**, not unconditional exemption
for all `pushd`/`popd`: `-n` must not retain a borrowed middleware cwd. Also a
successful same-path cd must not be mistaken for no cd. Proposed minimal private
dispatch callback marks the moment cwd is assigned; use that marker for these
builtins' restoration decision even if the later PWD write throws. Keep the
existing cd exception and all non-directory middleware behavior unchanged.
Nested function and invoke interactions require tests; do not globally change
cwd restoration merely by adding three names to the exemption.

## Budgets, cancellation and output — proposal requiring approval

No new public ShellLimits in this phase. Proposed private ceilings are 4096
remembered entries, 4 MiB aggregate stored UTF-8 bytes, 64 KiB per stored/resolved
path, 8 MiB display bytes per call and 8 Mi logical helper steps per invocation.
Count before allocation and use subtraction/checked safe-integer arithmetic.
These are declared logical ceilings, not aggregate JS heap or hard time bounds.
Existing argument expansion limits still apply independently. Reject a private
ceiling with a bounded command diagnostic/status1; do not reset the shared
Budget or relabel it as public maxExpansionBytes. Root may choose different
values/error policy before implementation; no such limit is implemented here.

Use a work callback every128 helper steps through existing interruptible
setImmediate and before/after checks, plus final flush. Same existing Budget,
command admission, depth and output accounting; no new Shell, global work
counter or byte-as-command charging. Long output is encoded/yielded in bounded
chunks (proposed16 KiB), awaited on the existing stdout/stderr sinks and charged
to the same global maxOutputBytes. Do not allocate a whole joined stack before
checking work/output bounds. HOME formatting must also be bounded.

Pass the actual runtime signal into VFS metadata and await interruptibly; recheck
before each later state publication. No host chdir, content reads, mutations,
provider leases or atomic permission guarantees. A noncooperative provider may
continue after outward cancellation; no forced completion claim. No automatic
retry on callback/sink/metadata failures.

Never convert an abort reason, shared limit error or output failure into a stack
usage error. Await writes and preserve the existing runtime outcome machinery:
root/local cancellation provenance and exact reasons, registered cleanup barrier,
escaping failure versus already-mapped numeric handler status, and EPIPE141.
An arbitrary thrown sink error may already be mapped by existing runtime policy;
do not invent a new public rejection guarantee. Native D34/S03 prints EBADF but
returns0 after closed-output push/pop; **do not swallow failed virtual writes to
imitate that behavior**. State already committed before output stays committed.

## Explicit decisions needed from root

1. Approve native nontransactional swap/rotation and -n peculiarities, with the
   stronger existing readonly and awaited-output policies just described.
2. Approve separate-only dirs flags/observed selector grammar, or explicitly
   request a convenience extension without calling it native Bash parity.
3. Approve private logical ceilings and status/error mapping (or authorize a
   separately reviewed public limits extension; none is silently proposed).
4. **CDPATH/execute permission dependency:** current cd does not search CDPATH
   and does not call VFS access(X_OK). D22 proves native pushd does search CDPATH
   and prints its selected directory before the stack. Recommended bounded
   follow-up within the shared cd helper: explicit virtual CDPATH components,
   existing typed directory access authority and shared limits, with focused cd
   regressions and exact error precedence. This changes existing cd behavior,
   so requires explicit approval rather than hiding it in stack implementation.
   Alternative initial profile inherits current cd and labels CDPATH/access
   gaps OPEN; it cannot claim full observed common Bash profile.

## Independent implementation acceptance to request later

Reuse unchanged original34 plus separately versioned valid-snapshot assertions;
never turn invalid original snapshots into an unchanged-input pass. Add pure
transition tests and actual Shell cases for index/parse/limit boundaries,
failed stat/access, checked readonly partial publication, path/HOME bytes,
no-cd zero VFS calls, streaming output/awaited sink rejection, abort before and
during stat/yield/write, falsy/equal reasons and registered cleanup failure.
Actual invoke sibling/cwd/env overrides must prove parent isolation; middleware
must test same-value forwarding, changed cwd, same-path successful cd and -n.
Test process reset, function sharing, all clones, type/command discovery, source
and prefix behavior; preserve getopts, owned-output and Stage2 regressions.
No private SafeJS rerun or new public registration is needed for this design.
