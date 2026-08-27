# Initial independent acceptance: blocked by foreign public-import drift

**2026-08-27: not accepted.** This is an additive record after first author
READY, not a rewrite of the ten-file native freeze at
`aef76d0cede4804513200ec71d572ca99240ca0f`. Those ten files remain byte-identical.
No product/source repair, oracle change, alternate narrow import, or retry was
made after the foreign import failure. ROOT must coordinate a stable public
dependency snapshot before authorizing a new complete replay artifact.

## Exact attempted counts

One attempt per frozen case under the real virtual Bash and POSIX sh roles:
**54 + 54 = 108 case attempts**, compared against both complete frozen native
profiles, **216 comparison slots**. Four additional host attempts ran in their
own bounded children. **Only seven case bodies reached product evaluation**;
no host body ran. The artifact's `productObservations:108` and
`hostObservations:4` label attempted slots, not successful imports/evaluations.

| Frozen comparison profile | Raw exact / all slots | Guard-accepted / all slots | Explanation |
| --- | ---: | ---: | --- |
| GNU 5.3 Bash | 7/54 | 6/54 | Six valid; one raw match with dependency drift; 47 import blocks |
| Apple 3.2 Bash | 7/54 | 6/54 | Same 54 product attempts, not another execution |
| GNU 5.3 POSIX sh | 0/54 | 0/54 | All 54 blocked before product import completed |
| Apple 3.2 POSIX sh | 0/54 | 0/54 | Same 54 product attempts, not another execution |
| Host contracts | 0/4 | 0/4 | All four unmeasured because public import failed |

There are **6 valid attempts + 1 drift-invalid evaluation + 105 import-blocked
attempts = 112**. Every reference tuple remains present; blocked/unsupported
inputs are not skipped, characterized green, or removed from a denominator.
There is no demonstrated functional errexit failure among the six evaluated,
guard-valid cases. That small measured subset does not establish hidden closure.

## Failure and precise provenance

The capture ran **2026-08-27T05:47:48.268Z–2026-08-27T05:48:13.659Z**. READY was
read before product import from `/tmp/safe-bash-errexit-author-ready.txt`, with
its exact text and SHA-256 retained. It named the stopped/relinquished source:

```text
6e3e3165e3b88aa5518eac33afd0b2ecdfa5fd2a
src/shell/runtime.ts
5589f60a1db983538d37168e3b9276555ef71a2bc67446783535e47789f9d6eb
src/shell/parser.ts
10d015eb62fd4e4f964666c04e5869ea78afdb76d930181760adecbcf16ab65e
```

All ten committed shell files matched that commit before capture and every
per-attempt endpoint. Initial and endpoint repository HEAD were both
`bd4e57bd5a16125043bf1603603777dfd58bdd28`, but **current foreign source changed
under that unchanged HEAD**. Initial untracked regex/split work was recorded,
not silently described as a clean aggregate. Foreign index and status snapshots
are retained; no foreign paths were staged, committed or edited by this leaf.

During Bash E07, three actual imported source hashes mismatched its endpoints.
The four global endpoint changes were:

| Path | Initial SHA-256 | Endpoint SHA-256 |
| --- | --- | --- |
| `src/commands/regex-execution/client.ts` | `ddac9011690509d98f0a4081a105b44beb76ca0805183f63af0b8ce1725bf3ce` | `69ee4e1542725649940bffd9e491e1f4fd5694eb68c1252ff180959f7057c8fb` |
| `src/commands/search/matcher.ts` | `499848186cde72bd696cba1fc7d53af39354ba74ea63c42acd92d5eb1cda1cfb` | `db1d257b12c3cd11a2c8335fd2b56a3959e95c9a301cd8ed6d3dc16e9744989e` |
| `src/commands/search/options.ts` | `828d97d930dc615089a29efd3fe463293d4f61bf4dd33c81c2ceb6b910eb6ef8` | `8e0bd7dea4d395e36ec8ffb6edc8712e3dfacab7cde8e928d8947c7c8aeb5fbf` |
| `src/commands/search/rg.ts` | `c677f831e8e9dcc5051713d894d277ffa9646d2de358c1970b2dd0a9dfb44417` | `8241f7b05ddb4823bba60edbae1e3d2f70509ca0734c68300b7cd53691d03650` |

All following 105 attempts terminated during import of the **public
`src/index.ts`**, before evaluating the frozen body:

```text
Error [TransformError]: Transform failed with 1 error:
src/commands/search/rg.ts:118:0: ERROR: Unexpected "export"
```

Their child transport status is 1 with empty stdout. This is **not a shell exit
status** and is not converted into one for comparison. The full diagnostic,
stack, process invocation, raw bytes and partial load inventory are retained.
For example, first blocked E08 has unchanged source:

```sh
set -e; probe() { false; printf 'body\n' >> trace; false; }; ! probe; printf 'negated=%s\n' "$?"
```

Both frozen Bash references have status 0, stdout `negated=0\n`, empty stderr,
and only `trace` containing `body\n` at mode 0644. The current attempt instead
has `actual:{protocolError:true}` and the import failure: **there is no product
tuple/effect observation for this case**, not an observed semantic mismatch.

The prelisted inventory contains **518** source/dependency/fixed files.
Per-attempt before/after snapshots and actual file-module loader hashes are
content-addressed in `manifests`. Each of the six valid attempts has **166**
actual loaded file-module hashes matched individually to both endpoints.
This includes actual loaded local dependencies, not just runtime/parser.
One known stable shell hash does not waive other loaded changes.

## Launch discipline and immutable references

All **216 original native observations are reused**, with zero fresh native
runs. The pinned GNU 5.3/Apple 3.2/cat/helper files still match their native
capture hashes. Dates, tool versions, original native controls and the disclosed
pre-freeze control correction remain in the unchanged README/native artifacts.

The additive product runner imports the public API, installs `agentCommands`,
and invokes the actual registry interpreter through `Shell.exec`. Middleware
records actual interpreter command/argv. No fake builtin role or author internal
wrapper is used. Uniform launcher rendering removes only native host-startup
suppression flags `--noprofile --norc`: the virtual shell has no host startup-file
loading. Exact frozen source, semantic flags, `$0` identity, positional arguments
and stdin remain unchanged. This rendering is explicit, not claimed identical
OS argv. The wrapper quotes literal values rather than reinterpreting source.

Each role uses its primary native cwd/environment once; historical native
captures have distinct recorded temporary roots. Both references retain their
original launch records and fixtures. Native role symlinks are oracle
infrastructure outside asserted effects; product roles are real virtual registry
commands, never host execution. No output/effect bytes, diagnostics or modes are
normalized to erase profile differences. Every declared effect file is seeded
0644. The six valid rows preserve exact whole tuples, not merely final status.

All 112 child groups used 3-second/1-MiB bounds. There were no timeouts, output
overflows, surviving groups or scratch directories. Product host-process APIs
were denied before product import; the seven evaluated attempts recorded no
attempts to use them. This does not claim an OS sandbox or capability proof for
the import-blocked cases. Frozen host cancellation/drain/limit contracts remain
**unexecuted**, including their original unmodified budget threshold.

## Independent source-diff audit, not execution acceptance

The verifier read the exact author runtime/parser diff and current matching
source after first READY, without treating author test counts as an oracle.
The following observations refer to source commit `6e3e3165`:

- `runtime.ts:150` and `runtime.ts:159` distinguish the stored `errexit` option
  from private ignored-execution context. `runtime.ts:301` applies the latter to
  nonfinal AND/OR elements and negation; `runtime.ts:441` and `runtime.ts:480`
  apply it to conditional tests. `runtime.ts:565` carries context through
  redirection, and `runtime.ts:818` forwards it into function bodies.
- `runtime.ts:396` checks simple/subshell/arithmetic results rather than every
  compound return. Groups retain current state (`runtime.ts:438`); subshells
  clone state (`runtime.ts:432`). `set` changes stored flags at
  `runtime.ts:1368`; `$-` reads the stored option at `runtime.ts:1592`.
- Pipeline stages use isolated state and shared budgets/signals at
  `runtime.ts:312`; aggregate status uses last-status or pipefail before its
  separate stop-on-error check at `runtime.ts:379`. The distinction between
  inner-stage termination and parent aggregate handling needs the blocked
  hidden compound-stage cases, not approval from source inspection alone.
- Source/eval use current-text execution at `runtime.ts:1178`, `runtime.ts:1202`
  and `runtime.ts:1222`; functions/source catch explicit return at their own
  boundaries. `Flow` kinds remain distinct (`runtime.ts:201`), with isolated
  exit/return handling at `runtime.ts:383`; cancellation checks precede
  stop-on-error decisions at `runtime.ts:391`.
- Command substitutions clone state and clear the stored option only outside
  the sh profile (`runtime.ts:1566`). New interpreters reset stored flags and
  ignored context (`runtime.ts:993`, `runtime.ts:1028`); file/headerless entry
  does likewise at `runtime.ts:1163`. Nested literal invocation constructs
  literal words and returns isolated status (`runtime.ts:1303`), rather than
  generating source. None of these broader blocked cases is marked verified.
- Budget counters/sinks remain shared objects; `Budget.tick` at
  `runtime.ts:67` and command ticks at `runtime.ts:411`/`runtime.ts:916` are
  visible in source. The author threshold correction is not adopted here;
  the original four host contracts and their expected thresholds are unchanged.
  Shared-limit, cancellation reason/late error, and output-drain proof is still
  missing because all four independent host bodies were import-blocked.
- Shebang parsing at `runtime.ts:1131` retains the explicit zero/one literal
  optional-argument protocol: existing Bash paths, plain env role bindings, no
  new direct `/bin/sh` allowlist or splitting of an env literal `bash -e`.
  This cohort adds no protocol decision or coercion to make a row green.

These are bounded source-audit facts, not proof that all dynamic contexts work.
No hidden functional defect has been demonstrated beyond the import blocker;
the unexecuted cases and host controls remain required for acceptance.

## Files, checks and next action

Raw evidence: `acceptance-6e3e316-initial.json`, SHA-256
`5bcdd259bc65bf30cbbcac2a00e741c06661de61217c87ae3cc3689262e041d3`.
The new `acceptance*.mjs` modules are additive; their capture-time hashes are
pinned in the raw initial manifest. Run record-only checks without importing
product source or rerunning native/product workloads:

```sh
node --test tests/shell-stress/errexit-holdout/integrity.test.mjs tests/shell-stress/errexit-holdout/acceptance-integrity.test.mjs
```

The original integrity checks are 9/9; the seven additive checks distinguish
attempts, completed execution and guard-valid acceptance. Three additive module
syntax checks pass. No global typecheck/build/benchmark, original36/72,
legacy-policy tests, old-nine diagnostics, custom-five lifecycle, C-byte fragment,
creation-mask or accepted accounting cohort is rerun. No full Bash/parity or
superiority claim is made. ROOT receives the findings file, not an acceptance
ready signal. Stop after sealing; do not poll or rerun for green.
