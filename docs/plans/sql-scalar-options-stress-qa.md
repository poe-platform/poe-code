# Independent SQL scalar option QA

1. Authenticate frozen CPython executable/version and runtime distribution versions against the reference profile. Compare the installed `csvkit.cli.parse_list` function text with the preserved original scalar reference before reference-only capture.
2. Capture direct native `parse_list` observations for physical LF/CR/CRLF string lines and continuations, raw/unicode prefixes, base prefixes/underscores, float signed underflow and keyword/name fallbacks. Temporary scripts/logs belong in `out`; the preserved reference belongs in `docs/csvkit`.
3. Run the new canonical in-memory scalar differential before changing the parser. Record original misconversions separately from explicitly unsupported native diagnostic profiles.
4. Apply a minimal fix only for validated behavior; run focused scalar and injected-database engine tests. Canonical tests must use no native programs, filesystem writes or databases.
5. Run maintained domain lint; root owns rebuilt workspace integration and broader gates. Record native compatibility cases separately from tests asserting explicit qualification blockers, and purge owned temporary evidence after documenting the result.
