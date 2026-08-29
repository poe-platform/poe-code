export function observeArrays(ArrayOwner, IndexedBinding) {
  const rows = [], owners = new Map(), bindings = new Map(), originals = [], pending = new Set();
  let failed = false, failure;
  const remember = reason => { if (!failed) { failed = true; failure = reason; } };
  const identity = (map, value) => { if (!map.has(value)) { if (map.size >= 256) throw new Error('observer identity cap'); map.set(value, map.size + 1); } return map.get(value); };
  const snapshot = owner => {
    const value = owner.ledger.snapshot();
    if (value.used.length !== 7 || value.caps && value.caps.length !== 7) throw new Error('ledger snapshot cardinality');
    for (const count of [...value.used, ...value.caps ?? [], value.lastIssued]) if (!Number.isSafeInteger(count) || count < 0) throw new Error('ledger snapshot integer');
    return value;
  };
  const record = row => { if (rows.length >= 4096) throw new Error('array observer record cap'); rows.push(row); };
  for (const [prototype, name, kind] of [[ArrayOwner.prototype, 'reserve', 'owner'], [ArrayOwner.prototype, 'hold', 'owner'], [ArrayOwner.prototype, 'close', 'owner'], [IndexedBinding.prototype, 'retain', 'binding'], [IndexedBinding.prototype, 'release', 'binding']]) {
    const original = prototype[name];
    if (typeof original !== 'function') throw new Error('private method identity');
    originals.push([prototype, name, original]);
    prototype[name] = function(...args) {
      let before, objectId, owner;
      try { owner = kind === 'owner' ? this : this.owner; objectId = identity(kind === 'owner' ? owners : bindings, this); before = snapshot(owner); } catch (reason) { remember(reason); }
      let returned;
      try { returned = Reflect.apply(original, this, args); }
      catch (reason) { try { record({ kind, name, objectId, before, after: owner && snapshot(owner), outcome: 'throw', message: String(reason), charge: name === 'reserve' ? { ...args[0] } : undefined }); } catch (error) { remember(error); } throw reason; }
      try { record({ kind, name, objectId, before, after: snapshot(owner), outcome: 'return', charge: name === 'reserve' ? { ...args[0] } : undefined }); } catch (reason) { remember(reason); }
      if (name === 'close' || name === 'release') {
        const observed = Promise.resolve(returned).then(() => { try { record({ kind, name, objectId, after: snapshot(owner), outcome: 'settled' }); } catch (reason) { remember(reason); } }, reason => { try { record({ kind, name, objectId, outcome: 'rejected', message: String(reason) }); } catch (error) { remember(error); } });
        pending.add(observed); void observed.finally(() => pending.delete(observed)).catch(remember);
      }
      return returned;
    };
  }
  return { rows, async settle() { await Promise.all([...pending]); if (failed) throw failure; }, restore() { for (const [prototype, name, original] of originals) prototype[name] = original; }, qualification: 'Forwarding TEST-ONLY private observations. No counter injection, limit lowering, or changed method return/rejection. Observer failure never prevents the original call.' };
}
