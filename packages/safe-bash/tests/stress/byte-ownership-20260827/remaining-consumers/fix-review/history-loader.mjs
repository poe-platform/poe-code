import { pathToFileURL } from 'node:url';
export { load } from './loader.mjs';

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '../../../../../src/index.js' && context.parentURL === pathToFileURL(process.env.REVIEW_DIRECT).href) {
    return { url: pathToFileURL(process.env.REVIEW_PUBLIC).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
