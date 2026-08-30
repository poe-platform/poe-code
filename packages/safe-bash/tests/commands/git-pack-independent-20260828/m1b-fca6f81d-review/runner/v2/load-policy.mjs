import { fileURLToPath, pathToFileURL } from 'node:url';

export function enrolledUrl(specifier, parentURL, files, builtins) {
  if (typeof specifier !== 'string') throw new Error('IMPORT_TYPE');
  if (specifier.startsWith('node:')) {
    if (!builtins.has(specifier)) throw new Error(`BUILTIN_DENIED:${specifier}`);
    return specifier;
  }
  if (!(specifier.startsWith('file:') || specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/'))) throw new Error('AMBIENT_IMPORT_DENIED');
  const url = specifier.startsWith('/') ? pathToFileURL(specifier) : new URL(specifier, parentURL);
  if (url.search || url.hash || !files.has(fileURLToPath(url))) throw new Error('LOAD_NOT_ENROLLED');
  return url.href;
}
