# Excel 2003 XML spreadsheets

Open SpreadsheetML workbooks without including other spreadsheet formats:

```ts
import { createEngine } from "poe-code/ssconvert/core";
import { spreadsheetmlFormat } from "poe-code/ssconvert/formats/spreadsheetml";

const engine = createEngine({ formats: [spreadsheetmlFormat] });
```

The same entrypoints are available under `@poe-platform/safe-bash/ssconvert`.
This format reads Excel 2003 XML (`.xml`) with the
`Gnumeric_Excel:excel_xml` service. It does not write SpreadsheetML; select an
additional output format when converting. It is separate from `.xlsx` and
binary `.xls` support. The engine registers no formats by default.

The private workspace owns the reader, metadata parser, schema and format
registration. Public packages bundle it with its license; consumers do not
install the private workspace separately.
