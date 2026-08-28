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
  if (!Array.isArray(observed)) throw Error('bootstrap array');
  const length = Object.getOwnPropertyDescriptor(observed, 'length');
  if (!length || !Object.hasOwn(length, 'value') || length.value !== manifest.bootstrap.length) throw Error('bootstrap cardinality');
  const keys = Reflect.ownKeys(observed);
  if (keys.length !== length.value + 1 || keys.at(-1) !== 'length') throw Error('bootstrap array extras');
  for (let index = 0; index < length.value; index += 1) {
    if (keys[index] !== String(index)) throw Error('bootstrap array hole/order');
    const descriptor = Object.getOwnPropertyDescriptor(observed, keys[index]);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw Error('bootstrap array accessor');
    const actual = descriptor.value; const expected = manifest.bootstrap[index];
    if (!actual || Reflect.ownKeys(actual).join(',') !== 'path,bytes,sha256' || Reflect.ownKeys(actual).some(key => !Object.hasOwn(Object.getOwnPropertyDescriptor(actual,key), 'value'))) throw Error('bootstrap own-data');
    if (actual.path !== expected.path || actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) throw Error('bootstrap body/order');
  }
  return true;
}
