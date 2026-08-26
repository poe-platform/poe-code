import type { Row } from "./rows.js";
export { seeds } from "./rows.js";

export const rows: readonly Row[] = [
  { id: "retry-stdout-explicit", args: ["--retry", "1", "-o", "-", "{A}/retry"] },
  { id: "retry-fail", args: ["--retry", "1", "--fail", "{A}/retry"] },
  { id: "retry-fail-body", args: ["--retry", "1", "--fail-with-body", "{A}/retry"] },
  { id: "retry-include", args: ["--retry", "1", "-i", "{A}/retry"] },
  { id: "retry-fail-include", args: ["--retry", "1", "-f", "-i", "{A}/retry"] },
  { id: "retry-fail-body-include", args: ["--retry", "1", "--fail-with-body", "-i", "{A}/retry"] },
  { id: "retry-dump-file", args: ["--retry", "1", "-D", "headers.out", "{A}/retry"] },
  { id: "retry-dump-stdout", args: ["--retry", "1", "-D", "-", "{A}/retry"] },
  { id: "retry-file-include-dump", args: ["--retry", "1", "-i", "-D", "headers.out", "-o", "result.bin", "{A}/retry"] },
  { id: "retry-file-fail", args: ["--retry", "1", "-f", "-o", "result.bin", "{A}/retry"] },
  { id: "retry-file-fail-body", args: ["--retry", "1", "--fail-with-body", "-o", "result.bin", "{A}/retry"] },
  { id: "retry-exhaustion", args: ["--retry", "1", "{A}/status/503"] },
  { id: "retry-exhaustion-fail", args: ["--retry", "1", "-f", "{A}/status/503"], code: 22 },
  { id: "retry-exhaustion-body", args: ["--retry", "1", "--fail-with-body", "{A}/status/503"], code: 22 },
  { id: "retry-exhaustion-file", args: ["--retry", "1", "--fail-with-body", "-o", "result.bin", "{A}/status/503"], code: 22 },
  { id: "retry-writeout", args: ["--retry", "1", "-w", ":%{size_download}:%{http_code}:%{exitcode}", "{A}/retry"] },
  { id: "retry-response-quota", args: ["--retry", "1", "--max-filesize", "5", "{A}/retry"], code: 63 },
  { id: "retry-output-missing-parent", args: ["--retry", "1", "-o", "absent/result.bin", "{A}/retry"], code: 23 },
];
