Graph export admission, anchor ordering, target identity and failure behavior
implement reviewed Gnumeric 1.12.61 and GOffice 0.10.61 behavior. The exact
archives, source-member hashes, native dependency/plugin/locale profile, measured
coverage and remaining mismatches are recorded in
`docs/ssconvert/graph-image-exports-verification.json`. See the package LICENSE
and original upstream source headers.

Behavioral sources include Gnumeric `src/ssconvert.c` (Copyright 2002-2003 Jody
Goldberg; 2006-2018 Morten Welinder), `src/sheet-object.c`,
`src/sheet-object-graph.c`, `src/xml-sax-read.c`, GOffice
`goffice/utils/go-image.c` (Copyright 2004-2005 Jody Goldberg),
`goffice/graph/gog-renderer.c` (Copyright 2003-2004 Jody Goldberg), and
`goffice/graph/gog-graph.c`.

PNG, PDF, PostScript/EPS, BMP, ICO and TIFF encoders emit their declared image
formats in JavaScript. JPEG uses jpeg-js 0.4.4 (BSD-3-Clause). Native utilities
are QA oracles only. Metafile targets preserve the pinned native unsupported
save outcome. The built-in graph scene producer supports genuinely empty graphs
and explicitly configured opaque solid backgrounds with disabled outlines;
plot scenes and other paints need an injected JavaScript scene producer. This is an
explicit remaining implementation gap, not native unsupported-target parity.
