# Raw parameter-pattern trim — September 10, 2026

## Scope

Preserve owned byte-valued shell parameters through `#`, `##`, `%` and `%%`, including scalar and positional expansion. Restore the original saved getopt recipe using command substitution and `${raw%.}`; do not substitute an ANSI-C workaround for that workflow. Pattern substitution and substring behavior remain outside this fix. Explicit indexed, associative and member array selectors currently reject trim operators at parse time; six exploratory native cases retain that classification rather than widening the existing syntax profile.

## Evidence and implementation

- Capture bounded Bash C/C.UTF-8 byte oracles before production edits, then reproduce maintained in-memory failures.
- Retain the original value rather than its lossy display text. Preserve expanded pattern bytes and quoting.
- Reuse bounded pattern matching with byte-coordinate ownership and locale-aware candidate boundaries. Bash falls back to byte candidate boundaries when the input is invalid UTF-8; valid candidate substrings can still match as Unicode.
- Keep cumulative work, allocation admission, cancellation and release scoped to the expansion. No host execution belongs in production or canonical tests.
- Avoid widening pre-existing Unicode character-class policy while fixing byte retention. The exploratory native non-ASCII `[:alpha:]` case is evidence, not an added parity claim.

## Validation and handoff

Run new byte regressions and adjacent pattern, substring and parameter tests, then the owned source/mock public consumer suite. Keep earlier red logs and source/receipt hashes. Obtain independent review before root builds or broad gates. Root owns discovery, public integration, builds and Git.

The initial native-backed run preserved 44 failures and 5 passes in
`/tmp/issue683-raw-trim-red-v1.log`. The first implementation run preserved
94/100 in `/tmp/issue683-raw-trim-green-v1.log`; its six failures were the
pre-existing array-selector syntax refusals, not trim parity passes. Those six
cases now explicitly assert the unchanged status-2 refusal in C and C.UTF-8.
The split-byte pattern-fragment regression has its own native receipt and RED
log before its assembly fix. Final focused verification is recorded in
`/tmp/issue683-raw-core-green-v4.log` (191/191, including the six refusal controls)
and `/tmp/issue683-core-adjacent-v3.log` (477/477).
