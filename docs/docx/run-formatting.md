# Scoped run formatting

`runs set` and `formatDocumentRuns` apply the same scoped direct-formatting edit.
Use a paragraph/run ordinal pair, explicit all-selection in a story scope, or a
fingerprinted run/paragraph scalar-range token. Selection and publication use the
shared Office contracts. Text stays unchanged.

Supported properties are bold, italic, underline, strike, font slots and theme
references, size, RGB/theme color, highlight, baseline/superscript/subscript,
hidden text, RTL and language. Omission retains the direct value; null removes it;
false/default remains explicit. Character/paragraph styles, complex-script sizes
and flags, bidi/CJK language attributes and other unmodified direct properties
remain intact. Fonts and styles are not resolved or loaded.

Whole runs retain their structure. A partial range splits only when its direct
properties actually change. Plain text, tabs, breaks and special hyphens are
supported split content; partial runs containing comments, fields or opaque
objects reject. Adjacent selected simple runs merge only when direct properties,
style references and run metadata are semantically equivalent. Unselected runs,
markers, comments, unknown properties and differing style references prevent
merging. Removing a property is never equated with setting it false.

Changes report each changed selection and its resulting paragraph-relative
scalar range. Empty selections fail unless `allowEmpty` is explicit; unchanged
formatting reports no changed generation. Protected, signed, shared or affected
unsupported structures still reject. Untouched package parts retain their bytes.

The [task evidence](../plans/docx-scoped-run-formatting.md) records original
regressions, language/security mappings and checks. This is utility support only;
whole-run text assignment, the documented live model and typed batch execution
remain pending. The [API audit](upstream-api-audit.md) retains those coverage gaps.
