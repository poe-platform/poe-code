import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

const ns = "urn:schemas-microsoft-com:office:spreadsheet";
const book = `<Workbook xmlns="${ns}" xmlns:ss="${ns}"><Worksheet ss:Name="S"><Table><Row><Cell><Data ss:Type="Number">4</Data></Cell><Cell ss:Formula="=RC[-1]+2"><Data ss:Type="Number">99</Data></Cell></Row><Row><Cell><Data ss:Type="Number">3</Data></Cell><Cell ss:Formula="=SUM(R1C1:R2C1)"><Data ss:Type="Number">88</Data></Cell></Row></Table></Worksheet></Workbook>`;
for (const runtime of ["TypeScript", "Rust"]) {
  for (const importer of ["", "-I Gnumeric_Excel:excel_xml", "--import-type=Gnumeric_Excel:excel_xml"]) {
    for (const recalc of [false, true]) {
      test(`${runtime} SpreadsheetML ${importer || "auto"} recalc=${recalc}`, {skip: !WebAssembly.Suspending}, async () => {
        const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
        const memory = createMemoryFileSystem();
        const shell = runtime === "TypeScript" ? new Shell({fs: memory, cwd: "/"}).use(agentCommands()) : new RustWasmBash({cwd: "/", forceNative: true});
        const fs = runtime === "TypeScript" ? memory : shell.fs;
        try {
          const filename = importer ? "/book.data" : "/book.xml";
          await fs.writeFile(filename, Buffer.from(book));
          const r = await shell.exec(`ssconvert ${importer} ${recalc ? "--recalc" : ""} -T Gnumeric_stf:stf_csv ${filename} fd://1`);
          assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, recalc ? "4,6\n3,7\n" : "4,99\n3,88\n", ""]);
          assert.equal(Buffer.from(await fs.readFile(filename)).toString(), book);
          if (runtime === "Rust") assert.equal(shell._companion, null);
        } finally {await shell.dispose();}
      });
    }
  }
}

for (const runtime of ["TypeScript", "Rust"]) {
  test(`${runtime} SpreadsheetML namespaces, typed data and failed import publication`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const memory = createMemoryFileSystem();
    const shell = runtime === "TypeScript" ? new Shell({fs: memory, cwd: "/"}).use(agentCommands()) : new RustWasmBash({cwd: "/", forceNative: true});
    const fs = runtime === "TypeScript" ? memory : shell.fs;
    const typed = `<s:Workbook xmlns:s="${ns}"><s:Worksheet s:Name="Data"><s:Table><s:Row><s:Cell s:Index="2"><s:Data s:Type="String">=1+2</s:Data></s:Cell><s:Cell><s:Data s:Type="Boolean">TRUE</s:Data></s:Cell><s:Cell><s:Data s:Type="DateTime">2024-01-01T12:00:00</s:Data></s:Cell><s:Cell><s:Data s:Type="Error">#DIV/0!</s:Data></s:Cell></s:Row></s:Table></s:Worksheet></s:Workbook>`;
    try {
      await fs.writeFile("/typed.xml", Buffer.from(typed));
      for (const recalc of ["", "--recalc"]) {
        const result = await shell.exec(`ssconvert ${recalc} -I Gnumeric_Excel:excel_xml -T Gnumeric_stf:stf_csv /typed.xml fd://1`);
        assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, ",=1+2,TRUE,45292.5,#DIV/0!\n", ""]);
      }
      for (const invalid of [book.slice(0, -11), "<Workbook/>", book.replace('<Row>', '<Row ss:Index="999999999">')]) {
        await fs.writeFile("/bad.xml", Buffer.from(invalid));
        await fs.writeFile("/keep.csv", Buffer.from("keep\n"));
        const result = await shell.exec("ssconvert -I Gnumeric_Excel:excel_xml -T Gnumeric_stf:stf_csv /bad.xml /keep.csv");
        assert.notEqual(result.exitCode, 0, invalid);
        assert.equal(result.stdout, "");
        assert.equal(Buffer.from(await fs.readFile("/keep.csv")).toString(), "keep\n");
      }
      if (runtime === "Rust") assert.equal(shell._companion, null);
    } finally {await shell.dispose();}
  });
}
