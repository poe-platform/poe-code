import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import * as performanceHooks from "node:perf_hooks";
import { Script, createContext } from "node:vm";
import { sha256 } from "./protocol.mjs";

export function createSnapshotView(admitted) {
  const files = new Map(admitted.snapshot);
  files.set(admitted.compilerPath, admitted.compilerBytes);
  const directories = new Set();
  for (const filename of files.keys()) {
    let directory = path.dirname(filename);
    for (;;) {
      directories.add(directory);
      if (directory === path.dirname(directory)) break;
      directory = path.dirname(directory);
    }
  }
  const probes = new Map();
  const denied = [];
  let calls = 0;
  const absolute = filename => {
    if (typeof filename !== "string" || filename.includes("\0") || filename.length > 8192) throw new Error("Compiler path data refused");
    return path.resolve(admitted.request.caseRoot, filename);
  };
  const probe = (operation, filename) => {
    if (++calls > 100000) throw new Error("Compiler lookup count bound");
    const resolved = absolute(filename);
    const key = `${operation}:${resolved}`;
    if (!probes.has(key) && probes.size >= 2048) throw new Error("Compiler lookup identity bound");
    const entry = probes.get(key) ?? { operation, path: resolved, calls: 0, present: files.has(resolved) || directories.has(resolved) };
    entry.calls++;
    probes.set(key, entry);
    return resolved;
  };
  const deny = operation => {
    if (denied.length < 32) denied.push(operation);
    throw new Error(`Undeclared compiler host operation: ${operation}`);
  };
  const exists = filename => files.has(probe("fileExists", filename));
  const read = filename => files.get(probe("readFile", filename));
  const stat = (filename, options) => {
    const resolved = probe("stat", filename);
    if (!files.has(resolved) && !directories.has(resolved)) {
      if (options?.throwIfNoEntry === false) return undefined;
      const error = new Error("Missing admitted snapshot entry");
      error.code = "ENOENT";
      throw error;
    }
    return {
      size: files.get(resolved)?.length ?? 0,
      isFile: () => files.has(resolved),
      isDirectory: () => directories.has(resolved),
      isSymbolicLink: () => false,
      mtime: new Date(0),
    };
  };
  const realpath = filename => probe("realpath", filename);
  realpath.native = realpath;
  const fs = Object.freeze({
    existsSync: exists, statSync: stat, lstatSync: stat, realpathSync: realpath,
    readFileSync(filename, encoding) {
      const bytes = read(filename);
      if (!bytes) {
        const error = new Error("Missing admitted snapshot file");
        error.code = "ENOENT";
        throw error;
      }
      if (encoding === undefined) return Buffer.from(bytes);
      if (encoding !== "utf8" && encoding !== "utf-8") return deny("fs encoding");
      return bytes.toString("utf8");
    },
    readdirSync: () => deny("fs.readdirSync"),
    openSync: () => deny("fs.openSync"),
    readSync: () => deny("fs.readSync"),
    writeFileSync: () => deny("fs.writeFileSync"),
    writeSync: () => deny("fs.writeSync"),
    mkdirSync: () => deny("fs.mkdirSync"),
    unlinkSync: () => deny("fs.unlinkSync"),
    watchFile: () => deny("fs.watchFile"),
    watch: () => deny("fs.watch"),
  });
  return {
    files, directories, probes, denied, absolute, probe, deny, fs,
    readText(filename) { const bytes = read(filename); return bytes?.toString("utf8"); },
    fileExists: exists,
    directoryExists(filename) { return directories.has(probe("directoryExists", filename)); },
    getDirectories(filename) {
      const root = probe("getDirectories", filename);
      return [...directories].filter(directory => directory !== root && path.dirname(directory) === root).sort();
    },
    realpath,
  };
}

export function loadCompiler(admitted, view) {
  const allowed = new Map([["fs", view.fs], ["path", path], ["os", os], ["crypto", crypto], ["perf_hooks", performanceHooks]]);
  const module = { exports: {} };
  const context = createContext({
    module, exports: module.exports, process, Buffer, console,
    require(name) {
      if (!allowed.has(name)) return view.deny(`require:${typeof name === "string" ? name : "invalid"}`);
      return allowed.get(name);
    },
    __filename: admitted.compilerPath,
    __dirname: path.dirname(admitted.compilerPath),
    setTimeout: () => view.deny("setTimeout"),
    clearTimeout: () => view.deny("clearTimeout"),
    setImmediate: () => view.deny("setImmediate"),
    clearImmediate: () => view.deny("clearImmediate"),
  }, { name: "admitted-unmodified-typescript-api", codeGeneration: { strings: false, wasm: false } });
  const source = admitted.compilerBytes.toString("utf8");
  const wrapper = `(function (exports, require, module, __filename, __dirname) {\n${source}\n})(exports, require, module, __filename, __dirname);`;
  new Script(wrapper, { filename: admitted.compilerPath }).runInContext(context);
  const compiler = module.exports;
  if (compiler.version !== "5.9.3") throw new Error("Compiler version identity");
  if (view.denied.length) throw new Error("Compiler initialization used denied host operation");
  return compiler;
}

export function compilerOptions(compiler, toolsRoot) {
  return {
    strict: true, noEmit: true, target: compiler.ScriptTarget.ES2022,
    module: compiler.ModuleKind.NodeNext, moduleResolution: compiler.ModuleResolutionKind.NodeNext,
    types: ["node"], typeRoots: [`${toolsRoot}/node_modules/@types`],
    skipLibCheck: false, skipDefaultLibCheck: false, noLib: false, allowJs: false, checkJs: false,
  };
}

export function optionData(toolsRoot) {
  return {
    strict: true, noEmit: true, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext",
    types: ["node"], typeRoots: [`${toolsRoot}/node_modules/@types`],
    skipLibCheck: false, skipDefaultLibCheck: false, noLib: false, allowJs: false, checkJs: false,
  };
}

export function createHost(compiler, admitted, view) {
  const libraryRoot = `${admitted.request.toolsRoot}/node_modules/typescript/lib`;
  return {
    getSourceFile(filename, languageVersionOrOptions) {
      const text = view.readText(filename);
      return text === undefined ? undefined : compiler.createSourceFile(filename, text, languageVersionOrOptions, true);
    },
    getDefaultLibFileName(options) { return `${libraryRoot}/${compiler.getDefaultLibFileName(options)}`; },
    getDefaultLibLocation() { return libraryRoot; },
    getCurrentDirectory() { return admitted.request.caseRoot; },
    getCanonicalFileName(filename) { return filename; },
    useCaseSensitiveFileNames() { return true; },
    getNewLine() { return "\n"; },
    readFile: filename => view.readText(filename),
    fileExists: filename => view.fileExists(filename),
    directoryExists: filename => view.directoryExists(filename),
    getDirectories: filename => view.getDirectories(filename),
    realpath: filename => view.realpath(filename),
    getEnvironmentVariable() { return ""; },
    writeFile: () => view.deny("CompilerHost.writeFile with noEmit"),
    readDirectory(root, extensions, excludes, includes, depth) {
      if (excludes?.length || includes?.some(pattern => pattern !== "**/*") || depth !== undefined) return view.deny("Unsealed CompilerHost directory pattern");
      const directory = view.probe("readDirectory", root);
      return [...view.files.keys()].filter(filename => filename.startsWith(`${directory}/`) && (!extensions || extensions.some(extension => filename.endsWith(extension)))).sort();
    },
  };
}

export function serializeDiagnostics(compiler, diagnostics) {
  let nodes = 0;
  const chain = (message, depth = 0) => {
    if (typeof message === "string") return message;
    if (++nodes > 8192 || depth > 24) throw new Error("Diagnostic chain bound");
    return { messageText: message.messageText, code: message.code, category: message.category, next: (message.next ?? []).map(child => chain(child, depth + 1)) };
  };
  const serialize = (diagnostic, depth = 0) => {
    if (++nodes > 8192 || depth > 24) throw new Error("Diagnostic count/depth bound");
    const location = diagnostic.file && diagnostic.start !== undefined ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start) : undefined;
    return {
      file: diagnostic.file?.fileName ?? null, code: diagnostic.code, category: diagnostic.category,
      line: location ? location.line + 1 : null, column: location ? location.character + 1 : null,
      start: diagnostic.start ?? null, length: diagnostic.length ?? null,
      message: compiler.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      messageChain: chain(diagnostic.messageText),
      related: (diagnostic.relatedInformation ?? []).map(related => serialize(related, depth + 1)),
    };
  };
  return diagnostics.map(diagnostic => serialize(diagnostic));
}

export function programIdentities(program, admitted) {
  return program.getSourceFiles().map(source => {
    const bytes = admitted.snapshot.get(source.fileName);
    if (!bytes || bytes.toString("utf8") !== source.text) throw new Error("Program used unadmitted source bytes");
    return { path: source.fileName, bytes: bytes.length, sha256: sha256(bytes) };
  });
}
