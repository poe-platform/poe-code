// Executed only by the injected interpreter: eval here is guest Script evaluation.
export const nodeRequireSource = `
const __safeBashModuleCache = new Map();
const __safeBashMakeRequire = base => name => {
  const path = __safeBashModulePath(base, name);
  if (path === null) return __safeBashRequire(name);
  if (__safeBashModuleCache.has(path)) return __safeBashModuleCache.get(path).exports;
  let source;
  try { source = __safeBashModuleRead(path); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    const missing = new Error("Cannot find module '" + name + "'");
    missing.code = "MODULE_NOT_FOUND";
    throw missing;
  }
  if (source.startsWith("\\uFEFF")) source = source.slice(1);
  const module = { exports: {} };
  if (path.endsWith(".json")) {
    module.exports = JSON.parse(source);
    __safeBashModuleCache.set(path, module);
    return module.exports;
  }
  if (source.startsWith("#!")) {
    const newline = source.indexOf("\\n");
    source = newline < 0 ? "" : source.slice(newline);
  }
  __safeBashModuleCache.set(path, module);
  try {
    const directory = path.slice(0, path.lastIndexOf("/")) || "/";
    (function(exports, require, module, __filename, __dirname) {
      eval(source);
    }).call(module.exports, module.exports, __safeBashMakeRequire(directory), module, path, directory);
  } catch (error) {
    __safeBashModuleCache.delete(path);
    throw error;
  }
  return module.exports;
};
const require = __safeBashMakeRequire(__safeBashEntryDirectory);
for (const name of __safeBashPreloads) __safeBashMakeRequire(__safeBashCwd)(name);
`;
