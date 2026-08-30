import { runBoundary } from "./worker-core-v1.mjs";

const [caseBase64] = process.argv.slice(2);
if (!caseBase64) throw new Error("installed consumer requires a case");
const caseRecord = JSON.parse(Buffer.from(caseBase64, "base64").toString("utf8"));
const entryUrl = import.meta.resolve("virtual-bash");
const treeUrl = import.meta.resolve("virtual-bash/commands/tree");
const api = await import("virtual-bash");
process.stdout.write(`${JSON.stringify(await runBoundary({
  api,
  boundary: "installed-package-bare-import",
  caseRecord,
  entryUrl,
  treeUrl,
}))}\n`);
