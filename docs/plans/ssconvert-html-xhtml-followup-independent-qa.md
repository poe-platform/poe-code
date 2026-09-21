# HTML/XHTML follow-up independent QA

Executed 2026-09-20 by a separate stress agent. Root retains implementation,
integration, exports and Git ownership. This agent added only the new stress
unit file and this report; no README, Git, publishing or source changes.

## Candidate and reference

Measured live source SHA-256 for `packages/ssconvert/src/codecs/html.ts`:
`1028c1f4ec2ec0b0d1de54f27cf622e9f54e0ab5440dcc096741d9004341a37f`.
New stress test source SHA-256:
`38ddb1571b2f827f800c5c99d69899b62b2583e7d5ec05b0d7239df177ce9865`.
These hashes bind the measured dirty workspace source, not a Git commit.

Primary source inspected under
`out/ssconvert-lifecycle/gnumeric-1.12.61/plugins/html/html.c`.
Root separately verifies the official archive hash and reference profile.
Native oracle uses Docker context `colima`, container
`ssconvert-statistics-qa`, executable
`/out/ssconvert-statistics-oracle/prefix/bin/ssconvert`.
Environment is `LC_ALL=C`, `TZ=UTC`, `GSETTINGS_BACKEND=memory`,
`GSETTINGS_SCHEMA_DIR=/out/ssconvert-statistics-oracle/prefix/share/glib-2.0/schemas`.
Reference dependency profile is captured in
`ssconvert-html-xhtml-export-qa.md`. Native remains a separate QA process.

## Manual procedure and outcomes

Create original small Gnumeric XML fixtures in `out/html-stress-review`.
Each fixture contains a single sheet S and A1 string abcd, except the border
fixture (13 numeric rows) and overflow fixture (long A1 text).
Import identical byte inputs through the actual `createEngine`/`runCommand`
with injected byte filesystem and cancellation. Invoke native separately with
`-T Gnumeric_html:<id> input.gnumeric output.html`, capturing byte output and
stderr. Compare raw bytes for each of html32, html40, html40frag, xhtml and
xhtml_range. DOM normalization never substitutes for byte parity.

Final valid-input matrix: **25 passes / 5 mismatches / 0 skips**.
All 30 native and JavaScript commands returned exit 0, empty stderr.

| Original fixture | Five exporter byte comparisons |
| --- | --- |
| italic=1 [0:4], then italic=0 [1:3] | 5 passes after root repair |
| underline=single [0:4], then underline=none [1:3] | 5 passes after root repair |
| underline, strike, italic, bold, rise overlapping [0:4] in that order | 5 passes |
| Same attributes in reverse order | 5 passes |
| All 13 border line styles, four edges with distinct colors and high-byte truncation | 5 passes |
| A1 `abcdefghijklmnopqrstuvxyz abcdefghijklmnopqrstuvxyz` | 5 mismatches |

Before root's repair, actual CLI/native comparisons reproduced both disabling
attribute defects: native emits `<i>a</i>bc<i>d</i>` whereas JavaScript also
wrapped bc in italic; native single underline similarly leaves bc unwrapped
where JavaScript underlined it. The later root fix was followed by the entire
matrix rerun. The new in-memory/memfs tests retain these independent fixtures,
verify actual CLI and supplemental direct-writer bytes, unchanged input, destination replacement and
empty stderr. Native does not run in unit tests.

The overflow mismatch remains in all five exporters: native writes
`colspan="6"`, JavaScript writes a plain cell. This is a measured failure,
excluded from the 25 passes; it prevents full byte compatibility claims.

Separate malformed-boundary probe: string éx with bold UTF-8 byte range [0:1].
The initial html40frag CLI comparison returned JavaScript exit 1, diagnostic
`Invalid rich text range`, no output; native returned 0 and emitted invalid
character entities and apparent uninitialized bytes. Five native exporter
captures confirmed different garbage sequences. This native undefined behavior
is unsupported, not a pass or a deterministic parity expectation. Product
rejection was not relaxed to reproduce unsafe native output.

## Local verification and limits

- `npx vitest run packages/ssconvert/src/codecs/html-write-stress.test.ts`:
  1 file / 3 tests passed, fresh execution.
- `npx eslint packages/ssconvert/src/codecs/html-write-stress.test.ts`:
  passed, exit 0.
- Initial comparison driver failed before running cases because it omitted
  required limits; corrected to inject all required limits and reran. The
  corrected valid-input matrix completed as above. This harness failure was
  not a product pass.

Root owns maintained workspace build/test/lint gates, safe-bash integration,
screenshots and the final gate accounting; this report does not certify them.
No alternate runtime, realm/host boundary, checkpoint/replay, conditional style,
locale/plugin variant, font metric variant or additional authority cell was
measured by this agent. Budget/cancellation controls in the earlier independent
report retain their separate scope. There is no exhaustive parity claim.

After root incorporates evidence, remove only this run's scratch directory and
matching oracle directory. Preserve pre-existing archives and unrelated out
artifacts. No commits, push, publication or release occurred.
