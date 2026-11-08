# Eighteen proposed end-to-end identities — all UNRUN

These are declared finite product-profile checks, not GNU oracle results. Their
future executable fixtures must freeze exact literals/bytes/roles before runtime
GO. Public engine rows use only the existing authenticated PUBLIC static adapter,
not private source/native Node/eval. Stub-provider rows prove host integration
only, never JavaScript execution. No Node fd0, async fs, ESM, arbitrary CommonJS,
conditional ERE, or aggregate nounset recovery is implied.

| ID | Proposed program/protocol | Observable profile and proof role |
| --- | --- | --- |
| C01 | Enumerate default registry, root and explicit Node subpath; add Node/curl plugins explicitly | Exact literal 80-name inventory; no default Node/curl/SafeJS. Root/subpath identities agree; private subpaths denied. Host/type/package protocol. |
| C02 | `set -eu -o pipefail; value='a b'; [[ "$value" == 'a b' && ( x == x || $missing == z ) ]]; printf '%s\n' "$value" \| cat` | `a b` + LF; skipped unset operand not evaluated. Table escapes denote literal pipeline operators, not program backslashes. |
| C03 | Quote-sensitive basic patterns, e.g. `[[ abc == a* ]]` versus `[[ abc == 'a*' ]]` | True versus false using supported whole-string pattern/quote profile, no extglob/ERE/collation credit. |
| C04 | `set -u; a=(zero one); f(){ printf '%s\n' "${a[1]}"; }; f` | `one` + LF across function scope; no `a[@]` length/DISCARD inference. |
| C05 | `set -o pipefail; false \| cat; printf '%s\n' "$?"` | `1` + LF; errexit deliberately off, existing pipeline status preserved. |
| C06 | `f(){ printf out; printf err >&2; }; f 2>/audit \|& cat` | `outerr`; `/audit` is created but empty because implicit stderr duplication follows explicit redirection. |
| C07 | Same function; `f &>/both 1>/out` | `/out` has `out`, `/both` has `err`; one underlying shared writer is not double-closed. Effects and closure counters, not just text. |
| C08 | VFS sourced script containing `let 'n+=3'`, initial `n=2`, then print n | `5` + LF; source scope and resolved read-sensitive arithmetic, not unratified aggregate continuation. |
| C09 | `set -u; printf '%s' "$missing"; node -p '1'` | Provisional profile status1, budgeted diagnostic, Node provider prepare/guest counts zero. No GNU byte/status golden claim. |
| C10 | `/entry.cjs` uses `console.log(process.argv[2]);`; arguments `'a b' '*' ''` | Exact argv checked at trusted provider boundary; guest prints `a b` + LF. Supported `.cjs` and process facade only. |
| C11 | Mock authorized curl writes `/payload.json`; inline Node uses `require('fs')`, text read, JSON.parse and text write to `/repo/README.md`; separate read-only Git shell diffs same backing | Actual PUBLIC engine edit followed by genuine object/index-backed diff. Inline source needs no VFS source-read grant; dataRead/dataWrite explicit. Freeze fixture-derived diff bytes before GO. No stdin-as-fd0 invention. |
| C12 | Mock curl redirect followed by VFS output | Authorization recorded on every hop; cross-origin credentials stripped; exact body preserved. No external network or transport sandbox claim. |
| C13 | Read-only wrapper over neutral authentic `/repo`: `git status --short`, `git rev-parse HEAD`, `git ls-files` | Real objects/index/ref queries and unchanged `.git` hashes; freeze exact fixture-derived outputs, not product-generated goldens. Native Git remains UNRUN. |
| C14 | Literal patch supplied by printf pipe to `apply_patch`, then `git diff` | Worktree edit is reflected in genuine Git diff, `.git` unchanged; preserve patch limits and non-atomic/refusal qualifications. |
| C15 | Explicit dataWrite grant with read-only VFS, Node sync write attempt | Read-only provider rejection/no file effect despite grant; finite expected public failure class bound from accepted adapter recipe before GO, not guessed diagnostic bytes. |
| C16 | Node cooperative held VFS read; wrapper registers owned cleanup before `context.invoke('node', ...)`; caller abort reason false | Exact caller identity; independent finally releases held gate; registered cleanup and worker retirement observed separately. No arbitrary opaque-provider preemption promise. |
| C17 | Unit4 explicit parameter failure with null/falsy diagnostic sink and secondary cleanup failure; following Node never starts | Existing authenticated guard→invoke-function pattern, exact rejection presence/identity and precedence. No registration/invocation wait cycle; gates always released independently. |
| C18 | Node plugin collision, then separate replacement/snapshot case with `node -p '8'` | Collision preserves existing handler; replace=true is authoritative and snapshot stable after options mutation; actual engine prints `8` + LF only in enabled case. |

## Reuse, not reclassification

- Node accepted public `tests/integration/node-public-author-20260829/public-node.mjs`
  provides P07/P08 collision/replacement, P09 inline, P10 argv/env, P11 stdin source,
  P12 synchronous FS/JSON and P18 cooperative caller-read shapes. Use the exact
  accepted version mapping from the independent report, not blanket reuse of
  every historical assertion. P19–P21 were not inspected for this design.
- Existing Node module frozen focused/worker-v5 recipes carry 61 rows; accepted
  public plan carries 24. Their unsupported cases remain unsupported tests, not
  native-compatibility wins. Preserve W23/E09 and observed-versus-complete census.
- Existing Unit4 H28/X10-v2 guard registration and unconditional gate release are
  templates for C16/C17; preserve raw old deadline and unobserved substeps.
- Genuine neutral Git fixture is
  `tests/commands/git-design-20260828/NEUTRAL-FIXTURE.json`, virtual root `/repo`,
  HEAD `1cec77171d8321d533b3aa50b7a1a9df02b10816`. Handle each entry's actual text,
  base64 or symlink representation. Do not native-init or run Git on host repos.
- All row implementations must keep invocation context/cwd/environment and
  precise file bytes explicit. No host process/env mutation is a test substitute.

The Markdown rows are design literals, not a sealed executable runner. The
future preseal must remove table escaping, choose exact hosted protocols and
freeze all expected bytes/counters from accepted contracts/neutral fixture data.
Unsettled expectations must be resolved before running, not learned from the
combined implementation and retrospectively labeled native goldens.
