# Independent clipboard stress procedure

This procedure is executed manually by a different agent from the integration owner. Root retains exports, integration, Git and maintained-gate ownership. No native process is a product dependency. No README was edited.

1. Read root and safe-bash AGENTS, inspect current clipboard serializers, and audit `gui_clipboard_test`, `x_clipboard_get_cb`, `table_cellregion_write`, `image_write`, `object_write`, clipboard copy and native XML serialization in the authenticated 1.12.61 source under `out/ssconvert-lifecycle/gnumeric-1.12.61`.
2. Create original tiny XML fixtures only under `out/ssconvert-clipboard-current`. Invoke the separate Docker oracle, with `LC_ALL=C`, `GSETTINGS_BACKEND=memory`, `GSETTINGS_SCHEMA_DIR=/out/ssconvert-statistics-oracle/prefix/share/glib-2.0/schemas`, no DISPLAY, and binary `/out/ssconvert-statistics-oracle/prefix/bin/ssconvert` in `ssconvert-statistics-qa`. Docker endpoint is `unix:///Users/kjopek/.colima/default/docker.sock`.
3. For each concrete discrepancy add a failing regression using the injected engine and memfs before changing source. Unit tests do not spawn utilities or create files. Preserve the failing execution separately from the passing run.
4. Compare independently ordered merges, an explicitly existing blank cell, an absent adjacent cell, and a contained comment requested as an image. Use unsupported `text/rtf` as a MIME negative control. Inspect native bytes and statuses, rather than inferring expectations from the implementation.
5. Run the three focused clipboard suites after repairs. Root runs the maintained uncached workspace gates against the final combined candidate. Record skips and unsupported cases separately, then remove only owned temporary fixtures/logs after root finishes evidence capture.

## Executed findings, September 21, 2026

- Native merge order is descending start row, then ascending start column, regardless of input XML order. The deliberately shuffled original fixture selected `A1:F5`; native order was `B4:C4`, `A2:B2`, `D2:E2`. The candidate initially retained import order. A failing memfs regression preceded sorting in `clipboardMerges`.
- An explicitly existing blank `A1` serializes as `<gnm:Cell Row="0" Col="0" ValueType="10"></gnm:Cell>`. An absent `B1` omits the Cells container. The candidate initially dropped both. A failing regression preceded retaining existing blank cells and requesting explicit empty content from the shared XML writer for clipboard cell entries. This also preserves native empty string cell content syntax.
- A contained `CellComment` requested as `image/png` returns status 0 and zero output bytes; its warning is `sheet_object_write_image: assertion 'GNM_IS_SO_IMAGEABLE (so)' failed`. The candidate initially returned unsupported-feature/status 1. A failing memfs regression preceded the native empty-image warning path. Source interface inspection also corrected component inclusion in imageable-object selection; this does not establish component export support.
- Native `text/rtf` negative control returned status 1 and exactly `Failed to get clipboard data.\n`. This is not an accepted rich-text MIME. Rich text belongs to native cell ValueFormat and table content, not an invented RTF serializer.

The first independent oracle invocation omitted the memory GSettings profile and produced configuration critical/warning noise. It was not used to claim clean diagnostics. Repeating the merge/blank fixture with the explicit memory profile produced no stderr and the same XML. The comment invocation used the explicit profile and produced only the expected imageability assertion warning.

## Verification accounting

- Red: both merge-order and existing-blank regressions failed before their repairs; the non-imageable-comment regression separately failed before its repair.
- Passed: 50 tests across `clipboard.test.ts`, `clipboard-objects.test.ts`, and `clipboard-lifecycle.test.ts` after all repairs, through a fresh focused Vitest run. These are focused semantic checks, not the maintained whole-workspace gate.
- Passed native independent semantic cells: merge ordering, existing blank serialization, non-imageable comment output/status, and rejected RTF status/diagnostic. Adjacent absent-cell behavior is verified by the memfs regression and source copy admission; it is not separately counted as a native differential invocation.
- Maintained lint/build/unit gates and original/checkpoint/replay integration: executed and reported by root against the final combined candidate; this agent does not claim their completion from a focused rerun.
- Skipped here: performance measurement, unrelated shell/realm matrix cells, deployed object-component interoperability, and screenshot capture. Root owns broader integration and visible CLI checks.

## Remaining mismatches and unsupported/unmeasured cells

- Root's current 26-target no-object census found five BIFF aliases with differing output: native 4608 bytes, candidate 5632 bytes. They are mismatches, despite matching successful statuses.
- Nonempty graph object serialization and graph raster/vector exports remain explicit unsupported product paths. Native accepts these targets; an empty-graph case does not certify general graph parity.
- Component object/image serialization remains unsupported or unmeasured. Correct object selection alone is not export parity. Non-PNG image transcoding and byte parity of JPEG raster encoding remain unverified; previously recorded BMP native padding behavior remains separately qualified.
- Array partial copies use native PASTE_AS_VALUES in table serializers; source audit confirms that the `not_as_contents && PASTE_CONTENTS` rejection does not apply to this table path. This observation is source evidence, not a newly executed differential pass for every array shape.
- No host clipboard or GUI display was acquired. Cancellation and budgets are covered by focused injected tests, but this is not arbitrary hostile host-JavaScript isolation certification.
