# Shared chart drawing evidence

The 42 records selected from `upstream-api-inventory.json` by the fill, line,
effect and ColorFormat families were reviewed, including underscore-prefixed
returned types and inherited members. The test inventory contains 186 DrawingML
unit cases; the existing drawing case ledger retains exact case identities.
This receipt adds tests, without counting the historical reference passes as
product passes or claiming all chart owners are integrated.

The existing shared implementation covers this complete selected member list:

| Interface | Getters/setters, methods, defaults |
| --- | --- |
| ColorFormat | `type` readonly null or enum; `rgb` read/write RGBColor, unavailable read fails; `theme_color` read/write enum, non-theme returns NOT_THEME_COLOR, absent read fails; `brightness` read/write finite [-1,1], absent read 0, absent-color write fails |
| FillFormat | `type` readonly null/inherited or fill enum; `solid()`, `background()`, `gradient()`, `patterned()` change choice; `fore_color` readonly for solid/pattern, pattern creates black when missing; `back_color` readonly for pattern, creates white when missing; `pattern` nullable read/write enum; `gradient_angle` nullable read/write counterclockwise degrees, default gradient 90; `gradient_stops` readonly collection, absent list creates two theme accent1 endpoints |
| GradientStop | `color` readonly color interface; `position` read/write finite [0,1]; inherited `element` readonly bounded mutable XML view; inherited equality maps to `equals(other)` comparing current owned elements |
| GradientStops | numeric index / `at(index)`, readonly `length`, iteration, `includes`, `count`, `index(value,start=0,stop=length)`, `reversed`; negative indexing allowed; replacement/deletion forbidden; membership and search use element equality |
| LineFormat | `fill` readonly; `color` readonly creates solid if needed; `width` read/write Length or null, missing reads zero; `dash_style` nullable read/write enum, null clears preset/custom dash |
| ShadowFormat | `inherit` read/write boolean, true for absent local effect list/DAG; false creates empty effects; true removes empty effects; unsupported nonempty effects reject destructive inheritance edits |

Each of these six types has a constructor inventory entry. Returned live
interfaces use bound domain owners; raw dependency-library constructors are not
public host/XML capabilities. Inherited stop members remain public regardless
of underscore spelling in source inventory.

All 54 pattern tokens and 11 operation dash tokens remain declaratively
registered. The model uses its documented numeric enum mappings rather than
accepting arbitrary XML names. Default gradient transforms remain accent1 with
first tint/shade/saturation 100000/100000/130000 and second
50000/100000/350000. A path gradient has no linear-angle accessor. Existing
brightness/color tests cover six XML color representations without flattening
theme or system colors. Alpha is a nullable model extension in [0,1].

Operation angles are clockwise; model angles are counterclockwise; both map to
60,000ths of a degree with modulo normalization. Model stop position edits do
not impose the operation builder's complete-gradient endpoints/order policy.
The latter accepts >=2 ordered stops with 0/1 endpoints. Readonly inspection
never calls creating model getters. XML view edits use the shared bounded XML
owner engine; no host I/O, native code, implicit network, time or renderer is
introduced. Stale views fail instead of retargeting another node.

Changes reuse the presentation drawing domain for Transitional and Strict chart
namespaces, and read line width through that domain rather than shape geometry.
Three original tests first failed with rejected chart namespaces and absent
stop equality, then passed. Drawing-format/accounting/preservation/reuse checks:
121 drawing tests passed (including the additional imported-stop preservation case). Package lint result is recorded by the parent delivery receipt.
Existing historical drawing ledger labels remain historical; this receipt
supersedes its missing stop equality/element statement for bound shape owners.

The [42 exact member dispositions](drawing-chart-api-dispositions.json) retain
source getter/setter signatures, declaring types, current target signatures,
defaults, effects, exceptions and original test references. This also corrects
historical ledger drift: ColorFormat type/theme values are numeric enums, not
strings; stop lookup includes numeric indexing; index has start/stop bounds.
