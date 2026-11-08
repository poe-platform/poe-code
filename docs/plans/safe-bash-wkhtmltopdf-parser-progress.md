# wkhtmltopdf parser implementation and remaining engine gates

Task `engine-wkhtmltopdf` remains incomplete. This document records the remaining
implementation sequence; passing parser tests does not complete a rendering gate.

## Implemented independent parser work

`packages/safe-bash-command-wkhtmltopdf` is private, TypeScript ESM and has no
runtime dependencies. It parses the complete 122-switch inventory with explicit
scope/arity metadata and unavailable-capability rejections. It supplies fresh
global/page defaults, scoped clones, post-option cover cleanup, ordered replacement
entries, normalized lengths, checked integers, binary32 floats, batch tokenization,
required limits and synchronous cancellation. Original tests were run failing
before implementation. Review also reproduced and fixed the default-header
Caller literal (`[topage]`, distinct from the help description) and omitted-limit
admission bypass. No existing contributor-owned planning files were edited.

## Unresolved findings blocking completion

1. Establish the prerequisite first-party HTML5/CSS/selector, shaping/font, image
   and box-layout engines. `packages/pandoc/src/html.ts` imports external `parse5`
   and removes rendering-relevant elements. `packages/pdf/src/model.ts` accepts
   preconstructed blocks in points and explicitly rectangular tables. Its writer
   uses external `pdf-lib`, fontkit and pako. These findings were checked against
   current source; importing this closure fails the requested dependency policy.
   Reuse qualified existing primitives without duplicating shared engines.
2. Write and pass original failing engine tests for cascade/inheritance, selectors,
   CSS lengths, block/inline flow, metrics/shaping, lists, supplied images, table
   spans, pagination/breaks, widows/orphans, positioning and page furniture.
   Flex and grid need independent gates. None has passed for wkhtmltopdf.
3. Define actual rendering APIs against the accepted engines, with structured
   errors, explicit limits, byte streams and identity-aware VFS resources. Add
   cleanup-before-acquisition, deadlines, cancellation, backpressure, retained-byte
   ownership and bounded output staging. No renderer contract is fabricated here.
4. Implement qualified outline/link/TOC models, bounded TOC convergence, explicit
   clock/locale inputs, and distinct physical/logical/outline numbering. Preserve
   single-conversion HTTP/network statuses separately from batch status. No status
   helper is used by this parser; its parse errors legitimately exit 1.
5. Finish CLI byte-encoding admission, SDK/CLI equivalence and batch conversion
   execution with fresh per-line settings and stop-on-first-failure behavior.
   Current SDK text parsing and tokenizer do not qualify these workflows.
6. After prerequisite acceptance, extract the canonical leaf contracts required by
   the package pattern. Integrate command definitions and the intended safe-bash
   subpath through the guarded builder. Prove an isolated packed consumer, bundled
   implementation/declarations, absence of unpublished imports, and shared runtime
   brands/constructor identity. No safe-bash export or default registration was
   changed before these gates.
7. Pin and control the full native/Qt profile before compatibility assertions.
   Parser finite/range validation, sentinel rejection and literal SDK Unicode
   admission are explicit deviations. Native numeric/encoding boundaries, patched-Qt
   branches and source outline defects remain unqualified.

The inspected prerequisite and package-pattern plans remain authoritative. No
native/browser/WASM fallback, dynamic downloads, ambient files/network or script
execution has been added. No package publication, commit, push or release is
performed as part of this parser work.
