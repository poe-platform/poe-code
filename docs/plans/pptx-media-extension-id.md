# Media extension identifier correction

Scope: fix the independently verified media insertion identifier in
`packages/pptx/src/media-editing.ts`, with original assertions in
`media-track-preservation.test.ts` and `command-media-editing.test.ts`.
Keep this as a separate atomic correction when the commit gate is cleared.

Official MS-PPTX revision 25.0, section 2.2.4, identifies the media extension as
`{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}`. The existing authoring path emitted a
different identifier. An original SDK test first failed by comparing the emitted
XML to this independent registered value. The writer now emits the registered
identifier. The command-engine insertion test independently checks the same
literal in its output ZIP. See the official links in
[the schema map](../pptx/media-track-schema-map.md).

Known caption fixtures now use `m:extLst/p:ext` and the registered caption
extension `{3AFAAA56-56D3-431D-BCD4-E75A35582382}`. Unknown extension fixtures
remain opaque and unchanged. No copied implementation, downloaded fixture,
caption authoring feature, rendering or playback claim is introduced.

Verification procedure: run the three focused package media editing/track/command
files, package lint including both TypeScript configurations, the maintained
selected pptx build closure and actual shell media tests. Keep the root guarded
lint cap failure visible; do not change its budget or bypass it for a commit.
No commits, push, release, README edit or full pipeline execution is authorized
by this procedure beyond the original task constraints.

Executed: final focused package media suites 39/39 passed; package lint and both
TypeScript configurations passed; selected pptx workspace build passed; final
actual shell media cases 10/10 passed. SDK identifier assertion reproduced the
incorrect old identifier before the one-literal fix. The command insertion
assertion checks the registered identifier in independently decoded output XML.
Guarded root lint remains incomplete at its fixed 12,000-subject cap, so this
atomic improvement is uncommitted along with the other owned fixes.
