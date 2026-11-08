import { tableCases, type TableCase } from "../../table-text/cases.js";
import { fixture } from "../../table-text/helpers.js";

const original = tableCases.find(entry => entry.name === "comm: shared stdin");
if (!original) throw new Error("missing unchanged author shared-input case");

export const focused: TableCase[] = [
  original,
  { ...fixture("comm", ["-", "-"]), name: "shared empty" },
  { ...fixture("comm", ["-", "-"], {}, "tail"), name: "shared incomplete record" },
  { ...fixture("comm", ["--total", "-", "-"], {}, "a\na\nb\nb\nc\n"), name: "close precedes total" },
  { ...fixture("comm", ["-123", "--total", "-", "-"], {}, "a\na\n"), name: "suppression does not bypass close" },
  { ...fixture("comm", ["--check-order", "-", "-"], {}, "b\nb\na\na\n"), name: "strict order precedes close" },
  { ...fixture("comm", ["--nocheck-order", "-", "-"], {}, "b\nb\na\na\n"), name: "disabled order still closes" },
  { name: "shared NUL invalid bytes", command: "comm", args: ["-z", "-", "-"], files: {}, stdinHex: "80008000ff00ff00" },
  { ...fixture("comm", ["--total", "-", "right"], { right: "a\nc\n" }, "a\nb\n"), name: "single stdin left remains useful" },
  { ...fixture("comm", ["--total", "left", "-"], { left: "a\nb\n" }, "a\nc\n"), name: "single stdin right remains useful" },
  { ...fixture("comm", ["--total", "same", "same"], { same: "a\nb\n" }), name: "same pathname separate opens" },
  { ...fixture("paste", ["-", "-", "-"], {}, "a\nb\nc\nd\n"), name: "paste repeated stdin stays successful" },
];
