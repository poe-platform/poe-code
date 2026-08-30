import assert from 'node:assert/strict';
import crypto from 'node:crypto';

export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const objectId = (kind, bytes) => crypto.createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest('hex');
export function canonical(entries) {
  const directories = new Map([['', []]]), leaves = new Set();
  for (const entry of entries) {
    const bytes = Buffer.from(entry.pathHex, 'hex');
    assert.ok(bytes.length && !bytes.includes(0));
    const components = [];
    let start = 0;
    for (let cursor = 0; cursor <= bytes.length; cursor++) {
      if (cursor !== bytes.length && bytes[cursor] !== 47) continue;
      const component = bytes.subarray(start, cursor);
      assert.ok(component.length && !component.equals(Buffer.from('.')) && !component.equals(Buffer.from('..')));
      components.push(component.toString('hex')); start = cursor + 1;
    }
    let parent = '';
    for (const component of components.slice(0, -1)) {
      const key = parent + '/' + component;
      assert.ok(!leaves.has(key));
      if (!directories.has(key)) { directories.set(key, []); directories.get(parent).push({ nameHex: component, mode: '40000', child: key }); }
      parent = key;
    }
    const key = parent + '/' + components.at(-1);
    assert.ok(!leaves.has(key) && !directories.has(key)); leaves.add(key);
    directories.get(parent).push({ nameHex: components.at(-1), mode: entry.mode, oid: entry.oid });
  }
  const results = new Map();
  for (const key of [...directories.keys()].sort((left, right) => right.split('/').length - left.split('/').length)) {
    const children = directories.get(key);
    children.sort((left, right) => {
      const leftName = Buffer.from(left.nameHex, 'hex'), rightName = Buffer.from(right.nameHex, 'hex');
      for (let cursor = 0; cursor <= Math.min(leftName.length, rightName.length); cursor++) {
        const leftByte = cursor < leftName.length ? leftName[cursor] : left.child === undefined ? 0 : 47;
        const rightByte = cursor < rightName.length ? rightName[cursor] : right.child === undefined ? 0 : 47;
        if (leftByte !== rightByte) return leftByte - rightByte;
      }
      return 0;
    });
    const payload = Buffer.concat(children.map(entry => Buffer.concat([Buffer.from(entry.mode + ' '), Buffer.from(entry.nameHex, 'hex'), Buffer.from([0]), Buffer.from(entry.child === undefined ? entry.oid : results.get(entry.child).oid, 'hex')])));
    results.set(key, { oid: objectId('tree', payload), payload, order: children.map(entry => ({ nameHex: entry.nameHex, mode: entry.mode })) });
  }
  return { root: results.get(''), directories: [...results].map(([componentHexKey, entry]) => ({ componentHexKey, oid: entry.oid, payloadHex: entry.payload.toString('hex'), order: entry.order })) };
}
