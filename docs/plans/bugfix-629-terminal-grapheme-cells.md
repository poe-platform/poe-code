# Issue 629: joined-emoji redraw

## Validated defect

The author is `kamilio`. A bounded absolute-position redraw of `|A👩‍💻B|`
left joiner/laptop content behind. The baseline treated the component code points
as separate occupied cells. Its line serializer also emitted an extra space for
wide-cell continuations. This is a display-buffer geometry defect, not evidence
about every terminal emulator or font implementation.

The unchanged implementation SHA-256 for the isolated reproduction was
`a7727badae9c47c384c9d337140788dc89acb1c2ffe678e9ae45856cf19557ab`.

## Candidate design

- Extend consecutive printable graphemes using `Intl.Segmenter`, retaining the
  previous width for an incomplete joiner. Use the existing `fast-string-width`
  dependency for completed multi-code-point widths.
- Retain a trailing high surrogate until the next write can complete or disprove
  its pair. Empty writes do not flush incomplete input.
- Store nonenumerable width metadata on leading cells, preserving the existing
  array cell representation and null continuation slots. Serialize each wide
  glyph once, without adding a continuation space.
- Clear both halves when an overwrite or erasure intersects a wide glyph, and
  preserve complete cells across insertion, deletion, and resize boundaries.
- Keep combining marks, styles, concealment, wrapping, and repeated graphemes.
  Absolute cursor positioning clears pending wrap before a redraw.

## Isolated TDD evidence

The candidate and evidence reside outside the live checkout while another
release candidate runs its full gates. No private runner or extracted control
file belongs in the implementation commit.

- Initial regression run: 11 behavioral failures and 7 passes on unchanged code.
- First implementation: 18 passes.
- Boundary additions: 4 failures and 22 passes; corresponding repair: 26 passes.
- An unchanged AST-selected `TerminalBuffer` describe block and its two helpers
  add 98 existing controls. This is not the complete terminal-pilot suite.
- Additional serialization, insert-mode clipping, and UTF-16 fragmentation
  controls initially produced 4 failures and 129 passes. One remaining failure
  after the first repair exposed pending wrap surviving absolute positioning;
  the original failing logs remain preserved.
- Current isolated result: 35 new tests plus 98 existing controls, all passing.
- Scoped source/test typechecking uses the actual terminal-pilot compiler
  options, not a permissive replacement configuration.

## Root integration evidence

Root installed the complete 35-test regression file before modifying the live
implementation: 25 behavioral failures and 10 passes. After applying the reviewed
candidate, all 288 tests in the eight terminal-pilot test files pass on the actual
checkout. This includes the new 35-test cohort and existing native PTY controls;
it is not a full-workspace gate or a visual font-rendering qualification.

## Integration and delivery still required

The explicitly selected terminal-pilot build closure passes. Root ran
`npm run screenshot-poe-code -- --help` and inspected the resulting PNG. A tiny
native PTY session then exercised the actual command runtime and screenshot
handler before and after absolute-position redraw. Both text rows changed from
their respective emoji-containing strings to exactly `|A  B|`, and the inspected
after-image contains no stale glyph fragments. Runtime cleanup closed the owned
PTY session.

The before-image uses missing-glyph/font fallback and does not establish correct
emoji artwork or universal renderer/font compatibility. Preserve this limitation;
the verified fix concerns occupied-cell geometry and removal after redraw.

Normal maintained build, unit, lint and type gates remain required before push.
Commit only the source, new canonical tests, and this plan. After verified
delivery to `origin/main`, close issue 629 immediately, then monitor the release
and verify its published artifact separately.
