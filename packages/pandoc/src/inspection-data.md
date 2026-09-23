# Bundled inspection data

`inspection-data.ts` contains static output from official Pandoc 3.11, captured
with `--list-highlight-languages`, `--print-default-template=html`,
`--print-default-data-file=abbreviations`, and `--print-highlight-style=STYLE`
for each name from `--list-highlight-styles`. No native executable is shipped
or invoked by the product. Assets are inspection data, not writer capabilities.

Development oracle: https://github.com/jgm/pandoc/releases/download/3.11/pandoc-3.11-arm64-macOS.zip

Archive SHA-256: `15806bedf9517bfead72e88fe6a6696635c3691efbb6e152173440e9c5bb50b4`.
The four originally reported asset outputs also match the native captures in
issue 426. Bash completion is generated independently from the TypeScript help
and configured format registry, so it does not advertise native-only options.

HTML templates: https://github.com/jgm/pandoc-templates/tree/3.11

Highlighting definitions: https://github.com/jgm/skylighting

The upstream BSD notices for templates and Skylighting are retained in the
source header and emitted JavaScript. Abbreviations and language identifiers
are factual lists. Only the two documented textual data-file names are bundled;
no ambient filesystem fallback or native reference archives are available.
