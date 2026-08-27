export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  console.error(`COVERAGE_MODULE ${JSON.stringify({ specifier, parentURL: context.parentURL ?? null, url: result.url })}`);
  return result;
}
