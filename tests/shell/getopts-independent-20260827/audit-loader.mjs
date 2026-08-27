import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  if (resolved.url.startsWith('file:')) {
    const filename = fileURLToPath(resolved.url);
    const owned = process.env.REVIEW_OWNED_ROOT;
    const tooling = process.env.REVIEW_TOOLING_ROOT;
    if (!filename.startsWith(owned + '/') && !filename.startsWith(tooling + '/')) throw new Error(`audit denied foreign module: ${filename}`);
    if (process.env.REVIEW_MODE === 'moved' && (filename.endsWith('.ts') || filename.includes('/source/'))) throw new Error(`audit denied source fallback: ${filename}`);
  }
  appendFileSync(process.env.REVIEW_LOAD_LOG, JSON.stringify({ specifier, parentURL: context.parentURL ?? null, url: resolved.url }) + '\n');
  return resolved;
}
