# Primary reference ledger — read-only web research

Observed 2026-08-29 via web search excerpts. No native binary was run. GNU5.3 is the requested reference edition, **not proof of the local binary version, latest patch level, or observed product parity**. Source excerpts are bound separately in BINDING.json/read captures.

| ID | Official primary locator | Rule used / limit |
|---|---|---|
| G0 | `https://www.gnu.org/s/bash/manual/html_node/index.html` | Manual identifies Edition 5.3, for Bash5.3, dated May18 2025. |
| G1 | `https://www.gnu.org/s/bash/manual/html_node/The-Set-Builtin.html` | -u diagnoses unset expansion and exits noninteractive shells; special @/* and array @/* exemptions; named nounset equals-u; +/- option setting and positionals; existing e/pipefail definitions must be preserved. Exact diagnostic/status and every cluster-o spelling are not established by the excerpt. |
| G2 | `https://www.gnu.org/s/bash/manual/html_node/Shell-Parameter-Expansion.html` | Colon tests unset-or-null, no colon unset only; guarded expansion forms, positional spelling, lengths and substring/pattern forms. Do not interpret generic length documentation as an established nounset empty-array result. |
| G3 | `https://www.gnu.org/software/bash/manual/html_node/Shell-Arithmetic.html` | Read-by-name and recursive arithmetic values, null/unset zero in the general description, lazy operators and fixed-width arithmetic. Nounset-specific arithmetic override is unresolved by this paragraph. |
| G4 | `https://www.gnu.org/s/bash/manual/bash.html` — Arrays | Array value presence includes empty string; bare name denotes element zero; array member lengths count elements. Generic negative indices exist in GNU but are outside the accepted virtual profile. |
| G5 | `https://www.gnu.org/software/bash/manual/html_node/Command-Execution-Environment.html` | Subshell environments copy options/state, cannot mutate parent; bash command substitution clears-e except specified modes. Do not infer-u is cleared. |
| G6 | `https://www.gnu.org/s/bash/manual/html_node/Bash-Builtins.html` | `local -` can restore function-local option changes in GNU. This separate unsupported feature is explicitly not silently implemented by unit2. |
| G7 | `https://www.gnu.org/software/bash/manual/html_node/Interactive-Shell-Behavior.html` | Interactive nounset behavior differs; proposed product profile here is noninteractive, not a universal shell-mode claim. |

Direct web opens of the GNU manual and Savannah `expr.c?h=bash-5.3` returned no usable content in this tool session; search excerpts from the official manual were available. No Savannah source body or immutable GNU source hash was obtained; arithmetic/source-implementation questions remain open. Third-party source mirrors and old Bash discussions were not used to settle GNU5.3 semantics. All proposed exact runtime statuses/bytes remain unset in CASES.json pending the separately authorized native/reference lanes.
