These TypeScript algorithms implement selected behavior from GOffice 0.10.61,
used with Gnumeric 1.12.61. They are distributed under GPL-2.0-or-later;
see the package LICENSE. The pinned archives and file hashes are recorded in
docs/ssconvert/chart-rendering-verification.json.

Behavioral sources:

- goffice/graph/gog-axis.c, Copyright (C) 2003-2004 Jody Goldberg.
- goffice/utils/go-geometry.c, Copyright (C) 2005 Emmanuel Pacaud.
- plugins/plot_pie/gog-pie.c, Copyright (C) 2003-2004 Jody Goldberg.
- goffice/utils/go-marker.c, Copyright (C) 2003-2007 Emmanuel Pacaud.
- goffice/graph/gog-chart-map.c, Copyright (C) 2006-2007 Emmanuel Pacaud.
- goffice/graph/gog-error-bar.c, Copyright (C) 2004 Jean Brefort.

Only explicit-bound axis transforms, marker paths, rotated rectangle/label
geometry, resolved single-ring pie wedges, Cartesian straight/step series paths,
and error-bar data bounds/Cartesian segments are implemented here. These modules do not
provide a complete GOffice renderer or establish complete chart parity.
