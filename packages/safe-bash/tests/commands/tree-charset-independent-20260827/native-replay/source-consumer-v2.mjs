import { runBoundary } from "./worker-core-v2.mjs";

const [caseBase64, entryUrl, treeUrl] = process.argv.slice(2);
if (!caseBase64 || !entryUrl || !treeUrl) throw new Error("source consumer requires case, entry, and tree URLs");
const caseRecord = JSON.parse(Buffer.from(caseBase64, "base64").toString("utf8"));
const api = await import(entryUrl);
process.stdout.write(`${JSON.stringify(await runBoundary({
  api,
  boundary: "source-build",
  caseRecord,
  entryUrl,
  treeUrl,
}))}\n`);
