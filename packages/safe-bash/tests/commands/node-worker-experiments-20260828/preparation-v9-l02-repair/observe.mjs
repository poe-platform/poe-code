import { types } from 'node:util';
const fields = ['name','message','code','errno','syscall','path','dest'];
const allowed = ['stack','message','cause','code','errno','syscall','path','dest','name'];
export function observeReason(value, recognize = null) {
  const record = { kind: typeof value, proxy: false, recognized: null, fields: {}, shape: [], guardReason: null, observationFailure: false };
  try {
    if ((typeof value !== 'object' || value === null) && typeof value !== 'function') { record.guardReason = 'non-object'; return record; }
    if (types.isProxy(value)) { record.proxy = true; record.guardReason = 'proxy-not-inspected'; return record; }
    if (recognize === null) { record.guardReason = 'recognizer-required'; return record; }
    record.recognized = recognize(value) === true;
    if (!record.recognized) { record.guardReason = 'origin-unrecognized'; return record; }
    const names = Reflect.ownKeys(value);
    if (names.length > 16) { record.guardReason = 'own-key-cap'; return record; }
    for (const key of names) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      const data = Object.hasOwn(descriptor, 'value');
      const known = typeof key === 'string' && allowed.includes(key);
      const label = known ? key : typeof key === 'symbol' ? '<symbol>' : '<extra>';
      record.shape.push({ key: label, data, enumerable: descriptor.enumerable, configurable: descriptor.configurable, writable: data ? descriptor.writable : null, getter: data ? false : typeof descriptor.get === 'function', setter: data ? false : typeof descriptor.set === 'function' });
      if (record.guardReason === null && (!known || (!data && key !== 'stack'))) record.guardReason = !known ? 'extra-own-key' : 'accessor:' + key;
      if (data && fields.includes(key)) {
        const item = descriptor.value;
        const type = typeof item;
        if (item === undefined) record.fields[key] = { type: 'undefined' };
        else if (type === 'string' && item.length <= 1024 && Buffer.byteLength(item) <= 1024) record.fields[key] = { type, value: item };
        else if (type === 'number' && Number.isSafeInteger(item)) record.fields[key] = { type, value: item };
        else record.fields[key] = { type, omitted: true };
      }
    }
    return record;
  } catch { record.observationFailure = true; return record; }
}
