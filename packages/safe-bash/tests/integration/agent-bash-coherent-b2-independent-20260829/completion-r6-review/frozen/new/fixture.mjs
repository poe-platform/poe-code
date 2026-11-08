import fs from "node:fs";
const mode = process.argv[2];
const specification = JSON.parse(fs.readFileSync(process.argv[3]));
if (mode === "type-valid" || mode === "type-wrong") {
  for (const [index, row] of specification.diagnostics.entries()) console.log(`${specification.filename}(${row.line},${row.column}): error TS${mode === "type-wrong" && index === 0 ? 9999 : row.code}: ${row.message}`);
  process.exitCode = 2;
} else if (mode === "mutant") { console.log(JSON.stringify(specification.case)); console.log(JSON.stringify({ summary: { cases: 1, pass: 0, fail: 1 } })); process.exitCode = 1; }
else if (mode === "restore") { console.log(JSON.stringify({ id: specification.case.id, pass: true, created: 1, disposed: 1 })); console.log(JSON.stringify({ summary: { cases: 1, pass: 1, fail: 0 } })); }
else throw new Error("undeclared harmless fixture mode");
