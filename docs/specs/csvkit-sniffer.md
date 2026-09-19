# CSV sniffing contract

Target: csvkit 2.2.0, source archive SHA-256
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
Reference dependency/deployment locks remain in `docs/csvkit/reference-profile.json`.
The implemented heuristic is CPython **3.14.2** `Lib/csv.py` `Sniffer`, wrapped by
the frozen Agate `csv_py3.Sniffer` and `table.from_csv` source recorded in
`docs/csvkit/service-register-20260917.json`. This does not adopt later CPython
security patches that change quote heuristics. Other CPython profiles are not
newly qualified by this change.

Agate restricts inferred delimiters to comma, tab, semicolon, space, colon and
pipe. Quote inference tries four shapes in source order; ties preserve insertion
order. Frequency inference counts physical LF-separated nonempty lines in
ten-line cohorts, uses adjusted mode counts and CPython's floating-point
consistency loop. Ambiguity prefers comma, tab, semicolon, space and colon,
leaving pipe as the sole remaining candidate. Sniffed dialects use minimal
quoting and CRLF terminators. CLI reader keywords override the inferred dialect:
`-t` overrides `-d`, `-q` overrides the inferred quote, and csvkit's default
doublequote/skipinitialspace keywords also override inference.

Original parser declarations retain `-y/--snifflimit`, default 1024, zero disabled
and minus one full-file. Raw readers, including names/count fast paths, do not
sniff merely because their executable also declares a table option. CLI and SDK
settings reach the same Runtime reader and actual registered safe-bash engine.

Named text files sample Unicode codepoints after universal-newline translation.
The sample does not advance the CSV cursor or strip NUL. Positive stdin sniffing
uses an independently decoded byte peek, then slices codepoints, matching
Agate's operation order rather than the help text's byte description.
`defaultSniffStreamProfile` fixes the peek prefix at 65536 bytes, independent of
transport chunk boundaries, with UTF-8/UTF-8-SIG `errors='ignore'` decoding.
It is a reproducible buffered-stream profile, not a guarantee about arbitrary
live CPython pipe scheduling. Hosts can inject another named `SniffStreamProfile`
through `sniffing.stream`; other default encodings return explicit blockers.
Retained raw fragments are owned copies and replay before subsequent bytes.
Strict CSV decoding still validates the original bytes, even when sample decoding
ignored an incomplete or malformed sequence.

`sniffing.maxSampleCharacters` defaults to 65536 and separately bounds both
positive and full-file samples. Exceeding this product resource policy returns
status 78, never a partial-sample success. Existing input/retention/work budgets,
cancellation, backpressure and registered cleanup remain in force. The frozen
quote regex executes synchronously within each bounded sample; cancellation
cannot preempt an individual regex call. This is not a hard elapsed-time bound.

Failure uses the normal comma/doublequote reader dialect. Exact Python warning
text needs the frozen deployment's path, line and optional source, supplied as
`sniffing.warning`. `sniffing.suppressWarnings` explicitly suppresses the warning;
absent suppression or deployment identity, failure returns status 78 instead of
inventing a path. The default Python warning filter emits this fixed warning
location once per invocation, including across multiple joined inputs.
Positive stdin sniffing after decoded cursor advancement is
explicitly blocked because the Python text/raw-buffer relationship is not yet
modeled. Full-file sampling uses the remaining strict decoded input.

Type inference, SQL/driver behavior, other interpreter profiles and live TTY/pipe
scheduling remain subject to existing qualification blockers. Unit successes
establish only their measured in-memory cases; they are not whole-suite parity.
