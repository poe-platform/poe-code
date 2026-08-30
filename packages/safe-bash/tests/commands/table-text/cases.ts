export interface TableCase {
  readonly name: string;
  readonly command: "paste" | "comm" | "join";
  readonly args: readonly string[];
  readonly files: Readonly<Record<string, string>>;
  readonly stdinHex: string;
}

const cases: TableCase[] = [];
function add(command: TableCase["command"], name: string, args: readonly string[], files: Record<string, string> = {}, stdin = ""): void {
  cases.push({ name: `${command}: ${name}`, command, args, files: Object.fromEntries(Object.entries(files).map(([file, text]) => [file, Buffer.from(text).toString("hex")])), stdinHex: Buffer.from(stdin).toString("hex") });
}

const paired = { left: "1\n2\n", right: "a\nb\nc\n" };
add("paste", "uneven parallel", ["left", "right"], paired);
add("paste", "serial", ["-s", "left", "right"], paired);
add("paste", "repeated file independent cursors", ["left", "right", "left"], paired);
for (const delimiter of [",", "%_", "", "\\0", "\\n\\t", "\\b\\f\\r\\v", "\\\\", "\\q", "é"]) {
  add("paste", `parallel delimiters ${JSON.stringify(delimiter)}`, ["-d", delimiter, "left", "right", "left"], paired);
  add("paste", `serial delimiters ${JSON.stringify(delimiter)}`, ["-sd", delimiter, "left", "right"], paired);
}
for (const [name, input] of Object.entries({ empty: "", blank: "\n", incomplete: "a\nb", carriage: "a\r\nb\r\n", binary: "a\0b\nc\0d\n", unicode: "é\n中\n🙂\n" })) {
  add("paste", `shared stdin ${name}`, ["-", "-", "-"], {}, input);
  add("paste", `serial stdin ${name}`, ["-s", "-", "-"], {}, input);
}
add("paste", "zero records", ["-z", "left", "right"], { left: "a\nb\0c\0", right: "1\0\0last" });
add("paste", "serial zero records", ["--serial", "--zero-terminated", "--delimiters=,", "left"], { left: "a\nb\0c\0" });
add("paste", "default stdin", [], {}, "one\ntwo");
add("paste", "mixed stdin cursor", ["-", "right", "-"], paired, "1\n2\n");
add("paste", "literal path", ["--", "-file"], { "-file": "literal\n" });
add("paste", "missing parallel file", ["left", "missing"], paired);
add("paste", "missing serial file continues", ["-s", "missing", "left"], paired);
add("paste", "invalid trailing escape", ["-d", "\\", "-"], {}, "x\n");
add("paste", "invalid flag", ["--not-implemented"], {}, "x\n");

const sorted = { left: "a\na\nb\nd\n", right: "a\nb\nb\nc\n" };
for (const flags of ["", "-1", "-2", "-3", "-12", "-13", "-23", "-123"]) {
  const args = flags ? [flags] : [];
  add("comm", `columns ${flags || "all"}`, [...args, "left", "right"], sorted);
  add("comm", `totals ${flags || "all"}`, ["--total", ...args, "left", "right"], sorted);
}
for (const delimiter of ["|", "::", "", "é"]) add("comm", `output delimiter ${JSON.stringify(delimiter)}`, ["--output-delimiter", delimiter, "--total", "left", "right"], sorted);
for (const [name, files] of Object.entries({ empty: { left: "", right: "" }, tail: { left: "a", right: "b" }, blanks: { left: "\n\na\n", right: "\na\n" }, binary: { left: "a\0b\n中\n", right: "a\0b\né\n" }, emptyLeft: { left: "", right: "a\nb\n" } })) add("comm", name, ["left", "right"], files);
add("comm", "NUL records and totals", ["-z", "--total", "left", "right"], { left: "a\nb\0c\0", right: "a\nb\0d\0" });
add("comm", "stdin left", ["-", "right"], sorted, sorted.left);
add("comm", "stdin right", ["left", "-"], sorted, sorted.right);
add("comm", "shared stdin", ["-", "-"], {}, "a\na\nb\nb\nc\n");
for (const order of [[], ["--check-order"], ["--nocheck-order"]]) {
  add("comm", `unsorted paired ${order}`, [...order, "left", "right"], { left: "b\na\n", right: "b\na\n" });
  add("comm", `unsorted unpaired ${order}`, [...order, "left", "right"], { left: "b\na\nc\n", right: "b\nz\n" });
  add("comm", `unsorted empty side ${order}`, [...order, "left", "right"], { left: "b\na\n", right: "" });
}
add("comm", "literal files", ["--", "-left", "-right"], { "-left": "a\n", "-right": "a\n" });
add("comm", "missing file", ["left", "missing"], sorted);
add("comm", "too few files", ["left"], sorted);

const joined = { left: "a A1\na A2\nb B\nd D\n", right: "a X1\na X2\nc C\nd Y\n" };
for (const flags of [[], ["-a1"], ["-a2"], ["-a1", "-a2"], ["-v1"], ["-v2"], ["-v1", "-v2"]]) add("join", `pairability ${flags}`, [...flags, "left", "right"], joined);
for (const format of ["0", "1.2,2.2", "0,2.2,1.2", "0 1.3 2.3", "auto"]) {
  add("join", `format ${format}`, ["-a1", "-a2", "-e", "MISSING", "-o", format, "left", "right"], joined);
}
add("join", "alternate key fields", ["-1", "2", "-2", "3", "left", "right"], { left: "L a extra\nM b\n", right: "R V a tail\nS W b\n" });
add("join", "shared key field", ["-j2", "left", "right"], { left: "L a\nM b\n", right: "R a\nS b\n" });
add("join", "ASCII folded keys", ["-i", "left", "right"], { left: "A one\nb two\n", right: "a X\nB Y\n" });
add("join", "blank splitting", ["left", "right"], { left: "  a   one\t two  \n\tb\tthree\n", right: "a X\nb Y\n" });
add("join", "empty lines and missing key", ["-a1", "-a2", "left", "right"], { left: "\n\na one\n", right: "\na two\n" });
add("join", "missing second key", ["-j2", "-eNA", "left", "right"], { left: "alone\n", right: "other\n" });
add("join", "empty comma fields", ["-t,", "-eNA", "-a1", "-a2", "left", "right"], { left: ",empty\na,,last\nb,\n", right: ",x\na,y,\nc,z\n" });
add("join", "NUL fields", ["-t", "\\0", "left", "right"], { left: "a\0one\nb\0two\n", right: "a\0X\nb\0Y\n" });
add("join", "whole records", ["-t", "", "-a1", "left", "right"], { left: "a one\nb two\n", right: "a one\n" });
add("join", "zero record whitespace", ["-z", "left", "right"], { left: "a\none\0b two\0", right: "a X\0b Y\0" });
add("join", "zero records comma fields", ["-zt,", "left", "right"], { left: "a,one\nx\0b,two\0", right: "a,X\0b,Y\0" });
add("join", "incomplete final records", ["left", "right"], { left: "a one\nb two", right: "a X\nb Y" });
add("join", "UTF8 payload bytes", ["left", "right"], { left: "a é🙂\nb 中文\n", right: "a Ω\nb 😀\n" });
add("join", "stdin left", ["-", "right"], joined, joined.left);
add("join", "stdin right", ["left", "-"], joined, joined.right);
add("join", "both stdin invalid", ["-", "-"], {}, "a x\na y\n");
for (const format of [[], ["-oauto"], ["-o", "0,2.2,1.2"]]) add("join", `header ${format}`, ["--header", "--check-order", "-a1", "-a2", "-eNA", ...format, "left", "right"], { left: "KEY LEFT\na one extra\nb two\n", right: "OTHER RIGHT\na x\nc y extra\n" });
add("join", "auto variable field lengths", ["-oauto", "-a1", "-a2", "-e?", "left", "right"], { left: "a one two\nb short\nc long extra ignored\n", right: "a X\nd Y Z\n" });
add("join", "header with empty right", ["--header", "-a1", "left", "right"], { left: "KEY VALUE\na one\n", right: "" });
for (const order of [[], ["--check-order"], ["--nocheck-order"]]) {
  add("join", `unsorted paired ${order}`, [...order, "left", "right"], { left: "b B\na A\n", right: "b Y\na X\n" });
  add("join", `unsorted unpaired ${order}`, [...order, "-a1", "left", "right"], { left: "a A\nc C\nb B\n", right: "a X\nz Z\n" });
  add("join", `unsorted empty side ${order}`, [...order, "-a1", "left", "right"], { left: "b B\na A\n", right: "" });
}
for (const [name, args] of Object.entries({ invalidField: ["-j0"], invalidOutput: ["-o3.1"], invalidDelimiter: ["-t::"], missingArgument: ["-a"], unknown: ["--unknown"] })) add("join", name, [...args, "left", "right"], joined);
add("join", "literal files", ["--", "-left", "-right"], { "-left": "a left\n", "-right": "a right\n" });

let seed = 0x81276;
function random(): number { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; }
for (let iteration = 0; iteration < 24; iteration++) {
  const keys = ["", "a", "b", "c", "d", "z"];
  const left = Array.from({ length: random() % 15 }, () => keys[random() % keys.length]!).sort();
  const right = Array.from({ length: random() % 15 }, () => keys[random() % keys.length]!).sort();
  const end = iteration % 3 ? "\n" : "";
  const rows = (values: readonly string[]): string => values.length ? values.join("\n") + end : "";
  add("comm", `seed ${iteration}`, [iteration % 2 ? "--total" : "-13", "left", "right"], { left: rows(left), right: rows(right) });
  const table = (values: readonly string[], prefix: string): string => rows(values.map((key, index) => `${key},${prefix}${index},${iteration}`));
  add("join", `seed ${iteration}`, ["-t,", "-a1", "-a2", ...(iteration % 2 ? ["-oauto", "-e?"] : []), "left", "right"], { left: table(left, "L"), right: table(right, "R") });
  add("paste", `seed ${iteration}`, [iteration % 2 ? "-sd,_" : "-d,_", "left", "right", "left"], { left: rows(left), right: rows(right) });
}

add("join", "whole record output list", ["-t", "", "-o1.1,2.1", "left", "right"], { left: "a one\n", right: "a one\n" });
add("join", "repeated output lists", ["-o1.2", "-o2.2", "left", "right"], joined);
add("join", "auto then output list", ["-oauto", "-o1.2", "left", "right"], joined);
add("join", "output list then auto", ["-o1.2", "-oauto", "left", "right"], joined);
add("join", "incompatible delimiters", ["-t,", "-t:", "left", "right"], joined);
add("join", "identical repeated delimiters", ["-t,", "-t,", "left", "right"], { left: "a,one\n", right: "a,two\n" });
add("join", "header with empty left", ["--header", "-a2", "-oauto", "-eNA", "left", "right"], { left: "", right: "KEY VALUE\na one\n" });
add("join", "empty fields formatted replacement", ["-t,", "-o0,1.2,2.2", "-eNA", "left", "right"], { left: "a,\n", right: "a,\n" });
add("join", "large absent key", ["-j99999999", "-eNA", "left", "right"], { left: "a one\n", right: "b two\n" });
add("join", "header empty fields", ["--header", "-t,", "-oauto", "left", "right"], { left: ",LEFT\na,one\n", right: "KEY,RIGHT\na,two\n" });
add("comm", "incompatible delimiters", ["--output-delimiter=a", "--output-delimiter=b", "left", "right"], sorted);
add("comm", "identical repeated delimiters", ["--output-delimiter=a", "--output-delimiter=a", "left", "right"], sorted);
add("paste", "repeated delimiters", ["-d,", "-d:", "left", "right"], paired);

export const tableCases: readonly TableCase[] = cases;
