# Drawing formatting draft usage

This bounded implementation belongs to `pptx`. Package release and complete object-model parity are separate work. The maintained schema describes executable option shapes; the examples below target the current working tree.

```sh
pptx shapes drawing get slides.pptx --slide 1 --shape Canopy --json
pptx shapes drawing set slides.pptx --slide 1 --shape Canopy --fill-kind solid --color '{"theme":"accent2","opacity":0.7}' --output painted.pptx
pptx shapes drawing set slides.pptx --slide 1 --shape Canopy --fill '{"kind":"gradient","angle":90,"stops":[{"position":0,"color":{"theme":"accent1"}},{"position":1,"color":"FFFFFF"}]}' --output painted.pptx
pptx shapes drawing set slides.pptx --slide 1 --shape Canopy --fill '{"kind":"pattern","preset":"cross","foreground":{"theme":"accent3"},"background":"FFFFFF"}' --output painted.pptx
pptx shapes effects set slides.pptx --slide 1 --shape Canopy --shadow true --shadow-blur 2pt --shadow-color '{"theme":"accent2"}' --opacity 0.5 --output shadowed.pptx
```

Colors in JSON use exactly six hexadecimal digits, or an explicit `rgb`/`theme` object. Theme slots remain references. `opacity` is a finite ratio from zero to one, where zero is transparent. `brightness` is a finite number from minus one to one. There is no host theme lookup or conversion of theme references to literal RGB.

`{"kind":"inherit"}` removes the local fill; `{"kind":"none"}` writes explicit no-fill. Those states remain distinct when reading. Gradient operation angles are clockwise degrees; the neutral model `gradient_angle` property uses counterclockwise degrees and normalizes whole revolutions. The operation subset requires sorted stops including positions zero and one. The live model preserves an existing empty stop list and permits individual stop edits within zero to one.

Picture fill accepts an existing admitted image relationship ID and `stretch` or `tile`. `--file PATH` admits image bytes through the explicit filesystem capability; the SDK accepts `image: BinaryInput`. PNG/JPEG input receives bounded structural checks, without native decoding or pixel-fidelity claims. An explicit crop requires finite ratios with positive remaining visible width and height. No ambient path or network access is inferred.

Simple shadows write zero-offset outer shadows with explicit blur, color and opacity. Complex effect graphs, unknown effects, scenes, materials and geometry are preserved. An attempted destructive replacement of unsupported shadow payload fails. Reading formatting does not resolve rendering, sample system colors, evaluate formulas, load fonts or call native software.

The model retains neutral spellings: `fill.solid()`, `fill.background()`, `fill.gradient()`, `fill.patterned()`, `fill.fore_color`, `fill.back_color`, `fill.gradient_angle`, `fill.gradient_stops`, `line.dash_style`, `line.width` and `shadow.inherit`. `MSO_FILL`, `MSO_LINE` and `MSO_PATTERN` retain documented numeric symbols and aliases. Operation JSON uses explicit XML pattern/dash tokens; it is a separate typed surface from the model enums.

Selection uses a fingerprinted location or one-based slide and scoped shape selector. Output, in-place, force and dry-run follow the common office contract. Invalid arguments remain structured errors. `schema` and `capabilities` report the bounded operation surfaces; support for these edits is not a claim of all chart/table/background owner APIs.
