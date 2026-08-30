const expected = Object.freeze({ platform: 'darwin', uid: 501, key: '__CF_USER_TEXT_ENCODING', value: '0x1F5:0x0:0x0' });
export function qualifyHostEnvironment(snapshot) {
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw Error('HOST_ENV_SCHEMA');
  const fields = ['platform', 'uid', 'keys', 'value'];
  const descriptors = Object.getOwnPropertyDescriptors(snapshot);
  if (Reflect.ownKeys(descriptors).length !== fields.length || fields.some(key => !Object.hasOwn(descriptors, key) || !Object.hasOwn(descriptors[key], 'value'))) throw Error('HOST_ENV_SCHEMA');
  if (snapshot.platform !== expected.platform || snapshot.uid !== expected.uid || !Array.isArray(snapshot.keys) || snapshot.keys.length !== 1 || snapshot.keys[0] !== expected.key || snapshot.value !== expected.value) throw Error('HOST_ENV_PROFILE');
  return true;
}
export function assertHostEnvironment() {
  return qualifyHostEnvironment({ platform: process.platform, uid: process.getuid(), keys: Object.keys(process.env).sort(), value: process.env[expected.key] });
}
