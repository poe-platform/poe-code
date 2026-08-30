export const nodeValueRules = String.raw`
  const valueRecords = [];
  function remember(value, kind, locked) {
    if (value === null || typeof value !== 'object') return value;
    for (let index = 0; index < valueRecords.length; index = index + 1) if (valueRecords[index].value === value) return value;
    if (valueRecords.length >= 100000) unsupported();
    valueRecords.push({value: value, kind: kind, locked: locked});
    return value;
  }
  function category(value) {
    if (typeof value !== 'object' || value === null) return {kind: typeof value, locked: true};
    for (let index = 0; index < valueRecords.length; index = index + 1) if (valueRecords[index].value === value) return valueRecords[index];
    if (nativeArray.isArray(value)) { remember(value, 'array', false); return category(value); }
    if (typeof value.then === 'function') { remember(value, 'promise', true); return category(value); }
    if (typeof value.name === 'string' && typeof value.message === 'string') { remember(value, 'error', false); return category(value); }
    unsupported();
  }
  function recordTree(value, depth) {
    if (value === null || typeof value !== 'object') return value;
    if (depth > 128) unsupported();
    remember(value, nativeArray.isArray(value) ? 'array' : 'record', false);
    const keys = nativeObject.keys(value);
    for (let index = 0; index < keys.length; index = index + 1) recordTree(value[keys[index]], depth + 1);
    return value;
  }
  function propertyKey(value) { if (typeof value !== 'string' && typeof value !== 'number') unsupported(); return nativeString(value); }
  function computedKey(value) { if (typeof value !== 'string') unsupported(); return value; }
  function arrayIndex(key) {
    if (key === '') return -1;
    const index = +key;
    if (index < 0 || index % 1 !== 0 || nativeString(index) !== key) return -1;
    return index;
  }
  function primitiveValue(value) { if (value !== null && (typeof value === 'object' || typeof value === 'function')) unsupported(); return value; }
  function detached() { unsupported(); }
  function getValue(object, rawKey) {
    const key = propertyKey(rawKey);
    if (object === null || object === undefined) throw new TypeError('Cannot read a nullish value');
    const record = category(object);
    if (typeof object === 'string') {
      if (key === 'length') return object.length;
      const index = arrayIndex(key); if (index >= 0) return object[index];
      if (key === 'slice' || key === 'trim') return detached;
      unsupported();
    }
    if (typeof object === 'function') { if (key === 'name' || key === 'length') return object[key]; unsupported(); }
    if (record.kind === 'array') {
      if (key === 'length') return object.length;
      const index = arrayIndex(key); if (index >= 0) return index < object.length ? object[index] : undefined;
      if (key === 'push' || key === 'map') return detached;
      unsupported();
    }
    if (record.kind === 'promise') { if (key === 'then' || key === 'catch' || key === 'finally') return detached; unsupported(); }
    if (record.kind === 'error' && key !== 'name' && key !== 'message' && key !== 'code' && key !== 'errno' && key !== 'path' && key !== 'syscall' && key !== 'dest') unsupported();
    if (record.kind === 'record' || record.kind === 'facade' || record.kind === 'env' || record.kind === 'error') return nativeObject.hasOwn(object, key) ? object[key] : undefined;
    unsupported();
  }
  function reference(object, rawKey, read) { const key = propertyKey(rawKey); return {object: object, key: key, value: read ? getValue(object, key) : undefined}; }
  function assign(target, value) {
    const object = target.object; const key = target.key; const record = category(object);
    if (record.locked || object === null || typeof object !== 'object') unsupported();
    if (record.kind === 'array') {
      if (key === 'length') { if (typeof value !== 'number' || value < 0 || value % 1 !== 0 || value > object.length) unsupported(); }
      else { const index = arrayIndex(key); if (index < 0 || index > object.length || object === process.argv && typeof value !== 'string') unsupported(); }
    } else if (record.kind === 'env') { if (typeof value !== 'string' || key.indexOf('\u0000') !== -1 || key.indexOf('=') !== -1 || value.indexOf('\u0000') !== -1) unsupported(); }
    else if (record.kind === 'error') { if (key !== 'name' && key !== 'message' && key !== 'code' && key !== 'errno' && key !== 'path' && key !== 'syscall' && key !== 'dest') unsupported(); }
    else if (record.kind !== 'record') unsupported();
    object[key] = value; return value;
  }
  function binary(operator, left, right) {
    if ((operator === '==' || operator === '!=') && left !== null && right !== null && (typeof left === 'object' || typeof left === 'function') && (typeof right === 'object' || typeof right === 'function')) return operator === '==' ? left === right : left !== right;
    primitiveValue(left); primitiveValue(right);
    if (operator === '+') return left + right;
    if (operator === '-') return left - right;
    if (operator === '*') return left * right;
    if (operator === '/') return left / right;
    if (operator === '%') return left % right;
    if (operator === '**') return left ** right;
    if (operator === '<') return left < right;
    if (operator === '>') return left > right;
    if (operator === '<=') return left <= right;
    if (operator === '>=') return left >= right;
    if (operator === '==') return left == right;
    if (operator === '!=') return left != right;
    unsupported();
  }
  function unary(operator, value) { primitiveValue(value); return operator === '+' ? +value : -value; }
  function compound(target, operator, value) { return assign(target, binary(operator, target.value, value)); }
  function update(target, delta, prefix) { const before = unary('+', target.value); const after = before + delta; assign(target, after); return prefix ? after : before; }
  function updateVariable(getter, setter, delta, prefix) { const before = unary('+', getter()); const after = before + delta; setter(after); return prefix ? after : before; }
  function remove(object, rawKey) { const key = propertyKey(rawKey); const record = category(object); if (record.locked || record.kind !== 'record' && record.kind !== 'env') unsupported(); return delete object[key]; }
  function callable(value) { if (typeof value !== 'function') unsupported(); return value; }
  function adopt(value) { if (value !== null && typeof value === 'object' && category(value).kind !== 'promise' && typeof value.then === 'function') unsupported(); return value; }
  function reaction(callback, noArguments) { if (callback === undefined) return undefined; callable(callback); return function (value) { return adopt(noArguments ? callback() : callback(value)); }; }
  function callValue(callback, args) { if (args.length > 16) unsupported(); return callable(callback)(...args); }
  function method(object, rawKey, args) {
    const key = propertyKey(rawKey); if (args.length > 16) unsupported();
    if (object === null || object === undefined) throw new TypeError('Cannot call a nullish value');
    const record = category(object);
    if (typeof object === 'string') {
      if (key === 'trim' && args.length === 0) return object.trim();
      if (key === 'slice' && (args.length === 1 || args.length === 2)) {
        for (let index = 0; index < args.length; index = index + 1) if (typeof args[index] !== 'number' || args[index] % 1 !== 0) unsupported();
        return args.length === 1 ? object.slice(args[0]) : object.slice(args[0], args[1]);
      }
      unsupported();
    }
    if (record.kind === 'array') {
      if (key === 'push') { for (let index = 0; index < args.length; index = index + 1) assign(reference(object, object.length, false), args[index]); return object.length; }
      if (key === 'map' && args.length === 1) {
        callable(args[0]); const length = object.length; const result = remember([], 'array', false);
        for (let index = 0; index < length; index = index + 1) { if (!nativeObject.hasOwn(object, nativeString(index))) unsupported(); result.push(args[0](object[index], index, object)); }
        return result;
      }
      unsupported();
    }
    if (record.kind === 'promise') {
      if (key === 'then' && args.length <= 2) return remember(object.then(reaction(args[0], false), reaction(args[1], false)), 'promise', true);
      if (key === 'catch' && args.length === 1) return remember(object.catch(reaction(callable(args[0]), false)), 'promise', true);
      if (key === 'finally' && args.length === 1) return remember(object.finally(reaction(callable(args[0]), true)), 'promise', true);
      unsupported();
    }
    return callValue(getValue(object, key), args);
  }
  function unbound(name) { throw new ReferenceError(name + ' is not defined'); }
  function ownKeys(value) {
    if (value === null || typeof value !== 'object') unsupported();
    const kind = category(value).kind; if (kind !== 'array' && kind !== 'record' && kind !== 'env' && kind !== 'facade' && kind !== 'error') unsupported();
    const keys = nativeObject.keys(value); if (kind !== 'error') return keys;
    const result = []; for (let index = 0; index < keys.length; index = index + 1) if (keys[index] === 'name' || keys[index] === 'message' || keys[index] === 'code' || keys[index] === 'errno' || keys[index] === 'path' || keys[index] === 'syscall' || keys[index] === 'dest') result.push(keys[index]); return result;
  }
  const __vnodeRules = nativeObject.freeze({adopt: adopt, get: getValue, key: computedKey, reference: reference, assign: assign, binary: binary, unary: unary, compound: compound, update: update, updateVariable: updateVariable, remove: remove, call: callValue, method: method, unbound: unbound, object: function (value) { return remember(value, 'record', false); }, array: function (value) { return remember(value, 'array', false); }});
`;
