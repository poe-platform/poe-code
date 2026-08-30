export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  if (result.url.includes("/node_modules/virtual-bash/")) console.error(`WEBDAV_MODULE ${result.url}`);
  return result;
}
