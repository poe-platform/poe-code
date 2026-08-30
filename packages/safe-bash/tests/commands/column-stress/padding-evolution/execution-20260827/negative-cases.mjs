import { pathToFileURL } from "node:url";
import { join } from "node:path";

const candidate = process.argv[2], mode = process.argv[5];
if (mode === "no-work-admission") {
  const { ColumnBudget } = await import(pathToFileURL(join(candidate, "dist/commands/column/internal.js")).href);
  ColumnBudget.prototype.work = async function () {};
}
await import("./cases.mjs");
console.log(JSON.stringify({ negativeMode: mode, observedWidthReads: globalThis.__columnWidthReads ?? null }));
