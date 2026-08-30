import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { FIXTURES } from "./fixtures.mjs";
import { PINS } from "./pins.mjs";

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function fixtureFor(fixtureId) {
  const fixture = FIXTURES.find(entry => entry.id === fixtureId);
  if (!fixture) throw new Error("Unknown type fixture ID");
  return fixture;
}

export function materializedFixture(fixtureId, subjectRoot) {
  const fixture = fixtureFor(fixtureId);
  const bytes = Buffer.from(fixture.base64, "base64");
  if (bytes.length !== fixture.bytes || sha256(bytes) !== fixture.sha256) throw new Error("Fixture template integrity");
  const text = bytes.toString("utf8")
    .replace('"__GIT_ENTRY__"', JSON.stringify(`${subjectRoot}/dist/commands/git/index.js`))
    .replace('"__CONTRACTS_ENTRY__"', JSON.stringify(`${subjectRoot}/dist/contracts/index.js`));
  if (text.includes("__GIT_ENTRY__") || text.includes("__CONTRACTS_ENTRY__")) throw new Error("Unresolved fixture token");
  return Buffer.from(text);
}

export function exactRecord(value, names) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Own-data record required");
  const keys = Reflect.ownKeys(value);
  if (keys.length !== names.length || keys.some((key, index) => key !== names[index])) throw new TypeError("Exact record keys/order required");
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) throw new TypeError("Own data property required");
  }
  return value;
}

export function finiteOwnData(value, budget = { nodes: 0 }, depth = 0) {
  if (++budget.nodes > 20000 || depth > 24) throw new TypeError("Response data bound");
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (Buffer.byteLength(value) > 524288) throw new TypeError("Response string bound");
    return;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) return;
  if (typeof value !== "object") throw new TypeError("Finite own data required");
  const keys = Reflect.ownKeys(value);
  if (Array.isArray(value)) {
    const length = Object.getOwnPropertyDescriptor(value, "length");
    if (!length || !Object.hasOwn(length, "value") || !Number.isSafeInteger(length.value) || length.value > 4096) throw new TypeError("Array bound");
    if (keys.length !== length.value + 1 || keys.at(-1) !== "length") throw new TypeError("Array holes/extras refused");
    for (let index = 0; index < length.value; index++) if (keys[index] !== String(index)) throw new TypeError("Array key order");
  }
  for (const key of keys) {
    if (typeof key !== "string") throw new TypeError("Symbol data refused");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new TypeError("Accessor data refused");
    if (Array.isArray(value) && key === "length") continue;
    if (!descriptor.enumerable) throw new TypeError("Nonenumerable data refused");
    finiteOwnData(descriptor.value, budget, depth + 1);
  }
}

export function diagnosticsMatch(fixtureId, fixturePath, subjectRoot, diagnostics) {
  const expected = fixtureFor(fixtureId).diagnostic;
  if (!Array.isArray(diagnostics) || diagnostics.length !== (expected ? 1 : 0)) return false;
  if (!expected) return true;
  const diagnostic = diagnostics[0];
  if (diagnostic.file !== fixturePath || diagnostic.category !== 1 || diagnostic.code !== expected.code ||
      diagnostic.line !== expected.line || diagnostic.column !== expected.column || diagnostic.message !== expected.message) return false;
  if (diagnostic.related.length === 0) return true;
  const property = fixtureId === "T04" ? "discoveryBoundary" : fixtureId === "T05" ? "replace" : null;
  if (property === null || diagnostic.related.length !== 1) return false;
  const related = diagnostic.related[0];
  return related.file === `${subjectRoot}/dist/commands/git/limits.d.ts` && related.code === 6500 && related.category === 3 &&
    related.line === (fixtureId === "T04" ? 3 : 2) && related.column === 14 && related.length === property.length &&
    related.message === `The expected type comes from property '${property}' which is declared here on type 'GitCommandsOptions'` && related.related.length === 0;
}

export function validateResult(result) {
  finiteOwnData(result);
  exactRecord(result, ["schema", "protocol", "fixtureId", "layout", "compiler", "fixture", "diagnostics", "sourceFiles", "raw", "guards", "completed", "matched"]);
  exactRecord(result.compiler, ["version", "sha256", "host", "options"]);
  const options = exactRecord(result.compiler.options, ["strict", "noEmit", "target", "module", "moduleResolution", "types", "typeRoots", "skipLibCheck", "skipDefaultLibCheck", "noLib", "allowJs", "checkJs"]);
  if (options.strict !== true || options.noEmit !== true || options.target !== "ES2022" || options.module !== "NodeNext" || options.moduleResolution !== "NodeNext" ||
      !Array.isArray(options.types) || options.types.length !== 1 || options.types[0] !== "node" || !Array.isArray(options.typeRoots) || options.typeRoots.length !== 1 ||
      typeof options.typeRoots[0] !== "string" || !options.typeRoots[0].startsWith("/") || !options.typeRoots[0].endsWith("/node_modules/@types") ||
      [options.skipLibCheck, options.skipDefaultLibCheck, options.noLib, options.allowJs, options.checkJs].some(value => value !== false)) throw new TypeError("Normal strict compiler options required");
  exactRecord(result.fixture, ["path", "templateSha256", "bytes", "sha256", "subjectRoot"]);
  exactRecord(result.raw, ["path", "mode", "bytes", "sha256"]);
  exactRecord(result.guards, ["before", "after"]);
  if (result.schema !== "m1b-type-api-result-v2" || result.protocol !== "TYPESCRIPT_COMPILER_API" ||
      result.compiler.version !== "5.9.3" || result.compiler.sha256 !== PINS.compilerSha256 ||
      result.compiler.host !== "ADMITTED_MEMORY_COMPILER_HOST" || !Array.isArray(result.diagnostics) ||
      !Array.isArray(result.sourceFiles) || typeof result.completed !== "boolean" || typeof result.matched !== "boolean") throw new TypeError("Compiler API response identity");
  for (const identity of [result.fixture, result.raw]) {
    if (typeof identity.path !== "string" || !identity.path.startsWith("/") || !Number.isSafeInteger(identity.bytes) || identity.bytes < 0 ||
        typeof identity.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(identity.sha256)) throw new TypeError("Artifact identity shape");
  }
  if (result.raw.mode !== 0o600 || result.raw.bytes > 524288 || typeof result.fixture.subjectRoot !== "string" || typeof result.fixture.templateSha256 !== "string") throw new TypeError("Artifact role shape");
  const validateChain = chain => {
    if (typeof chain === "string") return;
    exactRecord(chain, ["messageText", "code", "category", "next"]);
    if (typeof chain.messageText !== "string" || !Number.isSafeInteger(chain.code) || ![0, 1, 2, 3].includes(chain.category) || !Array.isArray(chain.next)) throw new TypeError("Message chain shape");
    for (const child of chain.next) validateChain(child);
  };
  const validateDiagnostic = diagnostic => {
    exactRecord(diagnostic, ["file", "code", "category", "line", "column", "start", "length", "message", "messageChain", "related"]);
    if (!(diagnostic.file === null || typeof diagnostic.file === "string") || !Number.isSafeInteger(diagnostic.code) ||
        ![0, 1, 2, 3].includes(diagnostic.category) || typeof diagnostic.message !== "string" || !Array.isArray(diagnostic.related)) throw new TypeError("Diagnostic shape");
    for (const name of ["line", "column", "start", "length"]) if (diagnostic[name] !== null && (!Number.isSafeInteger(diagnostic[name]) || diagnostic[name] < 0)) throw new TypeError("Diagnostic location");
    validateChain(diagnostic.messageChain);
    for (const related of diagnostic.related) validateDiagnostic(related);
  };
  for (const diagnostic of result.diagnostics) validateDiagnostic(diagnostic);
  for (const entry of result.sourceFiles) {
    exactRecord(entry, ["path", "bytes", "sha256"]);
    if (typeof entry.path !== "string" || !entry.path.startsWith("/") || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 ||
        typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(entry.sha256)) throw new TypeError("Source identity shape");
  }
  return result;
}
