import { createHash } from "node:crypto";
import { constants } from "node:fs";
import path from "node:path";
import type ts from "typescript";
import { canonicalFsProfiles } from "./bundle-policy.js";
import type { LintFs, LintStat } from "./model.js";
import { publicationNodeBuiltins } from "./node-builtins.js";

export interface NativeAssetFact {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

export interface NativeClosure {
  readonly specifier: string;
  readonly directory: string;
  readonly assets: readonly NativeAssetFact[];
  readonly imports: {
    readonly types: string;
    readonly workerd: null;
    readonly browser: null;
    readonly default: string;
  };
}

export type NativeAssetFiles = Pick<
  LintFs,
  "readFile" | "readBytes" | "readdir" | "lstat" | "realpath"
>;

export interface NativeByteHandle {
  stat(): Promise<{ size: number | bigint; isFile(): boolean }>;
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number
  ): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

const collected = new WeakSet<NativeClosure>();
const metadataLimit = 16384;
const sourceLimit = 65536;
const binaryLimit = 1048576;

function invalid(message: string): never {
  throw new Error(`Invalid canonical native assets: ${message}`);
}

function object(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("expected object");
  const result = value as Record<string, unknown>;
  if (
    keys &&
    (Object.keys(result).length !== keys.length || keys.some((key) => !Object.hasOwn(result, key)))
  )
    invalid("unknown or missing schema field");
  return result;
}

function integer(value: unknown, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > maximum)
    invalid("invalid bounded size");
  return value;
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== "string" || !value.length || value.length > maximum || value.includes("\0"))
    invalid("invalid string");
  return value;
}

function relative(value: unknown): string {
  const filename = text(value, 256);
  if (
    filename
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          ![...part].every((character) =>
            "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.".includes(character)
          )
      )
  )
    invalid("unsafe relative path");
  return filename;
}

function hash(value: unknown): string {
  const digest = text(value, 64);
  if (
    digest.length !== 64 ||
    ![...digest].every((character) => "0123456789abcdef".includes(character))
  )
    invalid("invalid sha256");
  return digest;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function target(value: unknown, binary: boolean): string {
  const record = object(value, [
    "platform",
    "arch",
    "libc",
    "minimumLibc",
    ...(binary ? ["size", "sha256"] : [])
  ]);
  for (const key of ["platform", "arch", "libc"]) {
    const identifier = text(record[key], 32);
    if (
      ![...identifier].every((character) =>
        "abcdefghijklmnopqrstuvwxyz0123456789_".includes(character)
      )
    )
      invalid("invalid target identifier");
  }
  const version = text(record.minimumLibc, 16).split(".");
  if (
    version.length !== 2 ||
    version.some(
      (part) => !part.length || ![...part].every((character) => "0123456789".includes(character))
    )
  )
    invalid("invalid libc version");
  if (binary) {
    integer(record.size, binaryLimit);
    hash(record.sha256);
  }
  return `${record.platform}-${record.arch}-${record.libc}.node`;
}

async function validateImports(
  source: string,
  declaration: string,
  binaryNames: ReadonlySet<string>
): Promise<void> {
  const compiler = await import("typescript");
  for (const [filename, contents] of [
    ["loader.mjs", source],
    ["loader.d.ts", declaration]
  ]) {
    const tree = compiler.createSourceFile(
      filename!,
      contents!,
      compiler.ScriptTarget.Latest,
      true
    );
    if (
      (tree as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics
        .length
    )
      invalid("invalid loader syntax");
    const createRequires = new Set<string>();
    const requireBindings = new Set<string>();
    const declarations = new Map<string, ts.Expression>();
    for (const statement of tree.statements) {
      if (
        compiler.isImportDeclaration(statement) &&
        compiler.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === "node:module"
      ) {
        const bindings = statement.importClause?.namedBindings;
        if (bindings && compiler.isNamedImports(bindings))
          for (const binding of bindings.elements) {
            if ((binding.propertyName ?? binding.name).text === "createRequire")
              createRequires.add(binding.name.text);
          }
      }
    }
    const isCreateRequire = (node: ts.Expression): boolean =>
      compiler.isCallExpression(node) &&
      compiler.isIdentifier(node.expression) &&
      createRequires.has(node.expression.text) &&
      node.arguments.length === 1 &&
      node.arguments[0]!.getText(tree) === "import.meta.url";
    const collect = (node: ts.Node): void => {
      if (
        compiler.isVariableDeclaration(node) &&
        compiler.isIdentifier(node.name) &&
        node.initializer
      ) {
        declarations.set(node.name.text, node.initializer);
        if (isCreateRequire(node.initializer)) requireBindings.add(node.name.text);
      }
      compiler.forEachChild(node, collect);
    };
    collect(tree);
    const addonArgument = (node: ts.Expression): boolean => {
      if (compiler.isStringLiteralLike(node))
        return binaryNames.has(node.text.startsWith("./") ? node.text.slice(2) : node.text);
      if (!compiler.isIdentifier(node)) return false;
      const initializer = declarations.get(node.text);
      if (
        !initializer ||
        !compiler.isCallExpression(initializer) ||
        !compiler.isIdentifier(initializer.expression) ||
        initializer.expression.text !== "fileURLToPath" ||
        initializer.arguments.length !== 1
      )
        return false;
      const url = initializer.arguments[0]!;
      if (
        !compiler.isNewExpression(url) ||
        !compiler.isIdentifier(url.expression) ||
        url.expression.text !== "URL" ||
        url.arguments?.length !== 2 ||
        url.arguments[1]!.getText(tree) !== "import.meta.url"
      )
        return false;
      const template = url.arguments[0]!;
      return (
        compiler.isTemplateExpression(template) &&
        template.head.text === "" &&
        template.templateSpans.length === 3 &&
        template.templateSpans.every(
          (span, index) =>
            compiler.isPropertyAccessExpression(span.expression) &&
            span.expression.name.text === ["platform", "arch", "libc"][index] &&
            compiler.isIdentifier(span.expression.expression) &&
            span.expression.expression.text === "target" &&
            span.literal.text === (index === 2 ? ".node" : "-")
        )
      );
    };
    const builtin = (node: ts.Node | undefined): void => {
      if (!node || !compiler.isStringLiteralLike(node) || !publicationNodeBuiltins.has(node.text))
        invalid("loader has non-builtin import");
    };
    const visit = (node: ts.Node): void => {
      if (compiler.isIdentifier(node) && createRequires.has(node.text)) {
        const parent = node.parent;
        if (
          !compiler.isImportSpecifier(parent) &&
          !(
            compiler.isCallExpression(parent) &&
            parent.expression === node &&
            isCreateRequire(parent)
          )
        )
          invalid("escaped or relocated createRequire");
      }
      if (
        compiler.isPropertyAccessExpression(node) &&
        ["require", "createRequire"].includes(node.name.text)
      )
        invalid("unsupported indirect loader require");
      if (compiler.isIdentifier(node) && requireBindings.has(node.text)) {
        const parent = node.parent;
        if (
          !(compiler.isVariableDeclaration(parent) && parent.name === node) &&
          !(compiler.isCallExpression(parent) && parent.expression === node)
        )
          invalid("escaped loader require");
      }
      if (compiler.isImportDeclaration(node) || compiler.isExportDeclaration(node)) {
        if (node.moduleSpecifier) builtin(node.moduleSpecifier);
      }
      if (compiler.isImportTypeNode(node)) {
        if (!compiler.isLiteralTypeNode(node.argument)) invalid("nonliteral declaration import");
        builtin(node.argument.literal);
      }
      if (compiler.isImportEqualsDeclaration(node)) {
        if (!compiler.isExternalModuleReference(node.moduleReference))
          invalid("unsupported declaration import");
        builtin(node.moduleReference.expression);
      }
      if (compiler.isCallExpression(node)) {
        if (node.expression.kind === compiler.SyntaxKind.ImportKeyword) builtin(node.arguments[0]);
        else if (
          isCreateRequire(node.expression) ||
          (compiler.isIdentifier(node.expression) && requireBindings.has(node.expression.text))
        ) {
          if (node.arguments.length !== 1 || !addonArgument(node.arguments[0]!))
            invalid("non-registry addon require");
        } else if (compiler.isIdentifier(node.expression) && node.expression.text === "require")
          builtin(node.arguments[0]);
      }
      compiler.forEachChild(node, visit);
    };
    visit(tree);
    if (
      tree.referencedFiles.length ||
      tree.typeReferenceDirectives.length ||
      tree.libReferenceDirectives.length
    )
      invalid("loader declaration reference");
  }
}

export async function collectCanonicalNativeAssets(
  rootDir: string,
  files: NativeAssetFiles
): Promise<{ canonicalNativeAssets: NativeClosure | undefined }> {
  const registryPath = "packages/safe-fs/native/assets.json";
  if (!files.lstat || !files.realpath) {
    invalid("lstat and realpath metadata required");
  }
  const root = path.resolve(rootDir);
  const rootStat = await files.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) invalid("invalid workspace boundary");
  const realRoot = await files.realpath(root);
  const observations = new Map<string, LintStat>();
  const inspect = async (filename: string, directory: boolean): Promise<LintStat> => {
    const parts = relative(filename).split("/");
    let current = root;
    let final: LintStat | undefined;
    for (let index = 0; index < parts.length; index++) {
      current = path.join(current, parts[index]!);
      const stat = await files.lstat!(current);
      if (
        ![stat.dev, stat.ino].every((value) =>
          typeof value === "bigint"
            ? value >= 0n
            : typeof value === "number" && Number.isSafeInteger(value) && value >= 0
        )
      )
        invalid(`missing device/inode metadata: ${filename}`);
      if (
        stat.isSymbolicLink() ||
        (directory || index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())
      )
        invalid(`non-regular path: ${filename}`);
      if ((await files.realpath!(current)) !== path.join(realRoot, ...parts.slice(0, index + 1)))
        invalid(`path escaped root: ${filename}`);
      const old = observations.get(current);
      if (old && (old.dev !== stat.dev || old.ino !== stat.ino || old.size !== stat.size))
        invalid(`path changed: ${filename}`);
      observations.set(current, stat);
      final = stat;
    }
    return final!;
  };
  try {
    await inspect(registryPath, false);
  } catch (error) {
    if ((error as { code?: unknown })?.code === "ENOENT")
      return { canonicalNativeAssets: undefined };
    throw error;
  }
  if (!files.readBytes) invalid("bounded readBytes capability required");
  const read = async (filename: string, maximum: number): Promise<Uint8Array> => {
    const stat = await inspect(filename, false);
    const size = integer(typeof stat.size === "bigint" ? Number(stat.size) : stat.size, maximum);
    const bytes = await files.readBytes!(path.join(root, filename), maximum);
    if (!(bytes instanceof Uint8Array) || bytes.length !== size)
      invalid(`incomplete bounded read: ${filename}`);
    await inspect(filename, false);
    return bytes;
  };
  const decode = (bytes: Uint8Array): string =>
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const registry = object(JSON.parse(decode(await read(registryPath, metadataLimit))), [
    "version",
    "specifier",
    "directory",
    "source",
    "loader",
    "declaration",
    "napi",
    "maxBinaryBytes",
    "targets"
  ]);
  if (
    registry.version !== 1 ||
    registry.napi !== 6 ||
    registry.maxBinaryBytes !== binaryLimit ||
    registry.specifier !== "#safe-fs-native-seek"
  )
    invalid("unsupported registry");
  const directory = `${canonicalFsProfiles.node.outdir}/${relative(registry.directory)}`;
  if (!directory.startsWith(`${canonicalFsProfiles.node.outdir}/native/`))
    invalid("invalid native directory");
  const sources = [registry.source, registry.loader, registry.declaration].map(
    (filename) => `packages/safe-fs/${relative(filename)}`
  );
  if (!Array.isArray(registry.targets) || !registry.targets.length || registry.targets.length > 16)
    invalid("invalid registry targets");
  const registryTargets = new Map<string, Record<string, unknown>>();
  for (const entry of registry.targets) {
    const name = target(entry, false);
    if (registryTargets.has(name)) invalid("duplicate registry target");
    registryTargets.set(name, object(entry));
  }
  await inspect(directory, true);
  const manifestBytes = await read(`${directory}/manifest.json`, metadataLimit);
  const manifest = object(JSON.parse(decode(manifestBytes)), [
    "version",
    "napi",
    "maxBinaryBytes",
    "targets",
    "build"
  ]);
  if (
    manifest.version !== registry.version ||
    manifest.napi !== registry.napi ||
    manifest.maxBinaryBytes !== registry.maxBinaryBytes ||
    !Array.isArray(manifest.targets) ||
    (manifest.targets.length !== 0 && manifest.targets.length !== registryTargets.size)
  )
    invalid("manifest does not match registry");
  const binaries = new Map<string, Record<string, unknown>>();
  for (const entry of manifest.targets) {
    const name = target(entry, true);
    const expected = registryTargets.get(name);
    const actual = object(entry);
    if (
      !expected ||
      binaries.has(name) ||
      Object.keys(expected).some((key) => actual[key] !== expected[key])
    )
      invalid("foreign or duplicate manifest target");
    binaries.set(name, actual);
  }
  const build = object(manifest.build, [
    "sourceSha256",
    "loaderSha256",
    "declarationSha256",
    "headers",
    "compiler"
  ]);
  if (binaries.size === 0) {
    if (build.headers !== null || build.compiler !== null)
      invalid("empty targets require null toolchain provenance");
  } else {
    const headers = object(build.headers, ["version", "files"]);
    if (headers.version !== "1.9.0") invalid("unsupported header provenance");
    const headerFiles = object(headers.files);
    if (!Object.keys(headerFiles).length || Object.keys(headerFiles).length > 32)
      invalid("invalid header inventory");
    for (const [name, entry] of Object.entries(headerFiles)) {
      if (relative(name).includes("/") || !name.endsWith(".h")) invalid("invalid header basename");
      const header = object(entry, ["size", "sha256"]);
      integer(header.size, binaryLimit);
      hash(header.sha256);
    }
    const compiler = object(build.compiler, ["path", "sha256", "version"]);
    if (compiler.path !== "/usr/bin/cc") invalid("invalid compiler path");
    hash(compiler.sha256);
    text(compiler.version, 8192);
  }
  const expectedNames = ["loader.mjs", "loader.d.ts", "manifest.json", ...binaries.keys()];
  const entries = await files.readdir(path.join(root, directory));
  if (
    entries.length !== expectedNames.length ||
    new Set(entries.map((entry) => entry.name)).size !== entries.length ||
    entries.some((entry) => entry.isDirectory() || !expectedNames.includes(entry.name))
  )
    invalid("asset membership mismatch");
  const sourceBytes = await Promise.all(sources.map((filename) => read(filename, sourceLimit)));
  for (const [index, key] of ["sourceSha256", "loaderSha256", "declarationSha256"].entries()) {
    if (sha256(sourceBytes[index]!) !== hash(build[key])) invalid(`stale ${key}`);
  }
  const assets: NativeAssetFact[] = [];
  for (const name of expectedNames) {
    const filename = `${directory}/${name}`;
    const bytes =
      name === "manifest.json"
        ? manifestBytes
        : await read(filename, binaries.has(name) ? binaryLimit : sourceLimit);
    const digest = sha256(bytes);
    const expected = binaries.get(name);
    if (expected && (expected.size !== bytes.length || expected.sha256 !== digest))
      invalid(`binary size/hash mismatch: ${name}`);
    const original =
      name === "loader.mjs" ? sourceBytes[1] : name === "loader.d.ts" ? sourceBytes[2] : undefined;
    if (
      original &&
      (original.length !== bytes.length || original.some((byte, index) => byte !== bytes[index]))
    )
      invalid(`stale projected copy: ${name}`);
    assets.push(Object.freeze({ path: filename, size: bytes.length, sha256: digest }));
  }
  await validateImports(
    decode(sourceBytes[1]!),
    decode(sourceBytes[2]!),
    new Set(registryTargets.keys())
  );
  for (const [filename, stat] of observations)
    await inspect(path.relative(root, filename).split(path.sep).join("/"), stat.isDirectory());
  const closure: NativeClosure = Object.freeze({
    specifier: registry.specifier,
    directory,
    assets: Object.freeze(assets),
    imports: Object.freeze({
      types: `./${directory}/loader.d.ts`,
      workerd: null,
      browser: null,
      default: `./${directory}/loader.mjs`
    })
  });
  collected.add(closure);
  return { canonicalNativeAssets: closure };
}

export function isCanonicalNativeClosure(
  value: NativeClosure | undefined,
  imports: unknown,
  packedFiles: ReadonlySet<string>
): value is NativeClosure {
  if (!value || !collected.has(value)) return false;
  const actual =
    imports && typeof imports === "object" && !Array.isArray(imports)
      ? (imports as Record<string, unknown>)
      : {};
  const mapping = actual[value.specifier];
  if (JSON.stringify(mapping) !== JSON.stringify(value.imports)) return false;
  const expected = new Set(value.assets.map((asset) => asset.path));
  return (
    [...expected].every((filename) => packedFiles.has(filename)) &&
    ![...packedFiles].some(
      (filename) => filename.startsWith(`${value.directory}/`) && !expected.has(filename)
    )
  );
}

export async function readBoundedNativeBytes(
  openFile: (filename: string, flags: number) => Promise<NativeByteHandle>,
  filename: string,
  maxBytes: number
): Promise<Uint8Array> {
  integer(maxBytes, binaryLimit);
  const handle = await openFile(
    filename,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
  let result: { bytes: Uint8Array } | { error: unknown };
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) invalid("raw asset must be a regular file");
    const size = integer(typeof stat.size === "bigint" ? Number(stat.size) : stat.size, maxBytes);
    const bytes = new Uint8Array(size);
    let offset = 0;
    while (offset < bytes.length) {
      const remaining = bytes.length - offset;
      const { bytesRead } = await handle.read(bytes, offset, remaining, offset);
      offset += integer(bytesRead, remaining);
    }
    const { bytesRead } = await handle.read(new Uint8Array(1), 0, 1, offset);
    if (bytesRead !== 0) invalid("asset grew during raw read");
    const final = await handle.stat();
    if (!final.isFile() || final.size !== stat.size)
      invalid("asset metadata changed during raw read");
    result = { bytes };
  } catch (error) {
    result = { error };
  }
  try {
    await handle.close();
  } catch (error) {
    if (!("error" in result)) result = { error };
  }
  if ("error" in result) throw result.error;
  return result.bytes;
}
