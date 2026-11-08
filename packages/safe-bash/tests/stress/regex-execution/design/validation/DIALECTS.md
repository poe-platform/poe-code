# Advertised dialects and primary sources

Primary web documentation consulted 2026-08-27 (live manuals, not installed
binary identity). Exact installed profiles, versions, SHA-256, options, locale,
input bytes, stdout/stderr bytes, and status are in `evidence/native.json`.

| Source | Relevant claim, paraphrased |
| --- | --- |
| GNU Grep manual, Regular Expressions: https://www.gnu.org/s/grep/manual/html_node/Regular-Expressions.html | GNU grep distinguishes BRE, ERE, and PCRE; BRE/ERE differ in notation rather than basic available matching functionality. |
| GNU Grep manual, Basic vs Extended: https://www.gnu.org/software/grep/manual/html_node/Basic-vs-Extended.html | BRE requires escaping certain grouping/repetition/alternation metacharacters that ERE writes directly. |
| ripgrep author FAQ: https://github.com/BurntSushi/ripgrep/blob/master/FAQ.md | Default engine excludes lookaround/backreferences; PCRE2 is an explicit alternative. Native Unicode behavior is not selected by the shell locale. |
| Rust regex API: https://docs.rs/regex/latest/regex/ | Supported syntax and Unicode categories are those of Rust regex, not every JavaScript escape or special group. |
| Node primary worker documentation: https://nodejs.org/api/worker_threads.html | Static URL-based workers and awaited terminate are available; resourceLimits constrain JS-engine resources, not a process-wide hard RSS boundary. |

Do not infer GNU/Linux behavior from Darwin. GNU grep was not found at the
recorded PATH/Homebrew candidates; no install was requested or performed. The
system grep identifies as BSD grep 2.6.0-FreeBSD and is **auxiliary**, not GNU
evidence. Installed ripgrep 15.2.0 is a primary native default-engine oracle;
`--engine=default --no-config` prevents accidental PCRE2/config fallback even
though its build includes PCRE2. Native calls use `LC_ALL=C LANG=C` and explicit
stdin. Each has a two-second timeout and 64 KiB output cap.

## What this repository actually promises

- `src/commands/README.md:102`: grep translates common BRE/ERE syntax to JS
  RegExp; it explicitly does **not** promise full POSIX leftmost-longest behavior.
  Special groups/lookaround are rejected. Patterns/output use a byte view.
- `src/commands/search/README.md:173`: rg is ripgrep-like with JS Unicode regex,
  not Rust regex or PCRE2. JS-compatible Unicode properties and ordinary groups
  are supported. Backreferences and user lookaround are unsupported. JS `\d`,
  `\w`, `\b`, case folding, dot/anchor differences are explicitly documented.
- Both docs explicitly disclaim synchronous regex hard preemption; command
  byte/record limits are not an execution-time guarantee.

These deliberate documented dialect choices are not bugs merely because a
native result differs. `grep -Eo 'a|ab'` selecting `a` is documented JS order;
BSD selects `ab` in this profile, but changing to longest-match needs a separate
decision and real GNU evidence, not a silent adapter substitution. Likewise,
native rg's Unicode `\d` matches Arabic-Indic `١`; the current declared JS
profile does not. This validation preserves both intentional behaviors.

In contrast, rg accepting `(?<letter>a)\k<letter>` is an undocumented loophole:
`matcher.ts` rejects numeric backreferences/user lookaround but misses this JS
named-backreference spelling. The exact benign input `aa\n` is retained in the
native and command vectors. Native default rg rejects it, while current rg
matches it. Recommendation to root: close this documented-unsupported extension
with an explicit compatibility note and exact oracle test; do not promote its
accidental acceptance to a mandatory dialect requirement. This leaf changes no
product behavior. Raw named **captures** without backreferences are a separate
case; do not conflate all named groups with named-backreference execution.

Node runtime facts are taken from local Node22.22.2 `process.versions` and the
actual compiled-worker consumer run, not inaccessible versioned TS/CLI manual
URLs. The live worker manual may describe newer APIs; no new-version-only API
is used. Worker resourceLimits do not cap external buffers or total process RSS;
OOM may still kill the process. No memory-sandbox guarantee is claimed.
