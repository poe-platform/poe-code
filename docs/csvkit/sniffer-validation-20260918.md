# Sniffer validation, September 18, 2026

Scope: the current dirty-worktree JavaScript sniffing engine and optional
safe-bash command integration; no committed, remote-main or release qualification.
Unrelated pre-existing edits were preserved; nothing was staged or committed.

The original `in2csv -I -f csv` semicolon regression failed with status 78 and
the existing sniffing blocker before implementation. It now returns comma CSV,
empty stderr and status zero. Further failing regressions reproduced NDJSON
table-stream serialization, quadratic byte-peek retention accounting, duplicate
default warnings across joined files, JS multiline-anchor divergence and host
Unicode17 versus frozen Unicode16 word classification before their fixes.

Two independent agents authored the quote/source-profile and stream tests;
the quote reviewer additionally exercised and fixed the actual registered shell
tools. Canonical new tests use in-memory inputs, injected filesystem objects or
MemoryFileSystem; no native comparator, disk fixture creation, network or database.
Unicode16 source acquisition was development research, hash-pinned separately in
`sniffer-unicode.md`, and its temporary evidence was purged.

Measured checks:

- Maintained csvkit workspace unit route: 26 files, 1582 passes, **5 TODOs**.
  The pass total includes imported existing engine regression cases. TODOs remain
  unqualified encoding cases; they are not sniffing successes or parity evidence.
- Actual-shell csvkit family: 107 passes, including five independent sniffer
  stress cases; exact output/status comparisons cover all 14 original names.
- Maintained selected csvkit and safe-bash build closures: successful, uncached,
  derived from workspace declarations and native npm lifecycle stages.
- Maintained csvkit lint/source/test typechecks and focused safe-bash command
  and stress-test ESLint: successful.
- Maintained safe-bash integration-discovery test: 109 passes; the new shell
  stress file has a literal maintained membership assertion.
- Maintained safe-bash typecheck: source/tests and 26 current consumer groups
  passed; expected negative consumers rejected. This is compile acceptance only.
- Compiled public Shell warning/fallback and inferred semicolon NDJSON output
  rendered with terminal-png and visually inspected. Diagnostics were readable;
  the renderer font showed a missing emoji glyph. Exact shell tests independently
  verify preserved emoji bytes. Owned temporary screenshot/log evidence was purged.

This does not qualify a full repository test/lint gate, all csvkit behavior,
other CPython Unicode profiles, hard regex time bounds, arbitrary live pipe
buffer scheduling, positive sniffing after decoded stdin cursor advancement,
uninjected non-UTF8 ignore decoders, or warning deployments without identity.
These remain explicit limits/blockers documented in `docs/specs/csvkit-sniffer.md`.
