import { join } from "node:path";
import { directory, putJson } from "./common.mjs";
import { authenticate, metadataReceipts } from "./auth.mjs";
import { execute } from "./run.mjs";
import { archiveRaw } from "./archive.mjs";

const commit = process.argv[2];
process.on("SIGTERM", () => { globalThis.exprStop = "outer stop closes admission"; });
let report, failure, post, audit;
try {
  const proof = await authenticate({ commit });
  putJson(join(directory, "PRE-BINDINGS.json"), { status: "pass", commit, bindings: proof.bindings, metadataReceipts: [...metadataReceipts] });
  report = await execute(commit, proof);
} catch (error) { failure = error.stack; }
finally {
  try { post = await authenticate({ commit, raw: true }); } catch (error) { failure ??= error.stack; }
  putJson(join(directory, "POST-BINDINGS.json"), { status: post ? "pass" : "fail", commit, bindings: post?.bindings, failure, metadataReceipts: [...metadataReceipts] });
  try { audit = await archiveRaw(commit); } catch (error) { failure ??= error.stack; }
}
console.log(JSON.stringify({ phase: "entry-settled", status: report?.status, counts: report?.counts, post: Boolean(post), audit, failure }));
process.exitCode = report?.status === "TARGETS_QUALIFIED" && post && audit?.status === "pass" && !failure ? 0 : 1;
