import { nodeLimits, type NodeSelector } from "./types.js";
import { text } from "./values.js";
import { lowerNodeSource } from "./lower.js";
import { nodeValueRules } from "./rules.js";

const library = String.raw`

(function (__vnodeRaw, __vnodeContext, __vnodeGuest) {
  const nativeJSON = JSON;
  const nativeObject = Object;
  const nativeArray = Array;
  const nativePromise = Promise;
  const nativeString = String;
  const nativeError = Error;
${nodeValueRules}
  function unsupported() { const error = new nativeError('Unsupported restricted Node operation'); error.code = 'ERR_VNODE_UNSUPPORTED'; throw error; }
  function utf8(value, maximum) {
    if (typeof value !== 'string' || value.length > maximum) unsupported();
    let total = 0;
    for (let offset = 0; offset < value.length; offset = offset + 1) {
      const first = value.charCodeAt(offset);
      if (first < 128) total = total + 1;
      else if (first < 2048) total = total + 2;
      else if (first >= 55296 && first <= 56319 && offset + 1 < value.length && value.charCodeAt(offset + 1) >= 56320 && value.charCodeAt(offset + 1) <= 57343) { total = total + 4; offset = offset + 1; }
      else total = total + 3;
      if (total > maximum) unsupported();
    }
    return total;
  }
  function primitive(value) {
    if (value !== null && typeof value !== 'undefined' && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') unsupported();
    return nativeString(value);
  }
  function tuple(argumentsValue, maximum) {
    if (argumentsValue.length > maximum) unsupported();
    const result = [];
    for (let index = 0; index < argumentsValue.length; index = index + 1) result.push(argumentsValue[index]);
    return result;
  }
  function pathValue(value) { utf8(value, 1024); if (value.indexOf('\u0000') !== -1) unsupported(); return value; }
  function call(op, authority, path, flag, body, moduleKey) {
    const envelope = nativeJSON.parse(__vnodeRaw(op, authority, path, flag, body, moduleKey));
    let failure;
    if (envelope.error !== null) {
      failure = new nativeError(envelope.error.message);
      failure.name = envelope.error.name;
      failure.code = envelope.error.code;
      if (envelope.kind === 'fsError') {
        failure.errno = envelope.error.errno;
        if (envelope.error.path !== null) failure.path = envelope.error.path;
        if (envelope.error.syscall !== null) failure.syscall = envelope.error.syscall;
        if (envelope.error.dest !== null) failure.dest = envelope.error.dest;
      }
      remember(failure, 'error', false);
    }
    __vnodeRaw('delivered', 'postcopy-v1', nativeString(envelope.sequence), envelope.kind, null, null);
    if (failure !== undefined) throw failure;
    return envelope;
  }
  function options(value, writing, fd) {
    if (value === 'utf8') return writing ? 'w' : 'r';
    if (value === null || typeof value !== 'object' || nativeArray.isArray(value)) unsupported();
    const keys = nativeObject.keys(value);
    if (keys.length > 2) unsupported();
    for (let index = 0; index < keys.length; index = index + 1) if (keys[index] !== 'encoding' && keys[index] !== 'flag') unsupported();
    if (nativeObject.hasOwn(value, 'encoding') ? value.encoding !== 'utf8' : !writing) unsupported();
    if (nativeObject.hasOwn(value, 'flag') && (fd || (writing ? value.flag !== 'w' && value.flag !== 'wx' : value.flag !== 'r'))) unsupported();
    return nativeObject.hasOwn(value, 'flag') ? value.flag : writing ? 'w' : 'r';
  }
  const fs = nativeObject.freeze({
    readFileSync: function (path, encoding) {
      if (arguments.length !== 2) unsupported();
      options(encoding, false, path === 0);
      if (path === 0) return call('readText', 'stdin', null, 'r', null, null).text;
      return call('readText', 'data', pathValue(path), 'r', null, null).text;
    },
    writeFileSync: function (path, value, encoding) {
      if (arguments.length !== 2 && arguments.length !== 3) unsupported();
      const filename = pathValue(path);
      utf8(value, 1048576);
      const flag = arguments.length === 2 ? 'w' : options(encoding, true, false);
      call('writeText', 'data', filename, flag, value, null);
      return undefined;
    }
  });
  function write(channel, value) { utf8(value, 1048576); call('writeOutput', channel, null, null, value, null); return true; }
  const process = nativeObject.freeze({
    argv: __vnodeContext.argv,
    env: __vnodeContext.env,
    cwd: function () { if (arguments.length !== 0) unsupported(); return __vnodeContext.cwd; },
    execPath: '/virtual/bin/node',
    stdin: nativeObject.freeze({fd: 0}),
    stdout: nativeObject.freeze({fd: 1, write: function (value) { if (arguments.length !== 1) unsupported(); return write('stdout', value); }}),
    stderr: nativeObject.freeze({fd: 2, write: function (value) { if (arguments.length !== 1) unsupported(); return write('stderr', value); }})
  });
  function logging(channel, values) {
    let output = '';
    for (let index = 0; index < values.length; index = index + 1) {
      const current = primitive(values[index]);
      utf8(current, 1048576);
      if (output.length + current.length + 2 > 1048576) unsupported();
      if (index > 0) output = output + ' ';
      output = output + current;
    }
    utf8(output, 1048575);
    write(channel, output + '\n');
  }
  const console = nativeObject.freeze({
    log: function () { logging('stdout', tuple(arguments, 16)); },
    error: function () { logging('stderr', tuple(arguments, 16)); }
  });
  function pathMethod(method, minimum, maximum) {
    return function () {
      const values = tuple(arguments, maximum);
      if (values.length < minimum) unsupported();
      for (let index = 0; index < values.length; index = index + 1) pathValue(values[index]);
      const result = call('path', 'path', null, null, nativeJSON.stringify(values), method).text;
      return method === 'isAbsolute' ? result === 'true' : result;
    };
  }
  const path = {
    join: pathMethod('join', 0, 16), resolve: pathMethod('resolve', 0, 16),
    normalize: pathMethod('normalize', 1, 1), dirname: pathMethod('dirname', 1, 1),
    basename: pathMethod('basename', 1, 2), extname: pathMethod('extname', 1, 1),
    relative: pathMethod('relative', 2, 2), isAbsolute: pathMethod('isAbsolute', 1, 1),
    sep: '/', delimiter: ':'
  };
  path.posix = path;
  nativeObject.freeze(path);
  const cache = {};
  let roots = 0;
  let jsonBytes = 0;
  function require(target) {
    if (arguments.length !== 1 || typeof target !== 'string') unsupported();
    utf8(target, 1024);
    const name = target.slice(0, 5) === 'node:' ? target.slice(5) : target;
    if (name === 'fs' || name === 'path' || name === 'process') {
      call('authorizeModule', 'module', null, null, null, name);
      return name === 'fs' ? fs : name === 'path' ? path : process;
    }
    if ((target.slice(0, 2) !== './' && target.slice(0, 3) !== '../' && target.slice(0, 1) !== '/') || target.slice(-5) !== '.json') unsupported();
    const authorized = call('authorizeJson', 'json', pathValue(target), 'r', null, null).cacheKey;
    const key = nativeJSON.stringify([authorized.namespace, authorized.path]);
    if (nativeObject.hasOwn(cache, key)) return cache[key];
    if (roots >= 32) unsupported();
    const result = call('readText', 'json', authorized.path, 'r', null, null);
    if (result.cacheKey.namespace !== authorized.namespace || result.cacheKey.path !== authorized.path) unsupported();
    const size = utf8(result.text, 1048576);
    if (size > 1048576 - jsonBytes) unsupported();
    jsonBytes = jsonBytes + size;
    const parsed = recordTree(nativeJSON.parse(result.text), 0);
    cache[key] = parsed;
    roots = roots + 1;
    return parsed;
  }
  function jsonValue(value, ancestors) {
    const kind = typeof value;
    if (value === null || kind === 'string' || kind === 'number' || kind === 'boolean' || kind === 'undefined') return;
    if (kind !== 'object') unsupported();
    if (category(value).kind === 'error' || category(value).kind === 'promise') unsupported();
    if (ancestors.length >= 128) unsupported();
    for (let index = 0; index < ancestors.length; index = index + 1) if (ancestors[index] === value) throw new TypeError('Cyclic JSON value');
    const path = ancestors.slice(); path.push(value);
    const keys = nativeObject.keys(value);
    if (nativeArray.isArray(value)) {
      if (keys.length !== value.length) unsupported();
      for (let index = 0; index < value.length; index = index + 1) { if (!nativeObject.hasOwn(value, nativeString(index))) unsupported(); jsonValue(value[index], path); }
    } else for (let index = 0; index < keys.length; index = index + 1) jsonValue(value[keys[index]], path);
  }
  const safeJSON = nativeObject.freeze({
    parse: function (value) { if (arguments.length !== 1) unsupported(); utf8(value, 1048576); return recordTree(nativeJSON.parse(value), 0); },
    stringify: function (value, replacer, space) {
      if (arguments.length !== 1 && arguments.length !== 3) unsupported();
      if (arguments.length === 3 && (replacer !== undefined || typeof space !== 'number' || space < 0 || space > 10 || space % 1 !== 0)) unsupported();
      jsonValue(value, []);
      const result = arguments.length === 1 ? nativeJSON.stringify(value) : nativeJSON.stringify(value, undefined, space);
      if (result !== undefined) utf8(result, 1048576);
      return result;
    }
  });
  const safeObject = nativeObject.freeze({
    keys: function (value) { if (arguments.length !== 1) unsupported(); return ownKeys(value); },
    hasOwn: function (value, name) { if (arguments.length !== 2 || typeof name !== 'string') unsupported(); const keys = ownKeys(value); for (let index = 0; index < keys.length; index = index + 1) if (keys[index] === name) return true; return false; }
  });
  const safeArray = nativeObject.freeze({ isArray: function (value) { if (arguments.length !== 1) unsupported(); return nativeArray.isArray(value); } });
  const safePromise = nativeObject.freeze({
    resolve: function (value) { if (arguments.length !== 1) unsupported(); if (value !== null && typeof value === 'object' && category(value).kind !== 'promise' && typeof value.then === 'function') unsupported(); return remember(nativePromise.resolve(value), 'promise', true); },
    reject: function (value) { if (arguments.length !== 1) unsupported(); return remember(nativePromise.reject(value), 'promise', true); },
    race: function (value) { if (arguments.length !== 1 || !nativeArray.isArray(value) || value.length !== 0 || nativeObject.keys(value).length !== 0) unsupported(); return remember(nativePromise.race(value), 'promise', true); }
  });
  function errorConstructor(factory) { return function (message) { if (arguments.length > 1 || arguments.length === 1 && typeof message !== 'string') unsupported(); return remember(arguments.length === 0 ? new factory() : new factory(message), 'error', false); }; }
  function stringConstructor(value) { if (arguments.length !== 1) unsupported(); return primitive(value); }
  remember(process, 'facade', true); remember(process.env, 'env', false); remember(process.argv, 'array', false);
  remember(process.stdin, 'facade', true); remember(process.stdout, 'facade', true); remember(process.stderr, 'facade', true);
  remember(console, 'facade', true); remember(fs, 'facade', true); remember(path, 'facade', true);
  remember(safeJSON, 'facade', true); remember(safeObject, 'facade', true); remember(safeArray, 'facade', true); remember(safePromise, 'facade', true);
  const returned = __vnodeGuest(require, console, process, safeJSON, safeObject, safeArray, safePromise, errorConstructor(Error), errorConstructor(TypeError), errorConstructor(RangeError), errorConstructor(SyntaxError), errorConstructor(ReferenceError), stringConstructor, __vnodeContext.filename, __vnodeContext.directory, __vnodeRules);
  if (__vnodeContext.selector === 'print') {
    if (returned !== null && typeof returned !== 'undefined' && typeof returned !== 'string' && typeof returned !== 'number' && typeof returned !== 'boolean') {
      __vnodeRaw('printRefusal', null, null, null, null, null);
      unsupported();
    }
    logging('stdout', [returned]);
  }
  __vnodeRaw('cutoff', null, null, null, null, null);
})(__vnodeBridge, __vnodeContext, __vnodeEntry);
`;

export function buildNodeProgram(source: string, selector: NodeSelector): string {
  const names = "require,console,process,JSON,Object,Array,Promise,Error,TypeError,RangeError,SyntaxError,ReferenceError,String,__vnodeFilename,__vnodeDirectory,__vnodeRules";
  const lowered = lowerNodeSource(source, selector);
  const body = selector === "print" ? "return (\n" + lowered + "\n);" : lowered;
  const bindings = selector === "file" ? "const __filename = __vnodeFilename; const __dirname = __vnodeDirectory;\n" : "";
  const marker = "__vnodeBridge('entry', null, null, null, null, null);\n";
  const program = "const __vnodeEntry = function(" + names + ") {\n" + marker + bindings + body + "\n};\n" + library;
  return text(program, nodeLimits.sourceBytes, "combined interpreted source");
}
