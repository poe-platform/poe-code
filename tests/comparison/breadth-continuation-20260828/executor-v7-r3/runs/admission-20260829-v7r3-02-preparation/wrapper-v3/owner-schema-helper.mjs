const requireThat = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };
const own = (value, keys) => {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value), 'OUTER_SCHEMA_OBJECT');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  requireThat(Reflect.ownKeys(descriptors).length === keys.length && keys.every(key => Object.hasOwn(descriptors, key) && 'value' in descriptors[key]), 'OUTER_SCHEMA_KEYS');
};

export { own };
