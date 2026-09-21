# Gnumeric XML codecs verification

Execute as an agent. Root owns integration, exports and Git. A separate agent
stress tests the implementation after the first passing regression. Preserve
existing edits; do not push, publish or edit README files. Source and temporary
captures stay in `out/gnumeric-xml-codecs`; unit fixtures are original, small and
in memory, using memfs for file operations. Native tools are separate QA only.

1. Authenticate the official 1.12.61 archive against SHA-256
   `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
   Read every node in `gnumeric_1_0_dtd`, every handler's attribute comparisons,
   and every writer emission, including delegated GOffice/libgsf/object readers.
   Record delegated and unmeasured cases explicitly in the coverage register.
2. Reproduce the missing plain/gzip reader with a failing original sparse fixture
   through the SDK engine. Inspect calculation, dimensions, namespace, Unicode,
   sparse coordinates, formula cache and merge data independently of cell CSV.
3. Capture oracle image/binary/dependency/plugin/locale identities. Use explicit
   invocation-owned HOME/XDG paths, C locale, UTC, memory GSettings and the
   reference schema path. Preserve argv, status and both channels. Separate
   infrastructure warnings from workbook warnings without suppressing either.
4. Compare compressed/uncompressed native exports after decompression. Test
   XML serialization deterministically with injected clock; measure full gzip
   headers separately. Reimport uncompressed output and inspect each non-cell
   surface. Measure unknown elements/attributes and formula-cache loss directly.
5. Exercise style/font/borders, validation, conditional styles, hyperlinks,
   rich strings, print settings, axes, selection/freeze panes, solver, scenarios,
   metadata, names, sheet order and object records. Distinguish faithful retained
   XML from native normalization and SDK-edit behavior. No unsupported or
   unmeasured element is a pass.
6. Stress invalid XML, external entities, gzip bombs/truncation, namespace
   rebinding, aliases, duplicate cells, shared/array formulas, cancellation,
   output budgets and namespace preservation. Independent agent validates each
   repair with a failing test before fixing it.
7. Run maintained uncached selected-workspace build/test/lint, Safe Bash command
   integration and cross-workspace checks covering dependency/public exports.
   Inspect a screenshot if CLI display changes. Record failures and remaining
   mismatches accurately; purge only task-owned temporary captures after reduction.
