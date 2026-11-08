import { appendFileSync } from "node:fs";

export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  if (result.url.startsWith("file:")) appendFileSync(process.env.ATOMIC_CLOSURE_LOG, `${JSON.stringify({ specifier, parent: context.parentURL, url: result.url })}\n`);
  return result;
}
