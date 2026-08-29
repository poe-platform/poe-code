# Official reference observations

Observed 2026-08-29 via web search/fetched search text, not native execution.
Only GNU primary manual used. Locators are references, not downloaded body-hash
attestations. Edition/date below do not identify an installed binary patch.

* GNU Reference Manual top, Edition5.3, updated18May2025:
  `https://www.gnu.org/s/bash/manual/html_node/index.html`
* Conditional Constructs:
  `https://www.gnu.org/s/bash/manual/html_node/Conditional-Constructs.html`
  Normative summary: no field/path expansion inside [[; operators require
  unquoted syntax; equality uses quote-sensitive patterns with extglob enabled;
  =~ uses POSIX ERE, with invalid-pattern status2; comparisons use locale;
  BASH_REMATCH stores global captures; &&/|| short-circuit. Exact diagnostic bytes
  and all lexical corner cases are not established by this summary.
* Conditional Expressions:
  `https://www.gnu.org/s/bash/manual/html_node/Bash-Conditional-Expressions.html`
  Normative summary: -v tests assignment/presence including aggregate indexed
  array members; numeric operands are arithmetic expressions, expanded-empty
  operands evaluate to zero; metadata normally follows symlinks; descriptor
  pseudo-paths have special behavior. Adapter authority is our contract concern,
  not an assertion made by this page.
* Full manual, Shell Arithmetic and Pattern Matching sections:
  `https://www.gnu.org/s/bash/manual/bash.html`
  Normative summary: arithmetic uses fixed-width integers and recursive variable
  expressions; shell pattern extended groups are not ordinary literal parentheses.
  This does not resolve current Unit2 nounset arithmetic policy or establish that
  JS RegExp implements GNU regex/locale semantics.

No third-party answers, libc claims, local Bash version inference or oracle
goldens are used. Proposed restrictions and numeric caps are decisions in README,
not claims that GNU documents those restrictions.
