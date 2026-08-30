export function authorizeEdge(manifest, importer, specifier, role, importerSha256) {
  if (typeof importer !== 'string' || typeof specifier !== 'string' || !['parent','worker'].includes(role)) throw Error('import admission types');
  const record = manifest.files.find(file => file.path === importer);
  if (!record || record.sha256 !== importerSha256 || !record.roles.includes(role)) throw Error('importer identity/role');
  const edge = manifest.edges.find(edge => edge.importer === importer && edge.specifier === specifier && edge.roles.includes(role));
  if (!edge || edge.importerSha256 !== importerSha256) throw Error('unlisted exact import edge');
  if (specifier.startsWith('node:') && edge.target !== specifier) throw Error('builtin alias');
  if (!specifier.startsWith('node:') && !manifest.files.some(file => file.path === edge.target && file.roles.includes(role))) throw Error('target role');
  return edge.target;
}
export function validateBootstrap(manifest, observed) {
  if (!Array.isArray(observed) || observed.length !== manifest.bootstrap.length) throw Error('bootstrap cardinality');
  for (let index = 0; index < observed.length; index += 1) {
    const actual = observed[index]; const expected = manifest.bootstrap[index];
    if (!actual || Reflect.ownKeys(actual).join(',') !== 'path,bytes,sha256' || Reflect.ownKeys(actual).some(key => !Object.hasOwn(Object.getOwnPropertyDescriptor(actual,key), 'value'))) throw Error('bootstrap own-data');
    if (actual.path !== expected.path || actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) throw Error('bootstrap body/order');
  }
  return true;
}
