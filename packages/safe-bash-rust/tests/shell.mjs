import { createRustWasmBash } from "@poe-code/safe-bash-rust";

async function test() {
  const [shell, other] = await Promise.all([
    createRustWasmBash({ cwd: "/", files: { "/items": "z\na\na\n" }, symlinks: { "/alias": "/items" } }),
    createRustWasmBash({ cwd: "/" }),
  ]);
  try {
    if (shell.instance.exports.memory === other.instance.exports.memory) throw new Error("shared shell memory");
    const stat = await shell.fs.stat("/items"), alias = await shell.fs.stat("/alias");
    if (!stat.identityScope || stat.identityScope !== alias.identityScope || stat.ino !== alias.ino)
      throw new Error("alias lost the file identity");
    shell.register({ name: "records", async execute(ctx) {
      await ctx.stdout.write(await ctx.fs.readFile("/alias"));
      return { exitCode: 0 };
    } });
    const input = (async function* () { yield new TextEncoder().encode("b\n"); })();
    const result = await shell.exec("{ records; cat; } | LC_ALL=C sort | uniq", { stdin: input });
    if (result.exitCode || result.stderr || result.stdout !== "a\nb\nz\n") throw new Error(JSON.stringify(result));
    await shell.fs.writeFile("/source sheet.csv", "Name,Value,Total\nAda,2,=B2+3\n");
    const office = await shell.exec("soffice --convert-to xlsx --outdir /exports '/source sheet.csv' >/dev/null && libreoffice --convert-to csv --outdir /reopened '/exports/source sheet.xlsx' >/dev/null && cat '/reopened/source sheet.csv'");
    if (office.exitCode || office.stderr || office.stdout !== "Name,Value,Total\nAda,2,5\n") throw new Error(JSON.stringify(office));
    const table = await shell.exec("ssconvert -T Gnumeric_html:latex_table '/source sheet.csv' /table.csv && cat /table.csv");
    if (table.exitCode || table.stderr || !table.stdout.endsWith("Name\t&Value\t&Total\\\\\nAda\t&2\t&5\\\\\n")) throw new Error(JSON.stringify(table));
    const updated = await shell.exec("ssconvert --set 'B2=9' --set 'A2=25%' '/source sheet.csv' /updated.csv && cat /updated.csv");
    if (updated.exitCode || updated.stderr || updated.stdout !== "Name,Value,Total\n0.25,9,12\n") throw new Error(JSON.stringify(updated));
    const dates = await shell.exec("ssconvert --set 'A2==DATE(2024,1,1)' --set 'B2==DATE(2024,1,1)+0.5' '/source sheet.csv' /dates.csv && cat /dates.csv");
    if (dates.exitCode || dates.stderr || dates.stdout !== "Name,Value,Total\n2024/01/01,45292.5,45295.5\n") throw new Error(JSON.stringify(dates));
    await shell.fs.writeFile("/precision.csv", "Value,Result\n1.20,=A2*2\n2.30,=A3*2\n");
    const precision = await shell.exec("ssconvert -O format=preserve /precision.csv /preserved.csv && cat /preserved.csv");
    if (precision.exitCode || precision.stderr || precision.stdout !== "Value,Result\n1.20,2.4\n2.30,4.6\n") throw new Error(JSON.stringify(precision));
    for (const [encoding, bytes] of [
      ["ISO-8859-1", Uint8Array.of(67, 97, 102, 233, 10)],
      ["UTF-16LE", Uint8Array.of(67, 0, 97, 0, 102, 0, 233, 0, 10, 0)]
    ]) {
      await shell.fs.writeFile("/encoded.csv", bytes);
      const decoded = await shell.exec(`ssconvert -E ${encoding} /encoded.csv /decoded.csv && cat /decoded.csv`);
      if (decoded.exitCode || decoded.stderr || decoded.stdout !== "Café\n") throw new Error(JSON.stringify(decoded));
    }
    for (const extension of ["xlsx", "ods"]) {
      const imported = await shell.exec(`ssconvert --set 'A2=25%' '/source sheet.csv' /typed.${extension} && ssconvert --set 'B2=9' /typed.${extension} /imported.csv && cat /imported.csv`);
      if (imported.exitCode || imported.stderr || imported.stdout !== "Name,Value,Total\n0.25,9,12\n") throw new Error(JSON.stringify(imported));
      const renamed = await shell.exec(`cp /typed.${extension} /renamed.bin && ssconvert --set 'B2=9' /renamed.bin /imported.csv && cat /imported.csv`);
      if (renamed.exitCode || renamed.stderr || renamed.stdout !== imported.stdout) throw new Error(JSON.stringify(renamed));
    }
    const importer = await shell.exec("ssconvert -I missing '/source sheet.csv' /imported.csv");
    if (importer.exitCode !== 1 || importer.stderr !== "Unknown importer 'missing'.\nTry --list-importers to see a list of possibilities.\n") throw new Error(JSON.stringify(importer));
    const dif = await shell.exec("ssconvert '/source sheet.csv' /sheet.dif && ssconvert /sheet.dif /imported.csv && cat /imported.csv");
    if (dif.exitCode || dif.stderr || dif.stdout !== "Name,Value,Total\nAda,2,5\n") throw new Error(JSON.stringify(dif));
    await shell.fs.writeFile("/sheet.slk", 'ID;PExample\nP;P0.00\nF;X1;Y1;P0\nC;K7\nC;X2;K99;ERC[-1]+1\nE\n');
    for (const [args, expected] of [["", "7.00,99\n"], ["--recalc", "7.00,8\n"]]) {
      const sylk = await shell.exec(`ssconvert ${args} -O format=preserve /sheet.slk /sylk.csv && cat /sylk.csv`);
      if (sylk.exitCode || sylk.stdout !== expected || sylk.stderr !== "1:Unknown directive 'ID;PExample'\n") throw new Error(JSON.stringify(sylk));
    }
    await shell.fs.writeFile("/full.slk", 'ID;PExample\nP;P0.00\nF;D0L;P0\nC;X1;Y1;K7\nE\n');
    const fullStyle = await shell.exec("ssconvert /full.slk /full.ods && unzip -p /full.ods content.xml");
    if (fullStyle.exitCode || fullStyle.stderr !== "1:Unknown directive 'ID;PExample'\n" ||
        !fullStyle.stdout.includes('table:number-rows-repeated="65535"') ||
        !fullStyle.stdout.includes('table:style-name="ce0" table:number-columns-repeated="256"')) throw new Error(JSON.stringify(fullStyle));
    const fullXlsx = await shell.exec("ssconvert /full.slk /full.xlsx && ssconvert -O format=preserve /full.xlsx /full.csv && cat /full.csv");
    if (fullXlsx.exitCode || fullXlsx.stdout !== "7.00\n" || fullXlsx.stderr !== "1:Unknown directive 'ID;PExample'\n") throw new Error(JSON.stringify(fullXlsx));
    const sylkExport = await shell.exec("ssconvert '/source sheet.csv' /export.slk && cat /export.slk");
    if (sylkExport.exitCode || sylkExport.stderr || !sylkExport.stdout.startsWith("ID;PGnumeric;N;E\r\n") ||
        !sylkExport.stdout.includes("C;X3;K5;ERC[-1]+3\r\n")) throw new Error(JSON.stringify(sylkExport));
    const gnumeric = await shell.exec("ssconvert '/source sheet.csv' /export.xml && cat /export.xml");
    if (gnumeric.exitCode || gnumeric.stderr || !gnumeric.stdout.startsWith('<?xml version="1.0" encoding="UTF-8"?>') ||
        !gnumeric.stdout.includes('<gnm:Cell Row="1" Col="2">=B2+3</gnm:Cell>')) throw new Error(JSON.stringify(gnumeric));
    const compressed = await shell.exec("ssconvert '/source sheet.csv' /export.gnumeric && gzip -dc /export.gnumeric");
    if (compressed.exitCode || compressed.stderr || compressed.stdout !== gnumeric.stdout) throw new Error(JSON.stringify(compressed));
    for (const extension of ["xml", "gnumeric"]) {
      const imported = await shell.exec(`ssconvert /export.${extension} /xml-import.csv && cat /xml-import.csv`);
      if (imported.exitCode || imported.stderr || imported.stdout !== "Name,Value,Total\nAda,2,5\n") throw new Error(JSON.stringify(imported));
    }
    await shell.fs.writeFile("/legacy.xml", '<gmr:Workbook xmlns:gmr="http://www.gnome.org/gnumeric/v3"><gmr:Sheets><gmr:Sheet><gmr:Name>Data</gmr:Name><gmr:Styles><gmr:StyleRegion startRow="0" startCol="0" endRow="0" endCol="1"><gmr:Style Format="0.00"><gmr:Font Bold="1">Sans</gmr:Font></gmr:Style></gmr:StyleRegion><gmr:StyleRegion startRow="0" startCol="0" endRow="0" endCol="1"><gmr:Style><gmr:Font Italic="1"/></gmr:Style></gmr:StyleRegion></gmr:Styles><gmr:Cells><gmr:Cell Row="0" Col="0" ValueType="40">2.5</gmr:Cell></gmr:Cells></gmr:Sheet></gmr:Sheets></gmr:Workbook>');
    const legacy = await shell.exec("ssconvert /legacy.xml /modern.xml && ssconvert --set B1=9.5 /modern.xml /legacy.xlsx && ssconvert -O format=preserve /legacy.xlsx /legacy.csv && cat /legacy.csv");
    if (legacy.exitCode || legacy.stderr || legacy.stdout !== "2.50,9.5\n") throw new Error(JSON.stringify(legacy));
    await shell.fs.writeFile("/diagonal.xml", '<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>Data</g:Name><g:Styles><g:StyleRegion startRow="0" startCol="0" endRow="0" endCol="0"><g:Style><g:StyleBorder><g:Diagonal Style="1" Color="FFFF:0:0"/><g:Rev-Diagonal Style="2" Color="0:0:FFFF"/></g:StyleBorder></g:Style></g:StyleRegion></g:Styles><g:Cells><g:Cell Row="0" Col="0" ValueType="40">2.5</g:Cell></g:Cells></g:Sheet></g:Sheets></g:Workbook>');
    for (const edition of ["xlsx", "xlsx2"]) {
      const diagonal = await shell.exec(`ssconvert -T Gnumeric_Excel:${edition} /diagonal.xml /diagonal.xlsx && unzip -p /diagonal.xlsx xl/styles.xml`);
      if (diagonal.exitCode || diagonal.stderr || !diagonal.stdout.includes('diagonalUp="1" diagonalDown="1"') ||
          !diagonal.stdout.includes('<diagonal style="thin"><color rgb="FFFF0000"/></diagonal>') ||
          !diagonal.stdout.includes('<diagonal style="medium"><color rgb="FF0000FF"/></diagonal>')) throw new Error(JSON.stringify(diagonal));
    }
    await shell.fs.writeFile("/validation.xml", '<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>Data</g:Name><g:Styles><g:StyleRegion startRow="0" startCol="0" endRow="2" endCol="0"><g:Style><g:Validation Type="GNM_VALIDATION_TYPE_AS_INT" Operator="GNM_VALIDATION_OP_BETWEEN" Style="GNM_VALIDATION_STYLE_WARNING" AllowBlank="1" UseDropdown="1"><g:Expression0>1</g:Expression0><g:Expression1>9</g:Expression1></g:Validation><g:InputMessage Title="Hint" Message="Choose a number"/></g:Style></g:StyleRegion></g:Styles><g:Cells><g:Cell Row="0" Col="0" ValueType="40">2.5</g:Cell></g:Cells></g:Sheet></g:Sheets></g:Workbook>');
    for (const edition of ["xlsx", "xlsx2"]) {
      const validation = await shell.exec(`ssconvert -T Gnumeric_Excel:${edition} /validation.xml /validation.xlsx && ssconvert --set A1=7 /validation.xlsx /retained.xlsx && unzip -p /retained.xlsx xl/worksheets/sheet1.xml`);
      if (validation.exitCode || validation.stderr || !validation.stdout.includes('<dataValidations count="1"><dataValidation type="whole" errorStyle="warning" allowBlank="1" showDropDown="0" showInputMessage="1" showErrorMessage="1" promptTitle="Hint" prompt="Choose a number" sqref="A1:A3"><formula1>1</formula1><formula2>9</formula2></dataValidation></dataValidations>')) throw new Error(JSON.stringify(validation));
    }
    await shell.fs.writeFile("/conditional.xml", '<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>Data</g:Name><g:Styles><g:StyleRegion startRow="0" startCol="0" endRow="2" endCol="0"><g:Style><g:Condition Operator="4"><g:Expression0>1</g:Expression0><g:Style Back="FFFF:0:0" Shade="1"><g:Font Bold="1"/></g:Style></g:Condition></g:Style></g:StyleRegion></g:Styles><g:Cells><g:Cell Row="0" Col="0" ValueType="40">2.5</g:Cell></g:Cells></g:Sheet></g:Sheets></g:Workbook>');
    for (const edition of ["xlsx", "xlsx2"]) {
      const conditional = await shell.exec(`ssconvert -T Gnumeric_Excel:${edition} /conditional.xml /conditional.xlsx && ssconvert --set A1=7 /conditional.xlsx /retained.xlsx && unzip -p /retained.xlsx xl/worksheets/sheet1.xml && unzip -p /retained.xlsx xl/styles.xml`);
      if (conditional.exitCode || conditional.stderr || !conditional.stdout.includes('<conditionalFormatting sqref="A1:A3"><cfRule type="cellIs" dxfId="0" priority="1" stopIfTrue="1" operator="greaterThan"><formula>1</formula></cfRule></conditionalFormatting>') || !conditional.stdout.includes('<dxfs count="1"><dxf><fill><patternFill patternType="solid"><bgColor rgb="FFFF0000"/></patternFill></fill><font><b val="1"/></font></dxf></dxfs>')) throw new Error(JSON.stringify(conditional));
    }
    await shell.fs.writeFile("/breaks.xml", '<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>Data</g:Name><g:PrintInformation><g:hPageBreaks><g:break pos="3" type="manual"/></g:hPageBreaks><g:vPageBreaks><g:break pos="7" type="data-slice"/></g:vPageBreaks></g:PrintInformation><g:Cells><g:Cell Row="0" Col="0" ValueType="40">2.5</g:Cell></g:Cells></g:Sheet></g:Sheets></g:Workbook>');
    for (const edition of ["xlsx", "xlsx2"]) {
      const breaks = await shell.exec(`ssconvert -T Gnumeric_Excel:${edition} /breaks.xml /breaks.xlsx && ssconvert --set A1=7 /breaks.xlsx /retained.xlsx && unzip -p /retained.xlsx xl/worksheets/sheet1.xml`);
      if (breaks.exitCode || breaks.stderr || !breaks.stdout.includes('<rowBreaks count="1"><brk id="3" max="16383" man="1"/></rowBreaks><colBreaks count="1"><brk id="7" max="1048575" pt="1"/></colBreaks>')) throw new Error(JSON.stringify(breaks));
    }
    await shell.fs.writeFile("/print.xml", '<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>Data</g:Name><g:PrintInformation><g:titles value="1"/><g:grid value="1"/><g:hcenter value="1"/><g:vcenter value="1"/><g:paper>na_letter</g:paper><g:orientation>landscape</g:orientation><g:first_page_number value="7"/><g:Scale type="fit" rows="3" cols="2" percentage="72.5"/></g:PrintInformation><g:Cells><g:Cell Row="0" Col="0" ValueType="40">2.5</g:Cell></g:Cells></g:Sheet></g:Sheets></g:Workbook>');
    for (const edition of ["xlsx", "xlsx2"]) {
      const print = await shell.exec(`ssconvert -T Gnumeric_Excel:${edition} /print.xml /print.xlsx && ssconvert --set A1=7 /print.xlsx /retained.xlsx && unzip -p /retained.xlsx xl/worksheets/sheet1.xml`);
      if (print.exitCode || print.stderr || !print.stdout.includes('<printOptions headings="1" gridLines="1" horizontalCentered="1" verticalCentered="1"/>') || !print.stdout.includes('fitToHeight="3" fitToWidth="2" orientation="landscape" pageOrder="downThenOver" paperSize="1" scale="72.5" firstPageNumber="7" useFirstPageNumber="1"')) throw new Error(JSON.stringify(print));
    }
    await shell.fs.writeFile("/view.xml", '<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet DisplayFormulas="1" HideGrid="1" HideZero="-0" RTL_Layout="1"><g:Name>Data</g:Name><g:Zoom>1.25</g:Zoom><g:Cells><g:Cell Row="0" Col="0" ValueType="40">2.5</g:Cell></g:Cells></g:Sheet></g:Sheets></g:Workbook>');
    for (const edition of ["xlsx", "xlsx2"]) {
      const view = await shell.exec(`ssconvert -T Gnumeric_Excel:${edition} /view.xml /view.xlsx && ssconvert --set A1=7 /view.xlsx /retained.xlsx && unzip -p /retained.xlsx xl/worksheets/sheet1.xml`);
      if (view.exitCode || view.stderr || !view.stdout.includes('<sheetView workbookViewId="0" zoomScale="125" tabSelected="1" showFormulas="1" showZeros="1" showGridLines="0" rightToLeft="1">')) throw new Error(JSON.stringify(view));
    }
    const unpacked = await shell.exec("mkdir /format; unzip -q /view.xlsx -d /format");
    if (unpacked.exitCode || unpacked.stderr) throw new Error(JSON.stringify(unpacked));
    const sheetPath = "/format/xl/worksheets/sheet1.xml";
    const format = '<sheetFormatPr baseColWidth="12" defaultRowHeight="15" customHeight="1" thickTop="1"/>';
    const worksheet = new TextDecoder().decode(await shell.fs.readFile(sheetPath));
    await shell.fs.writeFile(sheetPath, worksheet.replace('<sheetFormatPr defaultColWidth="9.142307692307693" defaultRowHeight="12.75"/>', format));
    const packed = await shell.exec("(cd /format && zip -qr /format.xlsx .)");
    if (packed.exitCode || packed.stderr) throw new Error(JSON.stringify(packed));
    for (const edition of ["xlsx", "xlsx2"]) {
      const retained = await shell.exec(`ssconvert -T Gnumeric_Excel:${edition} --set A1=7 /format.xlsx /retained.xlsx && unzip -p /retained.xlsx xl/worksheets/sheet1.xml`);
      if (retained.exitCode || retained.stderr || !retained.stdout.includes(format) || !retained.stdout.includes('min="257" max="16384" style="0" width="12.714242788461537"')) throw new Error(JSON.stringify(retained));
    }
    const workbookPath = "/format/xl/workbook.xml";
    const workbook = new TextDecoder().decode(await shell.fs.readFile(workbookPath));
    await shell.fs.writeFile(workbookPath, workbook.replace('</definedNames>', '<definedName name="Rate" localSheetId="0x0" xmlns:ssc="urn:poe-code:ssconvert:formulas:1" ssc:openformula="of:=[.A1]" ssc:openformula-origin="[&quot;Data&quot;,1,0]">$A$1</definedName></definedNames>'));
    await shell.fs.writeFile(sheetPath, worksheet.replace('</sheetData>', '<row r="2"><c r="A2"><f>Rate</f><v>99</v></c></row></sheetData>'));
    const namesPacked = await shell.exec("(cd /format && zip -qr /names.xlsx .)");
    if (namesPacked.exitCode || namesPacked.stderr) throw new Error(JSON.stringify(namesPacked));
    for (const edition of ["xlsx", "xlsx2"]) {
      const names = await shell.exec(`ssconvert -T Gnumeric_Excel:${edition} --recalc --set A1=7 /names.xlsx /retained.xlsx && unzip -p /retained.xlsx xl/workbook.xml`);
      if (names.exitCode || names.stderr || !names.stdout.includes('<definedName name="Rate" localSheetId="0" xmlns:ssc="urn:poe-code:ssconvert:formulas:1" ssc:openformula="of:=[.A1]" ssc:openformula-origin="[&quot;Data&quot;,1,0]"')) throw new Error(JSON.stringify(names));
      const values = await shell.exec("ssconvert /retained.xlsx /names.csv && cat /names.csv");
      if (values.exitCode || values.stderr || values.stdout !== "7\n7\n") throw new Error(JSON.stringify(values));
    }
    const calcStart = workbook.indexOf('<calcPr');
    const calcEnd = workbook.indexOf('/>', calcStart) + 2;
    await shell.fs.writeFile(workbookPath, workbook.slice(0, calcStart) + '<calcPr calcMode="manual" iterate="true" iterateCount="0x10" iterateDelta="0.25"/>' + workbook.slice(calcEnd));
    await shell.fs.writeFile(sheetPath, worksheet);
    const calcPacked = await shell.exec("(cd /format && zip -qr /calculation.xlsx .)");
    if (calcPacked.exitCode || calcPacked.stderr) throw new Error(JSON.stringify(calcPacked));
    for (const edition of ["xlsx", "xlsx2"]) {
      const settings = await shell.exec(`ssconvert -T Gnumeric_Excel:${edition} --set A1=7 /calculation.xlsx /retained.xlsx && unzip -p /retained.xlsx xl/workbook.xml`);
      if (settings.exitCode || settings.stderr || !settings.stdout.includes('<calcPr calcMode="manual" iterate="1" iterateCount="16" iterateDelta="0.25"/>')) throw new Error(JSON.stringify(settings));
    }
    const corePath = "/format/docProps/core.xml";
    const core = new TextDecoder().decode(await shell.fs.readFile(corePath));
    await shell.fs.writeFile(corePath, core.replace('/>', '><dc:title>Budget &amp; forecast</dc:title><cp:keywords>one  two</cp:keywords><cp:revision>001</cp:revision></cp:coreProperties>'));
    const propertiesPacked = await shell.exec("(cd /format && zip -qr /properties.xlsx .)");
    if (propertiesPacked.exitCode || propertiesPacked.stderr) throw new Error(JSON.stringify(propertiesPacked));
    for (const edition of ["xlsx", "xlsx2"]) {
      const properties = await shell.exec(`ssconvert -T Gnumeric_Excel:${edition} --set A1=7 /properties.xlsx /retained.xlsx && unzip -p /retained.xlsx docProps/core.xml`);
      if (properties.exitCode || properties.stderr || !properties.stdout.includes('<cp:keywords>one two</cp:keywords><dc:title>Budget &amp; forecast</dc:title><cp:revision>001</cp:revision>')) throw new Error(JSON.stringify(properties));
    }
    const metadata = await shell.exec("ssconvert /properties.xlsx /properties.xml && cat /properties.xml");
    if (metadata.exitCode || metadata.stderr || !metadata.stdout.includes('<meta:keyword>one</meta:keyword>') || !metadata.stdout.includes('<dc:title>Budget &amp; forecast</dc:title>')) throw new Error(JSON.stringify(metadata));
    await shell.fs.writeFile("/properties.xml", metadata.stdout.replace('<dc:title>Budget &amp; forecast</dc:title>', '<dc:title>Budget &amp; forecast</dc:title><meta:user-defined meta:name="project">Launch</meta:user-defined><meta:user-defined meta:name="gsf:page-count" meta:value-type="float">3</meta:user-defined><meta:user-defined meta:name="approved" meta:value-type="boolean">true</meta:user-defined><meta:user-defined meta:name="amount" meta:value-type="float">\ufeff7\ufeff</meta:user-defined><meta:user-defined meta:name="large" meta:value-type="float">0x100000000000000000</meta:user-defined>'));
    for (const edition of ["xlsx", "xlsx2"]) {
      const custom = await shell.exec(`ssconvert -T Gnumeric_Excel:${edition} --set A1=7 /properties.xml /retained.xlsx && unzip -p /retained.xlsx docProps/custom.xml && unzip -p /retained.xlsx docProps/app.xml`);
      if (custom.exitCode || !custom.stdout.includes('name="project"><vt:lpwstr>Launch</vt:lpwstr>') || !custom.stdout.includes('name="approved"><vt:bool>true</vt:bool>') || !custom.stdout.includes('<Pages>3</Pages>') || !custom.stdout.includes('name="amount"><vt:decimal>7</vt:decimal>') || !custom.stdout.includes('name="large"><vt:decimal>295147905179352830000</vt:decimal>')) throw new Error(JSON.stringify(custom));
    }
    const customXml = await shell.exec("ssconvert /properties.xml /retained.xml && cat /retained.xml");
    if (customXml.exitCode || !customXml.stdout.includes('<meta:user-defined meta:name="project" meta:value-type="string">Launch</meta:user-defined>')) throw new Error(JSON.stringify(customXml));
    await shell.exec("mkdir /odsprint");
    await shell.fs.writeFile("/odsprint/mimetype", "application/vnd.oasis.opendocument.spreadsheet");
    await shell.fs.writeFile("/odsprint/content.xml", '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"><office:automatic-styles><style:style style:name="Page" style:family="table" style:master-page-name="Master"/></office:automatic-styles><office:body><office:spreadsheet><table:table table:name="Sheet1" table:style-name="Page"><table:table-row><table:table-cell office:value-type="float" office:value="3"/></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>');
    await shell.fs.writeFile("/odsprint/styles.xml", '<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"><office:automatic-styles><style:page-layout style:name="Layout"><style:page-layout-properties style:print-orientation="landscape" fo:margin-left="0.5in" style:scale-to="80%"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Master" style:page-layout-name="Layout"/></office:master-styles></office:document-styles>');
    const odsPrintPacked = await shell.exec("(cd /odsprint && zip -qr /print.ods .)");
    if (odsPrintPacked.exitCode || odsPrintPacked.stderr) throw new Error(JSON.stringify(odsPrintPacked));
    for (const extension of ["xml", "gnumeric"]) {
      const print = await shell.exec(`ssconvert --set A1=9 /print.ods /print.${extension} && ${extension === "xml" ? "cat" : "gzip -dc"} /print.${extension}`);
      if (print.exitCode || print.stderr !== `Label ranges and automatic label lookup are omitted by Gnumeric_XmlIO:sax${extension === "xml" ? ":0" : ""}\n` || !print.stdout.includes('<gnm:orientation>landscape</gnm:orientation>') || !print.stdout.includes('<gnm:left Points="36" PrefUnit="cm"/>') || !print.stdout.includes('<gnm:Scale type="percentage" percentage="80"/>')) throw new Error(JSON.stringify(print));
    }
    const reopenedPrint = await shell.exec("ssconvert /print.xml /print-reopened.xml && cat /print-reopened.xml");
    if (reopenedPrint.exitCode || reopenedPrint.stderr || !reopenedPrint.stdout.includes('<gnm:left Points="36" PrefUnit="mm"/>')) throw new Error(JSON.stringify(reopenedPrint));
    const numericPrintStyles = new TextDecoder().decode(await shell.fs.readFile("/odsprint/styles.xml")).replace('style:scale-to="80%"', 'style:scale-to="\u00852\u0085%"');
    await shell.fs.writeFile("/odsprint/styles.xml", numericPrintStyles);
    const numericPrint = await shell.exec("(cd /odsprint && zip -qr /print-numeric.ods .) && ssconvert /print-numeric.ods /print-numeric.xlsx && unzip -p /print-numeric.xlsx xl/worksheets/sheet1.xml");
    if (numericPrint.exitCode || !numericPrint.stderr.startsWith("Label ranges and automatic label lookup are omitted by Gnumeric_Excel:xlsx2\n") || !numericPrint.stdout.includes('scale="NaN"')) throw new Error(JSON.stringify(numericPrint));
    const retainedPrint = await shell.exec("ssconvert /print-numeric.ods /print-retained.ods && unzip -p /print-retained.ods styles.xml");
    if (retainedPrint.exitCode || retainedPrint.stderr || retainedPrint.stdout.split('style:scale-to="\u00852\u0085%"').length !== 3) throw new Error(JSON.stringify(retainedPrint));
    const labelContent = new TextDecoder().decode(await shell.fs.readFile("/odsprint/content.xml"))
      .replace('<office:spreadsheet>', '<office:spreadsheet><table:calculation-settings table:automatic-find-labels="false"/>')
      .replace('</office:spreadsheet>', '<table:label-ranges><table:label-range table:label-cell-range-address="Sheet1.A1" table:data-cell-range-address="Sheet1.A4:.A70001" table:orientation="column"/></table:label-ranges></office:spreadsheet>');
    await shell.fs.writeFile("/odsprint/content.xml", labelContent);
    const labels = await shell.exec("(cd /odsprint && zip -qr /labels.ods .) && ssconvert --set A1=9 /labels.ods /labels-copy.ods && unzip -p /labels-copy.ods content.xml");
    if (labels.exitCode || labels.stderr || !labels.stdout.includes('table:data-cell-range-address="$\'Sheet1\'.$A$4:.$A$70001"')) throw new Error(JSON.stringify(labels));
    const omittedLabels = await shell.exec("ssconvert /labels-copy.ods /labels.xml");
    if (omittedLabels.exitCode || omittedLabels.stderr !== "Label ranges and automatic label lookup are omitted by Gnumeric_XmlIO:sax:0\n") throw new Error(JSON.stringify(omittedLabels));
    await shell.fs.writeFile("/odsprint/content.xml", labelContent.replace('table:orientation="column"', 'table:orientation="diagonal"'));
    const invalidLabels = await shell.exec("(cd /odsprint && zip -qr /invalid-labels.ods .) && ssconvert /invalid-labels.ods /invalid-labels.xml");
    if (invalidLabels.exitCode !== 1 || invalidLabels.stderr !== "E Invalid OpenDocument: invalid label range\n") throw new Error(JSON.stringify(invalidLabels));
    const formulaLabels = labelContent
      .replace('<table:table-cell office:value-type="float" office:value="3"/>', `<table:table-cell office:value-type="string" office:string-value="Sales"/><table:table-cell table:formula="of:=SUM('Sales')" office:value="999"/>`)
      .replace('</table:table>', '<table:table-row/><table:table-row/><table:table-row><table:table-cell office:value="2"/></table:table-row><table:table-row><table:table-cell office:value="3"/></table:table-row></table:table>');
    await shell.fs.writeFile("/odsprint/content.xml", formulaLabels);
    const labelValues = await shell.exec("(cd /odsprint && zip -qr /formula-labels.ods .) && ssconvert /formula-labels.ods /label-values.csv && cat /label-values.csv");
    if (labelValues.exitCode || labelValues.stderr !== "Label ranges and automatic label lookup are omitted by Gnumeric_stf:stf_csv\n" || labelValues.stdout !== "Sales,5\n,\n,\n2,\n3,\n") throw new Error(JSON.stringify(labelValues));
    const renamedLabel = await shell.exec(`ssconvert --set A4=9 --set A1=Revenue /formula-labels.ods /renamed-label.ods && unzip -p /renamed-label.ods content.xml`);
    if (renamedLabel.exitCode || renamedLabel.stderr || !renamedLabel.stdout.includes(`table:formula="of:=SUM('Revenue')" office:value-type="float" office:value="12"`)) throw new Error(JSON.stringify(renamedLabel));
    const rejectedLabel = await shell.exec("ssconvert /renamed-label.ods /label.xml");
    if (rejectedLabel.exitCode !== 1 || rejectedLabel.stderr !== "Label ranges and automatic label lookup are omitted by Gnumeric_XmlIO:sax:0\nUnsupported ssconvert feature: live label reference in Gnumeric output\n") throw new Error(JSON.stringify(rejectedLabel));
    const calcLabels = formulaLabels.slice(0, formulaLabels.indexOf("<office:body>")) + `<office:body><office:spreadsheet xmlns:oooc="http://openoffice.org/2004/calc"><table:calculation-settings table:automatic-find-labels="true"/><table:table table:name="Data"><table:table-row><table:table-cell office:value-type="string" office:string-value="Sales"/><table:table-cell office:value-type="float" office:value="2"/><table:table-cell/><table:table-cell office:value-type="float" office:value="3"/><table:table-cell office:value-type="float" office:value="7"/></table:table-row><table:table-row/><table:table-row/><table:table-row/><table:table-row><table:table-cell/><table:table-cell/><table:table-cell table:formula="oooc:=SUM('Sales')" office:value-type="float" office:value="999"/></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>`;
    await shell.fs.writeFile("/odsprint/content.xml", calcLabels);
    const calcValues = await shell.exec("(cd /odsprint && zip -qr /calc-labels.ods .) && ssconvert /calc-labels.ods /calc-values.csv && cat /calc-values.csv");
    if (calcValues.exitCode || calcValues.stderr !== labelValues.stderr || calcValues.stdout !== "Sales,2,,3,7\n,,,,\n,,,,\n,,,,\n,,2,,\n") throw new Error(JSON.stringify(calcValues));
    const editedCalc = await shell.exec("ssconvert --set B1=9 --set A1=Revenue /calc-labels.ods /calc-edited.csv && cat /calc-edited.csv");
    if (editedCalc.exitCode || editedCalc.stderr !== labelValues.stderr || editedCalc.stdout !== "Revenue,9,,3,7\n,,,,\n,,,,\n,,,,\n,,9,,\n") throw new Error(JSON.stringify(editedCalc));
    const calcExport = await shell.exec("ssconvert /calc-labels.ods /calc-copy.ods");
    if (calcExport.exitCode !== 1 || calcExport.stderr !== "Unsupported ssconvert feature: live label identity in OpenDocument output\n") throw new Error(JSON.stringify(calcExport));
    for (const label of ["@column:A$1", "@column.value.odf:A$1"]) {
      const reference = await shell.exec(`ssconvert --set 'B1==SUM(${label})' /formula-labels.ods /reference.csv && cat /reference.csv`);
      if (reference.exitCode || reference.stderr !== labelValues.stderr || reference.stdout !== labelValues.stdout) throw new Error(JSON.stringify(reference));
      const indirectRange = await shell.exec(`ssconvert --set 'B1==SUM(INDIRECT("(${label})"))' /formula-labels.ods /indirect-range.csv && cat /indirect-range.csv`);
      if (indirectRange.exitCode || indirectRange.stderr !== labelValues.stderr || indirectRange.stdout !== labelValues.stdout) throw new Error(JSON.stringify(indirectRange));
      const indirectScalar = await shell.exec(`ssconvert --set 'B4==SUM(INDIRECT("${label}"))' /formula-labels.ods /indirect-scalar.csv && cat /indirect-scalar.csv`);
      if (indirectScalar.exitCode || indirectScalar.stderr !== labelValues.stderr || indirectScalar.stdout !== "Sales,5\n,\n,\n2,2\n3,\n") throw new Error(JSON.stringify(indirectScalar));
    }
    const explicitRow = await shell.exec("ssconvert --set 'C5==SUM(@range:$A1->B1:E1)' /calc-labels.ods /explicit-row.csv && cat /explicit-row.csv");
    if (explicitRow.exitCode || explicitRow.stderr !== labelValues.stderr || explicitRow.stdout !== "Sales,2,,3,7\n,,,,\n,,,,\n,,,,\n,,12,,\n") throw new Error(JSON.stringify(explicitRow));
    const multipleLabels = await shell.exec("ssconvert --set 'B1==SUM(@range.array.multi:{C$1;A$1}->A2:A5)' /formula-labels.ods /multiple-labels.csv && cat /multiple-labels.csv");
    if (multipleLabels.exitCode || multipleLabels.stderr !== labelValues.stderr || multipleLabels.stdout !== labelValues.stdout) throw new Error(JSON.stringify(multipleLabels));
    const liveNamesXml = '<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Names><g:Name><g:name>Total</g:name><g:value>$A$1</g:value><g:position>C3</g:position></g:Name><g:Name><g:name>Nested</g:name><g:value>SUM(Total)</g:value></g:Name></g:Names><g:Sheets>' + ["Data", "Other"].map((name, index) => `<g:Sheet><g:Name>${name}</g:Name><g:Cells><g:Cell Row="0" Col="0" ValueType="40">${2 + 100 * index}</g:Cell><g:Cell Row="0" Col="1" ValueType="40">${7 + 100 * index}</g:Cell><g:Cell Row="1" Col="0" ValueType="40">${3 + 100 * index}</g:Cell><g:Cell Row="1" Col="1" ValueType="40">${11 + 100 * index}</g:Cell></g:Cells></g:Sheet>`).join("") + '</g:Sheets></g:Workbook>';
    await shell.fs.writeFile("/live-names.xml", liveNamesXml);
    const liveCopy = await shell.exec(`ssconvert --set 'C3:D4==@name.relative[0,0,0]:"Total"' /live-names.xml /live-copy.csv && cat /live-copy.csv`);
    if (liveCopy.exitCode || liveCopy.stderr || liveCopy.stdout !== "2,7,,\n3,11,,\n,,2,7\n,,3,11\n") throw new Error(JSON.stringify(liveCopy));
    const liveMapped = await shell.exec(`ssconvert --set 'C3==@name.relative[1,1,0].sheets["Data","Other"]:"Nested"' /live-names.xml /live-mapped.csv && cat /live-mapped.csv`);
    if (liveMapped.exitCode || liveMapped.stderr || liveMapped.stdout !== "2,7,\n3,11,\n,,111\n") throw new Error(JSON.stringify(liveMapped));
    await shell.fs.writeFile("/live-edited.xml", liveNamesXml.replace('$A$1', '$B$1'));
    const liveDefinition = await shell.exec(`ssconvert --set 'C3==@name.absolute[0,0,0]:"Total"' /live-edited.xml /live-definition.csv && cat /live-definition.csv`);
    if (liveDefinition.exitCode || liveDefinition.stderr || liveDefinition.stdout !== "2,7,\n3,11,\n,,7\n") throw new Error(JSON.stringify(liveDefinition));
    const liveExport = await shell.exec(`ssconvert --set 'C3==@name.relative[0,0,0]:"Total"' /live-names.xml /live-export.ods`);
    if (liveExport.exitCode !== 1 || liveExport.stderr !== "Unsupported ssconvert feature: live name relocation in target grammar\n") throw new Error(JSON.stringify(liveExport));
    await shell.fs.writeFile("/global-names.xml", liveNamesXml.replace('<g:Name>Data</g:Name>', '<g:Name>Data</g:Name><g:Names><g:Name><g:name>Total</g:name><g:value>42</g:value></g:Name></g:Names>'));
    for (const [formula, value] of [["[]Total", "2"], ["Total", "42"]]) {
      const scopedName = await shell.exec(`ssconvert --set 'C3==${formula}' /global-names.xml /global-name.csv && cat /global-name.csv`);
      if (scopedName.exitCode || scopedName.stderr || scopedName.stdout !== `2,7,\n3,11,\n,,${value}\n`) throw new Error(JSON.stringify(scopedName));
    }
    await shell.fs.writeFile("/global-cell-name.xml", liveNamesXml.replace('<g:name>Total</g:name>', '<g:name>A1</g:name>'));
    const copiedGlobal = await shell.exec("ssconvert --set 'C3:D4==[]A1' /global-cell-name.xml /global-copy.csv && cat /global-copy.csv");
    if (copiedGlobal.exitCode || copiedGlobal.stderr || copiedGlobal.stdout !== "2,7,,\n3,11,,\n,,2,2\n,,2,2\n") throw new Error(JSON.stringify(copiedGlobal));
    const globalExport = await shell.exec("ssconvert --set 'C3==[]Total' /global-names.xml /global-export.ods");
    if (globalExport.exitCode !== 1 || globalExport.stderr !== "Unsupported ssconvert feature: global formula name in target grammar\n") throw new Error(JSON.stringify(globalExport));
    const orderedNamesXml = liveNamesXml.replace('</g:Cells>', '<g:Cell Row="3" Col="2">=Seed</g:Cell><g:Cell Row="3" Col="2" ValueType="40">42</g:Cell><g:Cell Row="2" Col="2">=[]Seed</g:Cell><g:Cell Row="4" Col="2" ExprID="7">=[]Missing</g:Cell><g:Cell Row="5" Col="2" ExprID="7"/></g:Cells>');
    await shell.fs.writeFile("/ordered-names.xml", orderedNamesXml);
    const orderedNames = await shell.exec("ssconvert --recalc /ordered-names.xml /ordered-names.csv && cat /ordered-names.csv");
    if (orderedNames.exitCode || orderedNames.stderr !== "Unparsable expression for C5: =[]Missing (Name 'Missing' does not exist in workbook)\n" || orderedNames.stdout !== "2,7,\n3,11,\n,,#NAME?\n,,42\n,,[]Missing\n,,[]Missing\n") throw new Error(JSON.stringify(orderedNames));
    const printCsv = await shell.exec("ssconvert /print.ods /print.csv");
    if (printCsv.exitCode || printCsv.stderr !== "Label ranges and automatic label lookup are omitted by Gnumeric_stf:stf_csv\n") throw new Error(JSON.stringify(printCsv));
    const retainedLookup = await shell.exec("ssconvert /print-retained.ods /print-retained.csv");
    if (retainedLookup.exitCode || retainedLookup.stderr !== printCsv.stderr) throw new Error(JSON.stringify(retainedLookup));
    await shell.fs.writeFile("/drawing.svg", '<svg width="2" height="1"><rect width="2" height="1" fill="red"/></svg>');
    const drawing = await shell.exec("rsvg-convert /drawing.svg -o /drawing.png && convert /drawing.png /drawing.ppm && chmod 640 /drawing.ppm && ls -l /drawing.ppm");
    if (drawing.exitCode || drawing.stderr || !drawing.stdout.startsWith("-rw-r----- 1 0 0 17 ")) throw new Error(JSON.stringify(drawing));
    const pixels = await shell.fs.readFile("/drawing.ppm");
    const expected = [80, 54, 10, 50, 32, 49, 10, 50, 53, 53, 10, 255, 0, 0, 255, 0, 0];
    if (pixels.length !== expected.length || pixels.some((byte, index) => byte !== expected[index])) throw new Error("SVG pixel mismatch");
    await shell.fs.writeFile("/captions.srt", "1\n00:00:01,235 --> 00:00:02,500\nFirst\ncontinuation\n");
    const lyrics = await shell.exec("ffmpeg -i /captions.srt -bitexact -metadata title=Song /lyrics.lrc && cat /lyrics.lrc");
    if (lyrics.exitCode || lyrics.stderr || lyrics.stdout !== "[ti:Song]\n\n[00:01.24]First\n[00:01.24]continuation\n") throw new Error(JSON.stringify(lyrics));
    const captions = await shell.exec("ffmpeg -i /lyrics.lrc -f webvtt -");
    if (captions.exitCode || captions.stderr || captions.stdout !== "WEBVTT\n\n00:01.240 --> 00:01.240\nFirst\n\n00:01.240 --> 1193:02:48.535\ncontinuation\n") throw new Error(JSON.stringify(captions));
    const container = await shell.exec("ffmpeg -i /lyrics.lrc /lyrics.mkv && ffprobe -show_entries stream=codec_name -of csv=p=0 /lyrics.mkv && ffmpeg -i /lyrics.mkv -bitexact -f lrc -");
    if (container.exitCode || container.stderr || container.stdout !== "ass\n[ti:Song]\n\n[00:01.24]First\n[00:01.24]continuation\n") throw new Error(JSON.stringify(container));
    await shell.fs.writeFile("/styled.lrc", "[00:01.00]{\\i1}text\n[00:05.00]end\n");
    const styled = await shell.exec("ffmpeg -i /styled.lrc -c:s mov_text -t 4 /styled.mp4 && ffmpeg -i /styled.mp4 -bitexact -f lrc -");
    if (styled.exitCode || styled.stderr || !styled.stdout.endsWith("[00:01.00]\\<i>text</i>\n")) throw new Error(JSON.stringify(styled));
    const repeated = await shell.exec("ffmpeg -stream_loop 1 -i /styled.mp4 -f webvtt -");
    if (repeated.exitCode || repeated.stderr || repeated.stdout !== "WEBVTT\n\n00:01.000 --> 00:05.000\n\\<i>text</i>\n\n00:06.000 --> 00:10.000\n\\<i>text</i>\n") throw new Error(JSON.stringify(repeated));
    await shell.fs.writeFile("/vplayer.txt", "0:00:01:First|line\n0:00:03:Second\n0:00:06:\n");
    const vplayer = await shell.exec("ffprobe -show_entries stream=codec_name,time_base -of csv=p=0 /vplayer.txt && ffmpeg -i /vplayer.txt -f webvtt -");
    if (vplayer.exitCode || vplayer.stderr || vplayer.stdout !== "vplayer,1/100\nWEBVTT\n\n00:01.000 --> 00:03.000\nFirst\nline\n\n00:03.000 --> 00:06.000\nSecond\n") throw new Error(JSON.stringify(vplayer));
    for (const [format, input, base] of [
      ["stl", "$ comment\r00:00:01:00,00:00:03:00,First|line\r", "1/100"],
      ["subviewer1", "******** START SCRIPT ********\r\n[0:0:1]\r\nFirst|line\r\n[0:0:3]\r\n\r\n", "1/1"],
    ]) {
      await shell.fs.writeFile("/text-subtitles", input);
      const result = await shell.exec("ffprobe -show_entries stream=codec_name,time_base -of csv=p=0 /text-subtitles && ffmpeg -i /text-subtitles -f webvtt -");
      if (result.exitCode || result.stderr || result.stdout !== `${format},${base}\nWEBVTT\n\n00:01.000 --> 00:03.000\nFirst\nline\n`) throw new Error(JSON.stringify(result));
    }
    for (const [format, input, first] of [
      ["pjs", '10,30,"First|line"\n40,60,"Second"\n70,80,"End"\n', "First\nline"],
      ["mpl2", "[10][30]/First|line\n[40][60]Second\n[70][80]End\n", "<i>First</i>\nline"],
    ]) {
      await shell.fs.writeFile("/text-subtitles", input);
      const result = await shell.exec("ffprobe -show_entries stream=codec_name,time_base -of csv=p=0 /text-subtitles && ffmpeg -i /text-subtitles -f webvtt -");
      if (result.exitCode || result.stderr || result.stdout !== `${format},1/10\nWEBVTT\n\n00:01.000 --> 00:03.000\n${first}\n\n00:04.000 --> 00:06.000\nSecond\n\n00:07.000 --> 00:08.000\nEnd\n`) throw new Error(JSON.stringify(result));
    }
  } finally { await Promise.all([shell.dispose(), other.dispose()]); }
}

export default { test };
