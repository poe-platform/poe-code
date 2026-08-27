import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const root = dirname(fileURLToPath(import.meta.url));
export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  if (result.url.startsWith('file:')) {
    const location = fileURLToPath(result.url);
    if (!location.startsWith(`${root}/`)) throw new Error(`Nonfrozen module import: ${location}`);
  }
  const product = context.parentURL?.includes('/candidate/dist/') === true;
  if (product && /^(?:node:)?(?:fs(?:\/promises)?|child_process|zlib)$/u.test(specifier)) throw new Error(`Forbidden host dependency from product: ${specifier}`);
  appendFileSync(process.env.HOLDOUT_MODULE_LOG, `${JSON.stringify({ specifier, parentURL: context.parentURL ?? null, resolved: result.url, product })}\n`);
  return result;
}
