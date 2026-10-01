import { mkdir, realpath, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { CommanderError } from "commander";
import { UserError } from "./index.js";
import { ApprovalDeclinedError } from "./approval-error.js";
import { findPackageMetadata } from "./package-metadata.js";
import { findProjectRoot } from "./project-root.js";
import { isSensitiveName, redactHttpBody, redactHttpHeaderValue, redactSecretLikeFields } from "./redaction.js";
import { isHttpErrorLike } from "./api-error-summary.js";
import { callNative, protect } from "./host-errors.js";

const native = createRequire(import.meta.url)("./toolcraft-rust.node");
let depth = 0;
function invoke(operation, args) {
  if (depth >= 128) throw new RangeError("Maximum call stack size exceeded");
  depth++;
  try { return callNative(native.errorReportPolicy, operation, args, host); }
  finally { depth--; }
}

function secretEnvNames(secrets) {
  return secrets === undefined ? [] : Object.values(secrets).map(secret => secret.env);
}
function stableJson(value) { return JSON.stringify(value, null, 2) ?? "undefined"; }

const operations = {
  undefined: () => undefined,
  record: () => ({}),
  list: () => [],
  set: () => new Set(),
  root: () => "root",
  emptyString: () => "",
  redacted: () => "<redacted>",
  true: () => true,
  falseValue: () => false,
  false: value => value === false,
  truthy: value => !!value,
  string: value => typeof value === "string",
  object: value => typeof value === "object" && value !== null && !Array.isArray(value),
  objectType: value => typeof value === "object",
  array: Array.isArray,
  error: value => value instanceof Error,
  typeof: value => typeof value,
  stringify: value => String(value),
  property: (value, key) => value[key],
  values: Object.values,
  add: (set, value) => set.add(value),
  has: (set, value) => !!set.has(value),
  positiveLength: value => value.length > 0,
  zeroLength: value => value.length === 0,
  sensitive: isSensitiveName,
  redactHeader: redactHttpHeaderValue,
  redactFields: redactSecretLikeFields,
  redactString: (redact, value) => redact(value),
  leaves: (...args) => invoke("leaves", args),
  collectParam: (...args) => invoke("collectParam", args),
  redactParam: (...args) => invoke("redactParam", args),
  structured: (...args) => invoke("structured", args),
  eachLeaf(value, values) { for (const entry of value) invoke("leaves", [entry, values]); },
  collectObject(value, schema, values) {
    for (const [key, child] of Object.entries(value)) invoke("collectChild", [child, schema, key, values]);
  },
  collectArray(value, schema, name, values) {
    for (const entry of value) invoke("collectParam", [entry, schema.item, name, values]);
  },
  redactObject: (value, schema) => Object.fromEntries(Object.entries(value).map(([key, child]) => [key, invoke("paramChild", [child, schema, key])])),
  redactArray: (value, schema, name) => value.map(entry => invoke("redactParam", [entry, schema.item, name])),
  contextSecrets(context, values) {
    for (const value of Object.values(context.secrets ?? {})) invoke("addSecret", [value, values]);
  },
  declaredSecrets(context, env, values) {
    for (const [name, secret] of Object.entries(context.command?.secrets ?? {})) invoke("declaredSecret", [context, env, name, secret, values]);
  },
  unsetSecretLine: secret => `${secret.env}=<unset>`,
  setSecretLine: (secret, value) => `${secret.env}=<set, ${value.length} chars>`,
  stringRedactor(values) {
    const ordered = [...values].sort((left, right) => right.length - left.length);
    return value => {
      let redacted = value;
      for (const secret of ordered) redacted = redacted.split(secret).join("<redacted>");
      return redacted;
    };
  },
  structuredArray: (name, value, redact) => value.map(entry => invoke("structured", [name, entry, redact])),
  structuredObject: (value, redact) => Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, invoke("structured", [key, entry, redact])])),
  eachOwnField(error, redact, output) {
    for (const key of Object.keys(error)) invoke("ownField", [error, redact, output, key]);
  },
  define: (object, key, value) => Object.defineProperty(object, key, { value, enumerable: true, configurable: true, writable: true }),
  circular: lines => lines.push("Caused by: [Circular]"),
  causePrefix: value => `Caused by: ${value}`,
  push: (lines, value) => lines.push(value),
  joinLines: lines => lines.join("\n"),
  argvState: options => ({
    values: new Set(Object.values(options.secrets ?? {}).filter(value => value !== undefined && value.length > 0)),
    names: new Set([...Object.keys(options.secrets ?? {}), ...secretEnvNames(options.command?.secrets)]),
    output: [], redactNext: false
  }),
  eachArg(argv, state) { for (const arg of argv) invoke("arg", [arg, state]); },
  equalsIndex: arg => arg.indexOf("="),
  minusOne: value => value === -1,
  sliceOption: (arg, index) => arg.slice(0, index),
  optionName: name => name.replaceAll("-", ""),
  secretName: (state, normalized) => [...state.names].some(name => normalized.toLowerCase().includes(name.toLowerCase())),
  dashPrefix: arg => arg.startsWith("-"),
  redactNextArg(state) { state.output.push("<redacted>"); state.redactNext = false; },
  redactEqualsArg: (state, name) => state.output.push(`${name}=<redacted>`),
  deferArg(state, arg) { state.output.push(arg); state.redactNext = true; },
  redactArgValues(state, arg) {
    let redacted = arg;
    for (const value of state.values) redacted = redacted.split(value).join("<redacted>");
    state.output.push(redacted);
  },
  env: () => process.env,
  approvalError: error => error instanceof ApprovalDeclinedError,
  commanderError: error => error instanceof CommanderError,
  userError: error => error instanceof UserError,
  httpError: isHttpErrorLike,
  findRoot: findProjectRoot,
  tmpdir: () => os.tmpdir(),
  relative: (parent, child) => path.relative(parent, child),
  absolute: value => path.isAbsolute(value),
  parentPrefix: value => value.startsWith(`..${path.sep}`),
  dotDotPrefix: value => value.startsWith(".."),
  defaultDir: root => path.join(root, ".toolcraft", "errors"),
  join: (root, dir) => path.join(root, dir),
  reportDir: (...args) => invoke("reportDir", args),
  writeState(context, projectRoot, reportDir) {
    const timestamp = native.reportTimestamp(new Date().toISOString());
    const commandPath = context.commandPath;
    const source = commandPath === undefined || commandPath.length === 0 ? "root" : commandPath;
    const slug = native.reportSlug(Array.from(source, char => char.toLowerCase()));
    const fileName = `${timestamp}-${slug}-${randomUUID()}.log`;
    return { projectRoot, reportDir, absolutePath: path.join(reportDir, fileName) };
  },
  outside() { throw new Error("Error report directory resolves outside project root."); },
  overflow() { throw new RangeError("Maximum call stack size exceeded"); },
  invalidOperation() { throw new TypeError("Invalid error report operation"); }
};
const host = { operate: protect((name, args) => operations[name](...args)), get: protect((value, key) => value[key]) };

function formatBody(body, redactString) {
  const redacted = redactHttpBody(body);
  return redactString(typeof redacted === "string" ? redacted : stableJson(redacted));
}
function formatHeaders(headers, redactString) {
  return Object.entries(headers).map(([name, value]) => `${name}: ${redactString(redactHttpHeaderValue(name, value))}`).join("\n");
}
function httpTranscript(error, redactString) {
  const lines = [`${error.request.method} ${error.request.url}`, formatHeaders(error.request.headers, redactString)].filter(line => line.length > 0);
  if (error.request.body !== undefined) lines.push("", formatBody(error.request.body, redactString));
  return ["Request:", ...lines, "", "Response:", `${error.response.status} ${error.response.statusText}`,
    formatHeaders(error.response.headers, redactString), "", formatBody(error.response.body, redactString)].join("\n");
}

export function renderErrorReport(context) {
  const env = context.env ?? process.env;
  const error = context.error;
  const redactString = invoke("redactor", [context, env]);
  const errorName = invoke("errorName", [error]);
  const errorMessage = redactString(invoke("errorMessage", [error]));
  const fields = invoke("ownFields", [error, redactString]);
  const secretLines = Object.entries(context.command?.secrets ?? {}).map(([name, secret]) => invoke("secretLine", [context, env, name, secret]));
  const lines = [
    "Toolcraft Error Report", "", "Runtime",
    `toolcraft version: ${context.version ?? findPackageMetadata(new URL("./error-report.ts", import.meta.url))?.version ?? "unknown"}`,
    `node version: ${process.version}`, `platform: ${process.platform} ${process.arch}`, "", "Argv",
    redactString(stableJson(invoke("argv", [context.argv, { command: context.command, secrets: context.secrets }]))),
    "", "Resolved Secrets", ...(secretLines.length === 0 ? ["<none>"] : secretLines), "", "Command Path",
    invoke("commandPath", [context]), "", "Parsed Params",
    redactString(stableJson(invoke("redactParams", [context.params, context.command]))),
    "", "Error", `name: ${errorName}`, `message: ${errorMessage}`, "structured fields:",
    redactString(stableJson(fields)), "", "Stack", invoke("stack", [error, redactString])
  ];
  if (isHttpErrorLike(error)) lines.push("", "HTTP Transcript", httpTranscript(error, redactString));
  const content = `${lines.join("\n")}\n`;
  return { content, redactedKeys: secretEnvNames(context.command?.secrets) };
}

export async function writeErrorReport(context) {
  const state = invoke("writeStart", [context]);
  if (state === undefined) return undefined;
  const { projectRoot, reportDir, absolutePath } = state;
  await mkdir(reportDir, { recursive: true });
  if (invoke("confine", [context.errorReports, projectRoot])) {
    invoke("assertWithin", [path.resolve(projectRoot), path.resolve(reportDir)]);
    const [canonicalRoot, canonicalDir] = await Promise.all([realpath(projectRoot), realpath(reportDir)]);
    invoke("assertWithin", [canonicalRoot, canonicalDir]);
  }
  await writeFile(absolutePath, renderErrorReport(context).content);
  return { absolutePath, displayPath: invoke("displayPath", [projectRoot, absolutePath]) };
}

export { isHttpErrorLike as hasHttpContext };
