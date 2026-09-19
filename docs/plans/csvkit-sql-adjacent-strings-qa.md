# SQL option adjacent string QA

1. Authenticate the frozen CPython 3.14.2 binary hash and runtime distribution versions against docs/csvkit/reference-profile.json.
2. Call released csvkit.cli.parse_list with pairs containing adjacent ordinary, Unicode-prefixed and raw string literals, plus nested containers and comments inside parentheses. Compare decoded values and retained tuple identity.
3. Reproduce the unsupported valid forms with failing in-memory canonical regressions. Ensure string addition remains an unevaluated raw expression.
4. Implement bounded lexical concatenation without eval, preserving explicit blockers for unsupported token classes and top-level multiline syntax.
5. Run the maintained csvkit test, lint and selected workspace build closure. Independently stress actual safe-bash ownership and cancellation.
