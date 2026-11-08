import { nativeCases } from "./cases.js";
import { fixture } from "./helpers.js";

export const gnuStringsCases = [
  ...nativeCases.filter(specimen => specimen.command === "strings"),
  fixture("gnu-tabs-and-CR", "strings", ["-a", "-n2"], "ab\tcd\ref\nGH\0"),
  fixture("gnu-file-hex-label", "strings", ["-af", "-n2", "-tx", "-", "data"], "LEAK", { data: "006162096364006566" }),
  fixture("gnu-stdin-octal", "strings", ["--print-file-name", "--radix=o", "--bytes=2"], "\0ab\0\0cd"),
  fixture("gnu-stdin-decimal", "strings", ["-f", "-td", "-n2"], "\0\0\0\0\0\0\0\0\0\0AB\0"),
  fixture("gnu-offset-reset", "strings", ["--all", "--radix=x", "first", "second"], "", { first: "006162636400", second: "6162636400" }),
  fixture("gnu-lone-dash-stdin", "strings", ["-"], "ABCD\0EFGH"),
  fixture("gnu-lone-dash-files", "strings", ["-", "first", "-", "second"], "LEAK", { first: "41424344", second: "45464748" }),
  fixture("gnu-long-printable-run", "strings", ["-a", "-n4"], "ABCD\t".repeat(7000)),
];
