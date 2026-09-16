# Imported chart type evidence

All 73 numeric `XL_CHART_TYPE` entries in the retained API inventory are covered
by original XML cases, in both Strict and Transitional dialects. The test asserts
that its complete case-name set equals the public enum-name set; no creation
subset supplies that denominator. [Exact variant ledger](imported-chart-type-map.json)
retains every source ID and target enum mapping.

The new format-domain `readModelChartType(XmlPart)` returns the numeric enum
without mutation. It supports area/bar/line/pie 3D families, box/cone/cylinder/
pyramid variants, of-pie, stocks and surface families, along with existing 2D
families. First-series shape/marker/bubble declarations override plot defaults.
A stock plot with three/four price series maps to HLC/OHLC. A two-plot combination
with one single-series column plot plus that stock plot maps to volume variants;
this structural inference is explicit, not inferred from labels or data values.
Other combinations retain the first plot's classification. Invalid or unknown
required discriminators fail with neutral OfficeError; duplicate discriminator
nodes fail as invalid XML. Foreign namespace lookalikes are ignored.

## Documentation reconciliation

The [published chart-type analysis](https://python-pptx.readthedocs.io/en/latest/dev/analysis/cht-chart-type.html)
is incomplete for stock variants and reverses the surface family associations.
The implementation resolves that drift using the normative descriptions quoted
in Microsoft's SDK documentation: [surface3DChart](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.charts.surface3dchart?view=openxml-3.0.1)
contains 3D surface series; [surfaceChart](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.charts.surfacechart?view=openxml-3.0.1)
contains 2D contour charts. Thus surface3DChart maps to SURFACE and
surfaceChart maps to SURFACE_TOP_VIEW, with wireframe variants controlled by the
wireframe flag. This accords with the public enum descriptions. The analysis
notes are research evidence rather than an instruction to reproduce their typo.
Shape coneToMax/pyramidToMax preserve the corresponding cone/pyramid family;
these XML forms have no extra public enum names.

Tests first failed because the public model classifier was absent. After
implementation, 81 focused tests pass, including the complete 73-variant matrix,
first-series overrides, namespace isolation, duplicate properties and a hidden
connecting-line scatter representation. Existing chart reconstruction remains
restricted to its supported writable kinds; classification does not authorize
creation or reconstruction of every imported format. No host I/O, native runtime,
implicit network, renderer, reference names or downloaded fixtures enter product
code/tests. Research documentation links are evidence only.
