import { createHash } from "node:crypto";

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url.includes("/node_modules/virtual-bash/")) {
    if (!url.includes("/node_modules/virtual-bash/dist/")) throw new Error("non-dist product load");
    console.error(`INDEPENDENT_MODULE ${JSON.stringify({ url, sha256: createHash("sha256").update(result.source).digest("hex") })}`);
  }
  return result;
}
