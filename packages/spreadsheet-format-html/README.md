# HTML spreadsheet tables

Read HTML tables and export spreadsheets as HTML or XHTML without including
other spreadsheet formats:

```ts
import { createEngine } from "poe-code/ssconvert/core";
import { htmlFormat } from "poe-code/ssconvert/formats/html";

const engine = createEngine({ formats: [htmlFormat] });
```

The same entrypoints are available under `@poe-platform/safe-bash/ssconvert`.
The engine has no formats by default; select additional modules for conversion
to CSV, XLSX or other formats.

- Read `.html` and `.htm` tables with `Gnumeric_html:html`.
- Write HTML 3.2, HTML 4.0 or XHTML documents with `Gnumeric_html:html32`,
  `Gnumeric_html:html40` or `Gnumeric_html:xhtml`.
- Write table fragments with `Gnumeric_html:html40frag`, or an XHTML range with
  `Gnumeric_html:xhtml_range`.

Table import reads data without running scripts or fetching linked resources.
This is a spreadsheet table converter; it does not render webpages. Selecting
HTML does not register LaTeX or roff exporters. Existing format fidelity and
resource-limit contracts apply.
