# mmdc stress and visual review

Reviewed on 2026-09-24 against the current workspace. This is an executed review, not an implementation plan. The initial findings below were followed by tested renderer and API fixes.

## Final verdict

The supported diagram corpus passes correctness checks and visual review after the fixes. Long labels now wrap, fan-out roots and sinks are centered, branches use distinct tracks and ports, and edge labels stay attached to their own connectors. Dense meshes still contain crossings and require zooming; long chains require scrolling. These are remaining readability limits, not missing relationships.

The SVG/PNG API now follows Mermaid CLI 11.12.0's stdin, default filenames, stdout aliases, explicit-format precedence, white background, scale 1, theme names, config theme precedence, and SVG ID options. SDK and typed command options expose the same capabilities. Supported standard flowchart config and theme variables are documented in the package README. This is a supported subset: it does not reproduce browser sizing, Mermaid CSS, PDF/Markdown workflows, or the entire Mermaid language.

Additional audit regressions fixed inconsistent sequence viewport sizing and collisions between internal SVG definitions when using distinct root IDs. Viewport dimensions now require positive integers in the shared layout entry point.

## Final verification

- 108 inputs in both themes: 216 SVGs and 216 PNGs, all successful with decoded dimensions and geometry checks.
- Visually reviewed every final PNG through 27 labeled contact sheets, plus selected full-size fan-out, prose, class, and mesh images. Contact sheets check composition and clipping; they are not full-resolution pixel audits.
- Required design-document generator completed successfully after building its missing terminal screenshot dependency.
- Maintained Shell integration route: two mmdc boundary tests passed after building the package, with all 611 required runner checks passing.
- Maintained package tests: 48 passed, plus two root lint-stress checks. Scoped lint/typecheck and the package build closure passed.
- Final Shell help/default/error text was captured and visually reviewed; a configured class PNG was also reviewed at full size.
- TDD regressions cover API defaults and precedence, CLI/SDK config parity, malformed configs, CSS color names, wrapped labels/class headers, four fan-out directions, distinct tracks/ports, attached labels, viewport sizing, and SVG definition isolation.
- Earlier error/resource stress checks and per-corpus results below remain applicable. Initial findings are retained as before-fix evidence.

## Initial findings

1. **High fan-out loses connector distinction (medium).** Twelve labeled branches from one root share horizontal tracks; multiple incoming sink connectors also share tracks and target ports. The labels remain legible, but tracking a particular branch is ambiguous. Root and sink align with the first worker rather than the center of the worker row, producing unnecessary long routes. Reproduced in both themes at 1620 × 379 pixels, scale 1. The geometry report is empty, demonstrating that the verifier does not flag shared connector tracks.
2. **Long labels create unusably wide cards (medium).** A 420-character, space-separated sentence renders as a single line. The two-node PNG is 5392 × 432 pixels at the default scale 2. Text is intact, but fitting it into a normal viewport makes it too small to read comfortably. Current text measurement splits explicit line breaks and does not word-wrap. This is a usability limitation, not text loss; explicit \n or <br/> is a workaround.
3. **Dense meshes are difficult to read (low).** Eight nodes with all 28 forward connections produce a 3220 × 2026 pixel PNG at scale 2. Distinct ports and labels survive, but long tracks, crossings without bridges, and excessive surrounding routing space make relationships expensive to trace. Both themes pass the verifier; neither earns a slick-design sign-off. A 30-node chain similarly needs scrolling or zooming rather than fitting to a typical viewport; the chain itself remains correct.
4. **The README promises defaults the CLI rejects (medium, correctness).** The package README's CLI table lists stdin/stdout defaults and its pipeline example omits -i/-o. In the actual Shell, bare mmdc returns exit 2: Missing required input option (-i/--input <path|->). Help correctly marks both options required. Use mmdc -i - -o - for pipelines. This mismatch was verified against the current parser and command, not inferred from older documentation.

## Initial validation

- Maintained command: npm test -- --workspace=safe-bash-command-mmdc. All 38 package tests passed; the root posttest's two lint-stress checks also passed.
- Safe-bash integration: both tests in packages/safe-bash/tests/commands/mmdc-boundaries.test.ts passed, including opt-in registration, SVG themes, binary PNG pipeline, settings isolation, and preserving existing output after invalid input.
- 104 inputs × two themes: 208 SVG and 208 PNG renders; PNG signatures/decoding and dimensions checked, with zero exceptions and zero geometry violations. SVG serialization and PNG rendering were both exercised for every input. Scale 1 was used for this broad matrix.
- Additional mesh and long-label inputs in both themes: four PNGs at default scale 2; all rendered and passed geometry checks.
- One scale-2 transparent PNG: decoded top-left RGBA is [0, 0, 0, 0]; visibly intact Unicode and multiline text.
- Two scale-2 PNGs rendered through actual mmdc commands in a memory-backed Shell: both visually reviewed.
- All 215 final diagram PNGs were visually reviewed: the broad matrix through 26 labeled contact sheets, additional cases individually, and selected corpus/fan-out cases additionally at full size. Contact sheets assess composition and obvious clipping; this does not claim a full-resolution pixel audit of every large image.
- Help and diagnostics were captured from Shell and visually reviewed as a monospace image. This was a rendered text capture, not an actual terminal emulator screenshot.
- Empty input, unsupported pie syntax, unclosed subgraph, and unmatched sequence end all returned explicit E_SYNTAX or E_UNSUPPORTED errors.
- Deliberately reduced source/node/pixel budgets all returned E_LIMIT. A 2049-node input returned E_LIMIT in approximately 5 ms.
- SVG-only size stress: 256-node chain rendered at 152 × 26632 in approximately 48 ms; 1024-node chain at 152 × 106504 in approximately 275 ms. These were structural/performance checks, not visual approvals or PNG renders.
- Main matrix timings include parsing, geometry, SVG, PNG encoding/decoding, and writing evidence: slowest observed case approximately 1.23 seconds. These are single-run observations under concurrent local checks, not isolated benchmark numbers.

## Visual assessment

Both palettes have distinct canvas, surface, header, and accent colors. Text is centered and readable at natural size; class and ER compartments separate labels/types cleanly. Notes use a restrained amber accent. Rounded elbows, label pills, shadows, and outer margins are consistent. Parallel edges and self-loops remain distinct in the small adversarial case. Unicode, explicit multiline labels, sequence activations, nested-state headers, class multiplicities, and ER markers remained visible in the reviewed outputs. No obvious clipping or missing node/relationship was observed on the corpus; passing this review does not establish complete Mermaid language compatibility.

## Reproduction sources

Generate the fan-out input with a flowchart TD header and, for i = 0..11, these two lines:

```mermaid
Root -->|Route i| Ni[Worker i]
Ni --> Sink
```

The long-label source is flowchart TD followed by A["LABEL"] --> B[Done], where LABEL is "A long sentence with multiple words " repeated 12 times. The mesh source is flowchart LR with Ni -->|i-j| Nj for every 0 ≤ i < j < 8. The chain source connects Ni --> Ni+1 sequentially. Render each using renderMermaidPng or explicit mmdc input/output flags.

## Every corpus outcome

Each row covers independently rendered light and dark SVG/PNG outputs. "Approved" means no visible problem at the review scale and no current geometry violations. IDs refer to src/corpus-100.ts; many cases are label variants of recurring topology templates, so 100 inputs do not represent 100 independent topology shapes.

| Case | Family | Light | Dark |
| --- | --- | --- | --- |
| diagram-001-flowchart | flowchart | Approved | Approved |
| diagram-002-flowchart | flowchart | Approved | Approved |
| diagram-003-flowchart | flowchart | Approved | Approved |
| diagram-004-flowchart | flowchart | Approved | Approved |
| diagram-005-flowchart | flowchart | Approved | Approved |
| diagram-006-flowchart | flowchart | Approved | Approved |
| diagram-007-flowchart | flowchart | Approved | Approved |
| diagram-008-flowchart | flowchart | Approved | Approved |
| diagram-009-flowchart | flowchart | Approved | Approved |
| diagram-010-flowchart | flowchart | Approved | Approved |
| diagram-011-flowchart | flowchart | Approved | Approved |
| diagram-012-flowchart | flowchart | Approved | Approved |
| diagram-013-flowchart | flowchart | Approved | Approved |
| diagram-014-flowchart | flowchart | Approved | Approved |
| diagram-015-flowchart | flowchart | Approved | Approved |
| diagram-016-flowchart | flowchart | Approved | Approved |
| diagram-017-flowchart | flowchart | Approved | Approved |
| diagram-018-flowchart | flowchart | Approved | Approved |
| diagram-019-flowchart | flowchart | Approved | Approved |
| diagram-020-flowchart | flowchart | Approved | Approved |
| diagram-021-flowchart | flowchart | Approved | Approved |
| diagram-022-flowchart | flowchart | Approved | Approved |
| diagram-023-flowchart | flowchart | Approved | Approved |
| diagram-024-flowchart | flowchart | Approved | Approved |
| diagram-025-flowchart | flowchart | Approved | Approved |
| diagram-026-sequence | sequence | Approved | Approved |
| diagram-027-sequence | sequence | Approved | Approved |
| diagram-028-sequence | sequence | Approved | Approved |
| diagram-029-sequence | sequence | Approved | Approved |
| diagram-030-sequence | sequence | Approved | Approved |
| diagram-031-sequence | sequence | Approved | Approved |
| diagram-032-sequence | sequence | Approved | Approved |
| diagram-033-sequence | sequence | Approved | Approved |
| diagram-034-sequence | sequence | Approved | Approved |
| diagram-035-sequence | sequence | Approved | Approved |
| diagram-036-sequence | sequence | Approved | Approved |
| diagram-037-sequence | sequence | Approved | Approved |
| diagram-038-sequence | sequence | Approved | Approved |
| diagram-039-sequence | sequence | Approved | Approved |
| diagram-040-sequence | sequence | Approved | Approved |
| diagram-041-sequence | sequence | Approved | Approved |
| diagram-042-sequence | sequence | Approved | Approved |
| diagram-043-sequence | sequence | Approved | Approved |
| diagram-044-sequence | sequence | Approved | Approved |
| diagram-045-sequence | sequence | Approved | Approved |
| diagram-046-state | state | Approved | Approved |
| diagram-047-state | state | Approved | Approved |
| diagram-048-state | state | Approved | Approved |
| diagram-049-state | state | Approved | Approved |
| diagram-050-state | state | Approved | Approved |
| diagram-051-state | state | Approved | Approved |
| diagram-052-state | state | Approved | Approved |
| diagram-053-state | state | Approved | Approved |
| diagram-054-state | state | Approved | Approved |
| diagram-055-state | state | Approved | Approved |
| diagram-056-state | state | Approved | Approved |
| diagram-057-state | state | Approved | Approved |
| diagram-058-state | state | Approved | Approved |
| diagram-059-state | state | Approved | Approved |
| diagram-060-state | state | Approved | Approved |
| diagram-061-state | state | Approved | Approved |
| diagram-062-state | state | Approved | Approved |
| diagram-063-state | state | Approved | Approved |
| diagram-064-state | state | Approved | Approved |
| diagram-065-state | state | Approved | Approved |
| diagram-066-class | class | Approved | Approved |
| diagram-067-class | class | Approved | Approved |
| diagram-068-class | class | Approved | Approved |
| diagram-069-class | class | Approved | Approved |
| diagram-070-class | class | Approved | Approved |
| diagram-071-class | class | Approved | Approved |
| diagram-072-class | class | Approved | Approved |
| diagram-073-class | class | Approved | Approved |
| diagram-074-class | class | Approved | Approved |
| diagram-075-class | class | Approved | Approved |
| diagram-076-class | class | Approved | Approved |
| diagram-077-class | class | Approved | Approved |
| diagram-078-class | class | Approved | Approved |
| diagram-079-class | class | Approved | Approved |
| diagram-080-class | class | Approved | Approved |
| diagram-081-class | class | Approved | Approved |
| diagram-082-class | class | Approved | Approved |
| diagram-083-class | class | Approved | Approved |
| diagram-084-class | class | Approved | Approved |
| diagram-085-class | class | Approved | Approved |
| diagram-086-er | er | Approved | Approved |
| diagram-087-er | er | Approved | Approved |
| diagram-088-er | er | Approved | Approved |
| diagram-089-er | er | Approved | Approved |
| diagram-090-er | er | Approved | Approved |
| diagram-091-er | er | Approved | Approved |
| diagram-092-er | er | Approved | Approved |
| diagram-093-er | er | Approved | Approved |
| diagram-094-er | er | Approved | Approved |
| diagram-095-er | er | Approved | Approved |
| diagram-096-er | er | Approved | Approved |
| diagram-097-er | er | Approved | Approved |
| diagram-098-er | er | Approved | Approved |
| diagram-099-er | er | Approved | Approved |
| diagram-100-er | er | Approved | Approved |

## Additional outcomes

| Input | Light | Dark |
| --- | --- | --- |
| Parallel edges and self-loop | Approved | Approved |
| Unicode and explicit multiline | Approved | Approved |
| 30-node LR chain | Correct; viewport readability limitation | Correct; viewport readability limitation |
| 12-way fan-out | Design finding 1 | Design finding 1 |
| Eight-node, 28-edge mesh | Design finding 3 | Design finding 3 |
| Long sentence label | Design finding 2 | Design finding 2 |
| Shell architecture example | Approved | Approved |

The transparent scale-2 output is approved. Invalid-input and budget-error outcomes behaved as expected. Temporary logs, render outputs, and generation scripts were purged after review in accordance with workspace instructions.
