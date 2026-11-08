# Hidden env split-string holdout — prepared August 27, 2026

**Preparation only. Product and host controls have not run.** Source author
fixtures, proposal and new implementation were not inspected. Only committed
historical6e source was read; live selected files were hash-recorded, not reviewed
as implementation. This directory is the different-verifier freeze. Keep its
concrete cases/native expectations hidden from the author until ROOT relays the
first implementation-ready checkpoint. Handoff may disclose counts, profiles,
hashes and coverage categories, not concrete cases or oracle values.

## Profiles and counts

One consistent primary profile is actual **GNU coreutils env9.7 built on Darwin**,
not GNU/Linux and not a claim about the latest release. Its existing executable:

```text
/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-byte-gnu.0SnJMX/coreutils-9.7/src/env
SHA256 1026eb36ffd2fdca6d064c0ffd6dd99ceb7bb3f49ec5e804df2c53bef372dbf0
```

Primary shell binding uses the pinned GNU Bash5.3.0(1) executable:

```text
/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash
SHA256 8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c
```

The entire historical profile uses Apple `/usr/bin/env`, SHA256
`9eb7c5aed7f3c7fe07b77d9a84d0a7c6a8c68c17a15aa3dace0d8ff02d352776`, and
`/bin/bash`3.2.57(1), SHA256
`35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`.
Apple env does not provide GNU's version option; its actual failed version probe,
OS version, binary hash and successful Bash version probe are retained. No
per-case interpreter/oracle selection occurs. The aligned explicit search path
keeps child Bash bound to its declared profile even after clearing environment.

| Prepared / captured scope | Count |
| --- | ---: |
| Command argv cases, per complete env profile | 42 |
| Single-literal-optional-argument shebang cases, per profile | 6 |
| Actual Darwin-kernel execution of the same six scripts, per profile | 6 |
| Bounded recursive split observation, per profile | 1 |
| Shared actual-kernel versus literal-argv recorder controls | 2 |
| Future primary product cohort | 48 |
| Prepared independent host controls | 7, unrun |

Each capture therefore records108 ordinary native observations, two bounded
recursive observations and two separate kernel-argv controls:112. An initial
capture and a disclosed corrected capture are both preserved: **224 actual native
observations including controls**, not112 pretending the first run never happened.
Version/compiler/OS probes are metadata, not extra tests. Zero native statuses
are not product passes; invalid-option/error statuses are strict references.

For the aligned42 command rows, GNU statuses are30zero,9status125,1status126,
2status127; Apple statuses are28zero,11status1,1status126,2status127. Both recursive
native observations hit the250ms outer deadline and were group-killed; these are
bounded facts, not successful native-parity cases. No timeout becomes green.
Complete raw stdout/stderr, status/signal, args, stdin, environment and effects
are retained, including all nonzero observations and legacy differences.

## Independent grammar and protocol controls

The native cases exercise combined quoting/escapes, empty arguments and values,
multiple whitespace forms, comments, variable lookup and argument boundaries,
literal metacharacters, invalid dollar syntax, assignments/options, clearing and
unsetting environment, repeated splitting, bounded growth and non-executable or
missing commands. They are independently authored, not copied from author tests.
GNU's env split parser is not a shell parser: native argv and absence of injected
effects are observed rather than assuming command substitution or shell expansion.

The normative documentation consulted is the official GNU env invocation page
labelled Coreutils9.11; another official URL's search result is labelled9.9.
Neither label changes the actual9.7 executable oracle. Its local versioned
`src/env.c`, gnulib `putenv.c`, generated `stdlib.h` and manual are hashed.
The manual describes brace-delimited incoming-environment expansion before env
modifications, context-sensitive quoting/escapes and split-string parsing. Exact
bytes/statuses come from the binaries, not a hand-written interpretation.

```text
https://www.gnu.org/s/coreutils/manual/html_node/env-invocation.html
https://www.gnu.org/software/coreutils/manual/html_node/env-invocation.html
```

All command launches use actual argv arrays and argv0 `env`, scrubbed C/UTC env,
explicit native cwd/search path and binary stdin including NUL/non-UTF8. A small
compiled C recorder outputs exact argc, every argv byte, raw environ order, stdin
and cwd as hex. It does not call a shell or inspect ambient credentials/network.
The compiler is existing Apple clang21, with exact command/version/hash recorded;
the recorder binary hash is retained. No runtime dependency or install is added.

Shebang evidence has two uniformly separate routes: actual Darwin kernel exec,
and direct env invocation with **one literal optional argument**. Future virtual
shebang acceptance uses the latter consistently for all six rows, never chooses
the kernel route per case to make results green. The independent executable
recorder proves Darwin splits a spaced shebang optional string into two arguments,
while the explicit literal launch preserves one. Native non-S packed interpreter
text fails as one command name under the single-argument route; actual kernel
behavior remains different raw evidence. The old original env-single row is not
edited, rerun or coerced into a pass. No127 allowance/status rewrite is introduced.

Native shebang fixtures render the exact selected env executable path; virtual
fixtures explicitly bind `/usr/bin/env`. These fixture bodies/hashes are both
recorded rather than claiming identical interpreter-path bytes. Interpreter
scripts/compiled recorder are harness fixtures outside the effect cwd, not fake
product file effects. Actual work files, including precreated mode0644 effects,
are fully snapshotted before/after. No output/effect/mode normalization occurs.
Raw environment order is retained, not generalized to a POSIX/GNU/Linux promise;
GNU9.7's Darwin/gnulib ordering is the existing build-specific profile.

## Initial fixture correction — before product or author inspection

The first native capture used a custom recorder name after `-i` without providing
a child PATH in three command fixtures. Those three exited127 before the recorder
could observe the intended grammar/namespace behavior. One cleared-environment
script similarly lacked the pinned Bash lookup path and could resolve historical
system Bash. This was a fixture setup problem, not a product failure/fix.

The original42+6 inputs and first complete capture remain in `cases.mjs`,
`native-inputs.json`, `native-frozen.json`, `native-cleanup.json`; the exact initial
driver is preserved as `native-initial.mjs`. `aligned-cases.mjs` explicitly adds
the incoming PATH assignment in exactly those three command strings and one
script optional argument, retaining all identities and the entire denominator.
No other source/expected tuple was changed. Both complete profiles were then
captured anew, still before any product run or author inspection. The authoritative
future input/reference pair is `aligned-inputs.json` / `native-aligned.json`.
This is not called unchanged all-input proof across the correction, nor a
product-driven oracle update. The initial terminal-backslash construction was
also corrected before the first capture; neither capture uses the erroneous
empty-tail draft.

## Prepared product and host execution

`product-row.mjs` accepts a factory importing the real broad public `src/index.ts`,
uses actual `Shell`, memory FS and `agentCommands()`, and registers only a truthful
test observer command. It preserves literal command argv and byte outputs/status,
all work effects/modes, namespace and stdin provenance. Child-process methods and
fetch are trapped before loading the product and restored afterward. No host
command/network capability is granted to virtual commands. Kernel-only records
cannot silently enter this product runner.

Seven separate host controls cover real literal nested `invoke`, full replaceEnv,
exported versus local scope, parent preservation, middleware, empty/default stdin
origin, shared command/expansion/output budgets, awaited sinks, cancellation and
observed late rejection. They are **prepared, unrun**, not seven passes and not
accepted accounting/lifecycle proof. Parent execution must isolate every host
worker with a hard deadline; the deliberately pending/cyclic cases must never
run unbounded in the coordinator. No head0/custom-first-read fixture is reused.

`probe.mjs` requires an external actual-module-load policy/trace, hashes the full
archive source inventory before/after, rejects the live checkout/aliased source
root and imports its broad public index. Later acceptance must construct a FULL
committed source+unchanged-manifest archive outside the repo, copy only frozen
inputs with hashes, and use the pinned reviewer trace loader recorded in
`provenance.json`. The existing module guard can propagate trace-only environment
through scrubbed Node children. Per-run Git-blob/import/current endpoint guards,
whole48 primary and historical comparisons and seven hard-bounded hosts are
required after ROOT relay. This preparation does not claim those future guards
or controls have run. A different packed-consumer verifier remains necessary;
this leaf does not implement a duplicate public-consumer harness.

## Source baseline, limits and reproduction

Historical source snapshot is `6e3e3165e3b88aa5518eac33afd0b2ecdfa5fd2a`,173 source
files plus four manifests hashed from Git. The existing env implementation is
`src/commands/execution.ts`, its shared option helper `src/commands/internal.ts`,
and shebang/literal-invoke routing is `src/shell/runtime.ts`. Source anchors,
blob/hash inventory and selected live hashes/HEAD/status are in `provenance.json`.
Only the old implementation's option/binding scope is described. **There is no
fresh current or old product baseline for this holdout**, and old canonical or
kernel counts are not substituted. No author change or current source claim is
inferred from historical6e inspection while its writer is active.

The old40 mode differences remain supplementary profile facts; this task neither
declares all40 bugs nor changes creation-mask/FS policy. The explicit-bash-c
parameter-status follow-up, OLD9, custom-first-read five1200ms requirements,
accepted errexit/accounting and canonical evidence stay separate and unrerun.
No fullgate, kernel, lifecycle, ERR trap, inherit_errexit or full-Bash claim.

Native helpers use detached groups,3s ordinary deadlines,20s compiler deadline,
1MiB combined output cap and250ms recursive deadline. Native scratch is outside
the repository and removed after durable raw audit proof; no foreign cleanup or
signals. `native.mjs` refuses existing evidence paths rather than rerunning for
green. To validate preparation without native/product execution:

```sh
node --test tests/shell-stress/env-split-holdout/integrity.test.mjs
```

All edits are new owned paths via apply_patch and an explicit-only atomic commit.
After the prepared handoff, STOP until ROOT supplies the author's ready commits.
