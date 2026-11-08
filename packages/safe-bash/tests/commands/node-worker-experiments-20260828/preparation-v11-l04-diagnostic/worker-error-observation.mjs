import { types } from 'node:util';
export const RESERVATION = 65536;
export function observe(reason, route, credit) {
  if (credit !== RESERVATION) throw Error('observation precharge');
  if (!['rejection','result-not-ok'].includes(route)) throw Error('observation route');
  const report = { version: 1, route, engineAttempt: true, guestEntry: 'not-established-by-observation', reasonPresent: true, reasonType: typeof reason, proxy: false, fields: [] };
  if ((typeof reason === 'object' && reason !== null) || typeof reason === 'function') {
    if (types.isProxy(reason)) report.proxy = true;
    else for (const key of ['name','message','code']) {
      const descriptor = Object.getOwnPropertyDescriptor(reason, key);
      if (!descriptor) report.fields.push({ key, shape: 'absent', value: null });
      else if (!Object.hasOwn(descriptor,'value')) report.fields.push({ key, shape: 'accessor-unread', value: null });
      else if (typeof descriptor.value !== 'string') report.fields.push({ key, shape: 'nonstring-unread', value: null });
      else if (descriptor.value.length > 256 || Buffer.byteLength(descriptor.value) > 256) report.fields.push({ key, shape: 'oversize-unread', value: null });
      else report.fields.push({ key, shape: 'data-string', value: descriptor.value });
    }
  }
  const text = JSON.stringify(report);
  if (Buffer.byteLength(text) > 8192) throw Error('observation bound');
  return text;
}
export function publish(reason, route, credit, send, observer = observe) {
  let text = null;
  try { text = observer(reason, route, credit); send(text); return { reason, complete: true, fault: { present: false } }; }
  catch (value) { return { reason, complete: false, fault: { present: true, value } }; }
  finally { text = null; }
}
