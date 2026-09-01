import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Node, Project, ScriptKind, SyntaxKind, ts } from "ts-morph";
import { S, toJsonSchemaDocument } from "toolcraft-schema";
import type {
  CallExpression,
  Expression,
  ObjectLiteralExpression,
  PropertyName,
  SourceFile
} from "ts-morph";
import type { AnySchema, JsonSchemaDocument, JsonSchemaDocumentOptions } from "toolcraft-schema";

interface CompileConfigSchemaOptions {
  entrypoints: readonly string[];
  document?: JsonSchemaDocumentOptions;
}

export interface CompileConfigSchemaFromSourceTextsOptions extends CompileConfigSchemaOptions {
  files: Record<string, string>;
}

type LiteralValue = string | number | boolean | null | { [key: string]: LiteralValue };

type CollectedField =
  | {
      type: "string";
      default: string;
      doc: string;
      env?: string;
    }
  | {
      type: "number";
      default: number;
      doc: string;
      env?: string;
    }
  | {
      type: "boolean";
      default: boolean;
      doc: string;
      env?: string;
    };

interface ScopeFragment {
  scope: string;
  fields: Record<string, CollectedField>;
  sourceFilePath: string;
}

const supportedFieldMetadata = new Set(["type", "default", "doc", "env"]);
const unsafeSchemaNames = new Set(["__proto__"]);

const defaultDocumentOptions: JsonSchemaDocumentOptions = {
  id: "https://poe-code.dev/schemas/poe-code.schema.json",
  title: "poe-code config",
  description: "Schema for poe-code config files"
};

export function compileConfigSchemaFromEntrypoints(
  options: CompileConfigSchemaOptions
): JsonSchemaDocument {
  const normalizedEntrypoints = options.entrypoints.map(normalizeFilePath);
  const project = createProject();

  const sourceFiles = collectReachableSourceFiles({
    entrypoints: normalizedEntrypoints,
    project,
    readSourceText(filePath) {
      if (!existsSync(filePath)) {
        return undefined;
      }

      return readFileSync(filePath, "utf8");
    }
  });

  return compileReachableSourceFiles(sourceFiles, options.document);
}

export function compileConfigSchemaFromSourceTexts(
  options: CompileConfigSchemaFromSourceTextsOptions
): JsonSchemaDocument {
  const files = new Map(
    Object.entries(options.files).map(([filePath, sourceText]) => [
      normalizeFilePath(filePath),
      sourceText
    ])
  );
  const project = createProject();

  const sourceFiles = collectReachableSourceFiles({
    entrypoints: options.entrypoints.map(normalizeFilePath),
    project,
    readSourceText(filePath) {
      return files.get(filePath);
    }
  });

  return compileReachableSourceFiles(sourceFiles, options.document);
}

function compileReachableSourceFiles(
  sourceFiles: ReturnType<typeof collectReachableSourceFiles>,
  documentOptions: JsonSchemaDocumentOptions | undefined
): JsonSchemaDocument {
  const fragments = sourceFiles.flatMap((sourceFile) => extractScopeFragments(sourceFile));
  const mergedScopes = mergeScopeFragments(fragments);
  const rootShape = {
    version: S.Number({ default: 1 })
  } as Record<string, AnySchema>;

  for (const [scopeName, fields] of mergedScopes) {
    const scopeShape: Record<string, AnySchema> = {};

    for (const [fieldName, field] of Object.entries(fields)) {
      scopeShape[fieldName] = fieldToToolcraftSchema(field);
    }

    rootShape[scopeName] = S.Optional(S.Object(scopeShape));
  }

  return toJsonSchemaDocument(S.Object(rootShape), {
    ...defaultDocumentOptions,
    ...documentOptions
  });
}

function createProject(): Project {
  return new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      allowJs: false,
      esModuleInterop: true,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2022
    },
    skipAddingFilesFromTsConfig: true
  });
}

function collectReachableSourceFiles(options: {
  entrypoints: readonly string[];
  project: Project;
  readSourceText: (filePath: string) => string | undefined;
}) {
  const sourceFiles = [];
  const visited = new Set<string>();
  const pending = [...options.entrypoints];

  while (pending.length > 0) {
    const filePath = pending.shift();
    if (filePath === undefined || visited.has(filePath)) {
      continue;
    }

    const sourceText = options.readSourceText(filePath);
    if (sourceText === undefined) {
      throw new Error(`Unable to read schema compilation entrypoint or import: ${filePath}`);
    }

    visited.add(filePath);
    const sourceFile = options.project.createSourceFile(filePath, sourceText, {
      overwrite: true,
      scriptKind: ScriptKind.TS
    });
    sourceFiles.push(sourceFile);

    for (const specifier of getStaticModuleSpecifiers(sourceFile)) {
      const resolved = resolveRelativeModuleSpecifier(filePath, specifier, options.readSourceText);
      if (resolved !== undefined && !visited.has(resolved)) {
        pending.push(resolved);
      }
    }
  }

  return sourceFiles;
}

function getStaticModuleSpecifiers(sourceFile: SourceFile): string[] {
  const specifiers: string[] = [];

  for (const declaration of sourceFile.getImportDeclarations()) {
    if (!declaration.isTypeOnly()) {
      specifiers.push(declaration.getModuleSpecifierValue());
    }
  }

  for (const declaration of sourceFile.getExportDeclarations()) {
    if (declaration.isTypeOnly()) {
      continue;
    }

    const specifier = declaration.getModuleSpecifierValue();
    if (specifier !== undefined) {
      specifiers.push(specifier);
    }
  }

  return specifiers;
}

function resolveRelativeModuleSpecifier(
  importerPath: string,
  specifier: string,
  readSourceText: (filePath: string) => string | undefined
): string | undefined {
  if (!specifier.startsWith(".")) {
    return undefined;
  }

  const importerDir = path.posix.dirname(importerPath);
  const candidateBase = normalizeFilePath(path.posix.resolve(importerDir, specifier));
  const candidates = createModuleCandidates(candidateBase);

  return candidates.find((candidate) => readSourceText(candidate) !== undefined);
}

function createModuleCandidates(candidateBase: string): string[] {
  const extension = path.posix.extname(candidateBase);

  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") {
    const withoutExtension = candidateBase.slice(0, -extension.length);
    return [
      `${withoutExtension}.ts`,
      `${withoutExtension}.tsx`,
      `${withoutExtension}.mts`,
      `${withoutExtension}.cts`,
      candidateBase
    ];
  }

  if (extension !== "") {
    return [candidateBase];
  }

  return [
    `${candidateBase}.ts`,
    `${candidateBase}.tsx`,
    `${candidateBase}/index.ts`,
    `${candidateBase}/index.tsx`
  ];
}

function extractScopeFragments(sourceFile: SourceFile): ScopeFragment[] {
  const defineScopeNames = getDefineScopeImportNames(sourceFile);
  if (defineScopeNames.size === 0) {
    return [];
  }

  const exportedDeclarations = sourceFile.getExportedDeclarations();
  const fragments: ScopeFragment[] = [];

  for (const statement of sourceFile.getVariableStatements()) {
    for (const declaration of statement.getDeclarations()) {
      const name = declaration.getName();
      if (!exportedDeclarations.has(name)) {
        continue;
      }

      const initializer = declaration.getInitializer();
      if (!Node.isCallExpression(initializer)) {
        continue;
      }

      const expression = initializer.getExpression();
      if (!Node.isIdentifier(expression) || !defineScopeNames.has(expression.getText())) {
        continue;
      }

      fragments.push(extractScopeFragment(sourceFile.getFilePath(), initializer));
    }
  }

  return fragments;
}

function getDefineScopeImportNames(sourceFile: SourceFile): Set<string> {
  const names = new Set<string>();

  for (const declaration of sourceFile.getImportDeclarations()) {
    const moduleName = declaration.getModuleSpecifierValue();
    if (moduleName !== "@poe-code/poe-code-config" && moduleName !== "@poe-code/poe-code-config/core") {
      continue;
    }

    for (const namedImport of declaration.getNamedImports()) {
      if (namedImport.getName() !== "defineScope") {
        continue;
      }

      names.add(namedImport.getAliasNode()?.getText() ?? namedImport.getName());
    }
  }

  return names;
}

function extractScopeFragment(
  sourceFilePath: string,
  callExpression: CallExpression
): ScopeFragment {
  const [scopeArg, schemaArg] = callExpression.getArguments();

  if (!Node.isStringLiteral(scopeArg)) {
    throw new Error(`${sourceFilePath}: defineScope scope name must be a string literal`);
  }

  if (!Node.isObjectLiteralExpression(schemaArg)) {
    throw new Error(`${sourceFilePath}: defineScope schema must be an object literal`);
  }

  const scopeName = scopeArg.getLiteralText();
  assertSafeSchemaName(scopeName, sourceFilePath);

  return {
    scope: scopeName,
    fields: extractScopeFields(sourceFilePath, scopeName, schemaArg),
    sourceFilePath
  };
}

function extractScopeFields(
  sourceFilePath: string,
  scopeName: string,
  schemaObject: ObjectLiteralExpression
): Record<string, CollectedField> {
  const fields: Record<string, CollectedField> = {};
  const seenFieldNames = new Set<string>();

  for (const property of schemaObject.getProperties()) {
    if (!Node.isPropertyAssignment(property)) {
      throw new Error(`${sourceFilePath}: scope schema fields must be property assignments`);
    }

    const fieldName = getPropertyName(property.getNameNode(), sourceFilePath);
    if (seenFieldNames.has(fieldName)) {
      throw new Error(`Duplicate config field "${scopeName}.${fieldName}" in ${sourceFilePath}`);
    }
    seenFieldNames.add(fieldName);

    const initializer = property.getInitializer();
    if (!Node.isObjectLiteralExpression(initializer)) {
      throw new Error(`${sourceFilePath}: config field "${fieldName}" must be an object literal`);
    }

    fields[fieldName] = extractConfigField(sourceFilePath, fieldName, initializer);
  }

  return fields;
}

function extractConfigField(
  sourceFilePath: string,
  fieldName: string,
  fieldObject: ObjectLiteralExpression
): CollectedField {
  const metadata = extractFieldMetadataExpressions(sourceFilePath, fieldObject);
  const typeExpression = metadata.get("type");
  if (typeExpression === undefined) {
    throw new Error(`${sourceFilePath}: config field "${fieldName}" type must be a string literal`);
  }

  const type = extractLiteralValue(sourceFilePath, typeExpression);
  if (type === "json") {
    throw new Error(
      `${sourceFilePath}: config field "${fieldName}" uses json, which schema compilation does not support yet`
    );
  }

  validateFieldMetadataKeys(sourceFilePath, fieldName, metadata);

  if (type !== "string" && type !== "number" && type !== "boolean") {
    throw new Error(
      `${sourceFilePath}: config field "${fieldName}" must use a primitive type supported by schema compilation`
    );
  }

  const defaultValue = extractOptionalLiteralValue(sourceFilePath, metadata.get("default"));
  const doc = extractOptionalLiteralValue(sourceFilePath, metadata.get("doc"));
  const env = extractOptionalLiteralValue(sourceFilePath, metadata.get("env"));

  if (typeof defaultValue !== type) {
    throw new Error(`${sourceFilePath}: config field "${fieldName}" default must match its type`);
  }

  if (typeof doc !== "string") {
    throw new Error(`${sourceFilePath}: config field "${fieldName}" doc must be a string literal`);
  }

  if (env !== undefined && typeof env !== "string") {
    throw new Error(`${sourceFilePath}: config field "${fieldName}" env must be a string literal`);
  }

  if (type === "string" && typeof defaultValue === "string") {
    return {
      type,
      default: defaultValue,
      doc,
      ...(env === undefined ? {} : { env })
    };
  }

  if (type === "number" && typeof defaultValue === "number") {
    return {
      type,
      default: defaultValue,
      doc,
      ...(env === undefined ? {} : { env })
    };
  }

  if (type === "boolean" && typeof defaultValue === "boolean") {
    return {
      type,
      default: defaultValue,
      doc,
      ...(env === undefined ? {} : { env })
    };
  }

  throw new Error(`${sourceFilePath}: config field "${fieldName}" default must match its type`);
}

function extractFieldMetadataExpressions(
  sourceFilePath: string,
  fieldObject: ObjectLiteralExpression
): Map<string, Expression> {
  const metadata = new Map<string, Expression>();

  for (const property of fieldObject.getProperties()) {
    if (!Node.isPropertyAssignment(property)) {
      throw new Error(`${sourceFilePath}: object literals in config schemas must be static`);
    }

    const metadataName = getPropertyName(property.getNameNode(), sourceFilePath);
    if (metadata.has(metadataName)) {
      throw new Error(`${sourceFilePath}: duplicate object literal key "${metadataName}"`);
    }

    metadata.set(metadataName, property.getInitializerOrThrow());
  }

  return metadata;
}

function extractObjectLiteral(
  sourceFilePath: string,
  objectLiteral: ObjectLiteralExpression
): Record<string, LiteralValue> {
  const value: Record<string, LiteralValue> = {};
  const seenNames = new Set<string>();

  for (const property of objectLiteral.getProperties()) {
    if (!Node.isPropertyAssignment(property)) {
      throw new Error(`${sourceFilePath}: object literals in config schemas must be static`);
    }

    const propertyName = getPropertyName(property.getNameNode(), sourceFilePath);
    if (seenNames.has(propertyName)) {
      throw new Error(`${sourceFilePath}: duplicate object literal key "${propertyName}"`);
    }
    seenNames.add(propertyName);

    value[propertyName] = extractLiteralValue(sourceFilePath, property.getInitializerOrThrow());
  }

  return value;
}

function validateFieldMetadataKeys(
  sourceFilePath: string,
  fieldName: string,
  metadata: ReadonlyMap<string, Expression>
): void {
  for (const metadataName of metadata.keys()) {
    if (!supportedFieldMetadata.has(metadataName)) {
      throw new Error(
        `${sourceFilePath}: Unsupported metadata "${metadataName}" on config field "${fieldName}"`
      );
    }
  }
}

function extractOptionalLiteralValue(
  sourceFilePath: string,
  expression: Expression | undefined
): LiteralValue | undefined {
  if (expression === undefined) {
    return undefined;
  }

  return extractLiteralValue(sourceFilePath, expression);
}

function extractLiteralValue(sourceFilePath: string, expression: Expression): LiteralValue {
  if (Node.isStringLiteral(expression) || Node.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.getLiteralText();
  }

  if (Node.isNumericLiteral(expression)) {
    return Number(expression.getLiteralText());
  }

  if (expression.getKind() === SyntaxKind.TrueKeyword) {
    return true;
  }

  if (expression.getKind() === SyntaxKind.FalseKeyword) {
    return false;
  }

  if (expression.getKind() === SyntaxKind.NullKeyword) {
    return null;
  }

  if (Node.isObjectLiteralExpression(expression)) {
    return extractObjectLiteral(sourceFilePath, expression);
  }

  if (Node.isArrayLiteralExpression(expression)) {
    throw new Error(`${sourceFilePath}: array literals are not supported in v1 config schemas`);
  }

  throw new Error(`${sourceFilePath}: config schemas must contain only static literal values`);
}

function getPropertyName(nameNode: PropertyName, sourceFilePath: string): string {
  if (Node.isIdentifier(nameNode) || Node.isStringLiteral(nameNode)) {
    const propertyName = Node.isIdentifier(nameNode)
      ? nameNode.getText()
      : nameNode.getLiteralText();
    assertSafeSchemaName(propertyName, sourceFilePath);
    return propertyName;
  }

  throw new Error(`${sourceFilePath}: config schema property names must be static`);
}

function assertSafeSchemaName(name: string, sourceFilePath: string): void {
  if (unsafeSchemaNames.has(name)) {
    throw new Error(`${sourceFilePath}: Unsafe config schema name "${name}"`);
  }
}

function mergeScopeFragments(
  fragments: readonly ScopeFragment[]
): Map<string, Record<string, CollectedField>> {
  const merged = new Map<string, Record<string, CollectedField>>();
  const fieldOrigins = new Map<string, string>();

  for (const fragment of fragments) {
    const scope = merged.get(fragment.scope) ?? {};

    for (const [fieldName, field] of Object.entries(fragment.fields)) {
      const fieldKey = `${fragment.scope}.${fieldName}`;
      const previousOrigin = fieldOrigins.get(fieldKey);
      if (previousOrigin !== undefined) {
        throw new Error(
          `Duplicate config field "${fieldKey}" in ${fragment.sourceFilePath}; first defined in ${previousOrigin}`
        );
      }

      scope[fieldName] = field;
      fieldOrigins.set(fieldKey, fragment.sourceFilePath);
    }

    merged.set(fragment.scope, scope);
  }

  return merged;
}

function fieldToToolcraftSchema(field: CollectedField): AnySchema {
  switch (field.type) {
    case "string":
      return S.String({ default: field.default, description: field.doc });
    case "number":
      return S.Number({ default: field.default, description: field.doc });
    case "boolean":
      return S.Boolean({ default: field.default, description: field.doc });
  }
}

function normalizeFilePath(filePath: string): string {
  return path.posix.normalize(filePath.replaceAll(path.win32.sep, path.posix.sep));
}
