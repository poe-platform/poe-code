import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const product = path.resolve(process.env.REVIEW_PACKAGE);
const trace = process.env.REVIEW_TRACE;
export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  if (specifier === 'virtual-bash' && result.url !== new URL('file://' + product + '/dist/index.js').href) throw new Error('REVIEW_PACKAGE_BINDING_MISMATCH');
  return result;
}
export async function load(url, context, nextLoad) {
  if (url.startsWith('file:')) {
    const filename = fileURLToPath(url);
    if (filename.includes('/node_modules/virtual-bash/')) {
      if (!filename.startsWith(product + '/') || fs.realpathSync(filename) !== filename) throw new Error('REVIEW_PACKAGE_PATH_ESCAPE');
      const bytes = fs.readFileSync(filename);
      fs.appendFileSync(trace, JSON.stringify({ url, role: 'installed-package', sha256: createHash('sha256').update(bytes).digest('hex') }) + '\n');
    } else if (filename.includes('/src/')) throw new Error('REVIEW_SOURCE_LOAD_FORBIDDEN');
  }
  return nextLoad(url, context);
}
