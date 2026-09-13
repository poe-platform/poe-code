# Chart font operation evidence

The typed bridge accepts fixed owners chart, legend, title, categoryAxisTitle,
valueAxisTitle, categoryTickLabels, valueTickLabels, dataLabels (plot), dataLabel
(series, point). It resolves through the live Chart graph and assigns the same
Font properties used by model callers; no evaluated path or method string exists.

| Documented member | Operation mapping | Null/default behavior |
| --- | --- | --- |
| bold | bold boolean | null clears local override |
| italic | italic boolean | null clears local override |
| name | name string | null clears; empty name rejected by shared font validator |
| size | explicit Length JSON | null clears; 1–4000 pt after shared unit conversion |
| underline | boolean or enum name | null clears; MIXED is return-only |
| language_id | languageId enum name | null or NONE clears; MIXED rejected |
| color (readonly returned interface) | color DrawingColor | explicit RGB/theme with brightness/alpha; cannot combine with fill |
| fill (readonly returned interface) | fill DrawingFill | shared fill choices, ordered gradient stops/angle, pattern colors and inheritance |

Returned Font constructors and inherited owner access stay live model behavior.
Omitted fields leave local declarations unchanged. Title owners use the first
rich-text paragraph's default font; legend/tick-label/plot-data-label fonts use
their documented text properties. Missing legend fails rather than manufacturing
one. Missing plot data labels fail through the model. Creating title/font getters
are used only by explicit mutation, after validation. Model snake_case remains
unchanged; camelCase operation JSON is a separate contract.

Shared `FillFormat.apply` uses the existing fill serializer/validation for an
owned property container, including arbitrary stop counts. It preserves text
property child ordering, with outline before fill and language/typeface metadata
after fill. Explicit default namespace binding handles imported subtree contexts.
No color resolution, host I/O or implicit network is introduced.

Twenty-one initial bridge tests cover nine owners, all setter fields, themed
brightness, a three-stop gradient, memfs persistence, nullable removals, invalid
selectors/values/conflicting paints and getter-descriptor rejection. They failed
before implementation, then passed. The separate shape-container regression
first failed before shared namespace admission was expanded, then passed. The
validator requires enumerable plain JSON data, dense plain arrays, no cycles or
accessors, and bounded nesting before calling any model getter. Enum strings are
mapped through existing enum families; return-only symbols cannot be assigned.
