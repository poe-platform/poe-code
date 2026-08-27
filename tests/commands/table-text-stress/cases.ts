import type { Fixture } from "./support.js";
const cases: Fixture[] = [];
function add(command: Fixture["command"], name: string, args: string[], left = "", right = "", stdin = ""): void {
  cases.push({ name: `${command} ${name}`, command, args, files: { left: Buffer.from(left, "latin1").toString("hex"), right: Buffer.from(right, "latin1").toString("hex") }, stdinHex: Buffer.from(stdin, "latin1").toString("hex") });
}
add("comm", "shared original", ["-", "-"], "", "", "a\na\nb\nb\nc\n");
add("paste", "shared alternating empty EOF", ["-", "left", "-", "-"], "L\nM\nN\n", "", "\na\n\nlast");
add("paste", "serial shared cursor", ["-s", "-d", "\\0,\\t", "-", "left", "-"], "x\ny\nz", "", "1\n2\n3\n");
add("paste", "NUL shared invalid bytes", ["-z", "-d", "\\0:", "-", "left", "-"], "\xff\0\0", "", "\x80\0a\nb\0tail");
add("paste", "CR invalid bytes", ["-d", "\\r\\n", "left", "right", "left"], "\xff\r\n\nlast", "\x80\n");
add("paste", "empty serial files", ["-s", "left", "right"]);
add("comm", "C byte collation", ["--check-order", "left", "right"], "\0\nA\n\x80\n\xff\n", "A\n\x81\n\xff");
add("comm", "duplicate multiplicity totals", ["--total", "--output-delimiter=::", "left", "right"], "a\na\na\nb\n", "a\nb\nb\n");
add("comm", "NUL empty delimiter", ["-z", "--output-delimiter=", "left", "right"], "\0a\0a\0z", "\0a\0b\0");
for (const mode of [[], ["--check-order"], ["--nocheck-order"]]) {
  add("comm", `order ${mode}`, [...mode, "left", "right"], "b\na\n", "z\n");
  add("join", `first unpaired inversion ${mode}`, [...mode, "-a1", "left", "right"], "b B\na A\n", "z Z\n");
  add("join", `empty opposite inversion ${mode}`, [...mode, "-a1", "left", "right"], "b B\na A\n");
}
add("join", "header auto empty fields", ["--header", "-t:", "-a1", "-a2", "-e", "?", "-o", "auto", "left", "right"], "key:left:extra\na::x\nc:C:\n", "key:right\na:R\nb:B\n");
add("join", "NUL newline fields invalid bytes", ["-z", "left", "right"], "a\nx\0\xff left\0", "a right\0\xff\ny\0");
add("join", "whole record empty key", ["-t", "", "-a1", "-a2", "left", "right"], "\na\na\n", "\na\nb\n");
add("join", "large Cartesian", ["left", "right"], Array.from({ length: 35 }, (_, index) => `a L${index}\n`).join(""), Array.from({ length: 31 }, (_, index) => `a R${index}\n`).join(""));
add("join", "repeated format and delimiter", ["-t:", "-t:", "-o", "1.2,0", "-o", "2.2", "left", "right"], "a:L\n", "a:R\n");
let seed = 0x51a7;
const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
for (let index = 0; index < 16; index++) {
  const keys = ["", "a", "b", "c", "\x80", "\xff"];
  const leftKeys = Array.from({ length: random() % 9 }, () => keys[random() % keys.length]!).sort();
  const rightKeys = Array.from({ length: random() % 9 }, () => keys[random() % keys.length]!).sort();
  const separator = index % 2 ? "\0" : "\n";
  const flags = index % 2 ? ["-z"] : [];
  const left = leftKeys.join(separator) + (index % 3 ? separator : "");
  const right = rightKeys.join(separator) + (index % 4 ? separator : "");
  add("paste", `seed ${index}`, [...flags, "-d", index % 3 ? ":\\0" : "", "-", "right", "-"], left, right, left);
  add("comm", `seed ${index}`, [...flags, "--check-order", ...(index % 3 ? ["-2"] : []), "left", "right"], left, right);
  add("join", `seed ${index}`, [...flags, "-t:", "-a1", "-a2", "-e", "?", "-o", "auto", "left", "right"], leftKeys.map((key, row) => `${key}:L${row}${separator}`).join(""), rightKeys.map((key, row) => `${key}:R${row}${separator}`).join(""));
}
export { cases };
