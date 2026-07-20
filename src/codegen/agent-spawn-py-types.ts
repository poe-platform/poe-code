import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  Node,
  Project,
  SyntaxKind,
  type LiteralTypeNode,
  type InterfaceDeclaration,
  type PropertySignature,
  type SourceFile,
  type TypeAliasDeclaration,
  type TypeLiteralNode,
  type TypeNode
} from "ts-morph";
import { hasOwnErrorCode } from "../utils/error-codes.js";

interface SpawnConfigLike {
  agentId: string;
  kind: string;
  aliases?: readonly string[];
}

interface GenerateAgentSpawnPythonTypesOptions {
  acpTypesSourceFile: SourceFile;
  spawnTypesSourceFile: SourceFile;
  spawnConfigs: readonly SpawnConfigLike[];
}

interface RunAgentSpawnPythonTypeCodegenOptions {
  check?: boolean;
  repoRoot?: string;
  project?: Project;
  spawnConfigs?: readonly SpawnConfigLike[];
  fileSystem?: Pick<
    typeof fs,
    "mkdir" | "readFile" | "realpath" | "rename" | "unlink" | "writeFile"
  >;
}

interface PythonField {
  name: string;
  type: string;
  optional: boolean;
}

interface PythonClass {
  name: string;
  eventValue: string;
  fields: PythonField[];
}

const GENERATED_TYPES_OUTPUT_PATH = [
  "packages",
  "py-poe-spawn",
  "src",
  "poe_spawn",
  "types.py"
];

export function generateAgentSpawnPythonTypes(
  options: GenerateAgentSpawnPythonTypesOptions
): string {
  const usageEventInterface = options.acpTypesSourceFile.getInterface("UsageEvent");
  const usagePayloadSignature = usageEventInterface
    ? buildUsagePayloadSignature(usageEventInterface)
    : undefined;
  const events = resolveKnownEventNames(options.acpTypesSourceFile).map((name) => {
    const declaration = options.acpTypesSourceFile.getInterfaceOrThrow(name);
    return buildPythonClass(declaration, usagePayloadSignature);
  });
  const agentIds = resolveSpawnableAgentIds(options.spawnConfigs);
  const spawnModes = resolveStringLiteralUnion(options.spawnTypesSourceFile, "SpawnMode");
  const acpEventNames = events
    .filter((event) => event.eventValue !== "spawn_result")
    .map((event) => event.name);

  return [
    "from dataclasses import dataclass",
    "from enum import Enum",
    "from typing import Literal, Optional, Union",
    "",
    "",
    renderEnum("Agent", agentIds),
    "",
    "",
    renderEnum("SpawnMode", spawnModes),
    "",
    "",
    events.map(renderDataclass).join("\n\n\n"),
    "",
    "",
    renderAcpEventUnion(acpEventNames)
  ].join("\n");
}

export async function runAgentSpawnPythonTypeCodegen(
  options: RunAgentSpawnPythonTypeCodegenOptions = {}
): Promise<void> {
  const repoRoot = options.repoRoot ?? resolveRepoRoot();
  const project =
    options.project ??
    new Project({
      skipAddingFilesFromTsConfig: true
    });
  const acpTypesSourceFile = project.addSourceFileAtPath(
    path.join(repoRoot, "packages", "agent-spawn", "src", "acp", "types.ts")
  );
  const spawnTypesSourceFile = project.addSourceFileAtPath(
    path.join(repoRoot, "packages", "agent-spawn", "src", "types.ts")
  );
  const spawnConfigs = options.spawnConfigs ?? (await loadSpawnConfigs(repoRoot));
  const generated = `${generateAgentSpawnPythonTypes({
    acpTypesSourceFile,
    spawnTypesSourceFile,
    spawnConfigs
  })}\n`;
  const outputPath = path.join(repoRoot, ...GENERATED_TYPES_OUTPUT_PATH);
  const fileSystem = options.fileSystem ?? fs;

  if (!options.check) {
    await fileSystem.mkdir(path.dirname(outputPath), { recursive: true });
  }

  await assertOutputInsideRepo(outputPath, repoRoot, fileSystem);
  const existing = await readFileIfExists(outputPath, fileSystem);

  if (options.check) {
    if (existing !== generated) {
      throw new Error(
        `Generated Python types are out of date. Run \`npm run codegen:python-types\`.`
      );
    }
    return;
  }

  await atomicWriteOutput(outputPath, repoRoot, generated, fileSystem);
}

async function assertOutputInsideRepo(
  outputPath: string,
  repoRoot: string,
  fileSystem: Pick<typeof fs, "realpath">
): Promise<void> {
  const [canonicalRepoRoot, canonicalOutputPath] = await Promise.all([
    fileSystem.realpath(repoRoot),
    realpathNearestExisting(outputPath, fileSystem)
  ]);
  const relativeOutputPath = path.relative(canonicalRepoRoot, canonicalOutputPath);
  if (
    relativeOutputPath === ".." ||
    relativeOutputPath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeOutputPath)
  ) {
    throw new Error("Generated Python types output resolves outside the repository.");
  }
}

async function realpathNearestExisting(
  targetPath: string,
  fileSystem: Pick<typeof fs, "realpath">
): Promise<string> {
  let currentPath = targetPath;

  while (true) {
    try {
      return await fileSystem.realpath(currentPath);
    } catch (error) {
      if (!hasOwnErrorCode(error, "ENOENT")) {
        throw error;
      }

      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        throw error;
      }
      currentPath = parentPath;
    }
  }
}

async function atomicWriteOutput(
  outputPath: string,
  repoRoot: string,
  content: string,
  fileSystem: Pick<typeof fs, "realpath" | "rename" | "unlink" | "writeFile">
): Promise<void> {
  const tempPath = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath)}.${randomUUID()}.tmp`
  );
  let tempCreated = false;

  try {
    await assertOutputInsideRepo(tempPath, repoRoot, fileSystem);
    await fileSystem.writeFile(tempPath, content, { encoding: "utf8", flag: "wx" });
    tempCreated = true;
    await assertOutputInsideRepo(outputPath, repoRoot, fileSystem);
    await fileSystem.rename(tempPath, outputPath);
    tempCreated = false;
  } catch (error) {
    if (tempCreated || !isAlreadyExists(error)) {
      await fileSystem.unlink(tempPath).catch(() => undefined);
    }

    throw error;
  }
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return hasOwnErrorCode(error, "EEXIST");
}

function resolveRepoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

async function readFileIfExists(
  filePath: string,
  fileSystem: Pick<typeof fs, "readFile">
): Promise<string | undefined> {
  try {
    return await fileSystem.readFile(filePath, "utf8");
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  }
}

async function loadSpawnConfigs(repoRoot: string): Promise<readonly SpawnConfigLike[]> {
  const configsModuleUrl = pathToFileURL(
    path.join(repoRoot, "packages", "agent-spawn", "src", "configs", "index.ts")
  ).href;
  const customSpawnModuleUrl = pathToFileURL(
    path.join(repoRoot, "src", "cli", "commands", "spawn-poe-agent.ts")
  ).href;
  const [configsModule, customSpawnModule] = await Promise.all([
    import(configsModuleUrl) as Promise<{
      listSpawnableAgents(): readonly { id: string; aliases: readonly string[] }[];
    }>,
    import(customSpawnModuleUrl) as Promise<{ POE_AGENT_SPAWN_SERVICE: string }>
  ]);
  const agents: SpawnConfigLike[] = configsModule.listSpawnableAgents().map((agent) => ({
    agentId: agent.id,
    aliases: agent.aliases,
    kind: "cli"
  }));
  if (!agents.some((agent) => agent.agentId === customSpawnModule.POE_AGENT_SPAWN_SERVICE)) {
    agents.push({ agentId: customSpawnModule.POE_AGENT_SPAWN_SERVICE, kind: "cli" });
  }
  return agents.sort((left, right) => left.agentId.localeCompare(right.agentId));
}

function resolveKnownEventNames(sourceFile: SourceFile): string[] {
  const knownAcpEvent = sourceFile.getTypeAliasOrThrow("KnownAcpEvent");
  const typeNode = knownAcpEvent.getTypeNodeOrThrow();

  if (!Node.isUnionTypeNode(typeNode)) {
    if (!Node.isTypeReference(typeNode)) {
      throw new Error("KnownAcpEvent must reference one or more interfaces.");
    }
    return [typeNode.getTypeName().getText()];
  }

  return typeNode.getTypeNodes().map((node) => {
    if (!Node.isTypeReference(node)) {
      throw new Error(
        `KnownAcpEvent can only contain interface references. Received ${node.getText()}.`
      );
    }
    return node.getTypeName().getText();
  });
}

function buildUsagePayloadSignature(usageEventInterface: InterfaceDeclaration): string {
  return usageEventInterface
    .getProperties()
    .filter((property) => property.getName() !== "event" && !shouldSkipProperty(property.getName()))
    .map((property) => {
      const typeNode = property.getTypeNodeOrThrow();
      const resolved = unwrapOptionalType(typeNode);
      return `${property.getName()}:${resolved.typeNode.getText()}:${resolved.optional || property.hasQuestionToken()}`;
    })
    .join("|");
}

function buildPythonClass(
  declaration: InterfaceDeclaration,
  usagePayloadSignature: string | undefined
): PythonClass {
  const eventProperty = declaration.getPropertyOrThrow("event");
  const eventValue = resolveStringLiteralType(eventProperty.getTypeNodeOrThrow());
  const fields = declaration
    .getProperties()
    .filter((property) => !shouldSkipProperty(property.getName()))
    .map((property) => buildPythonField(property, usagePayloadSignature))
    .sort(comparePythonFields);

  return {
    name: declaration.getName(),
    eventValue,
    fields
  };
}

function buildPythonField(
  property: PropertySignature,
  usagePayloadSignature: string | undefined
): PythonField {
  const typeNode = property.getTypeNodeOrThrow();
  const resolved = unwrapOptionalType(typeNode);
  const pythonName = toSnakeCase(property.getName());
  const baseType = mapTypeNodeToPython(
    resolved.typeNode,
    property.getName(),
    usagePayloadSignature
  );
  const optional = property.hasQuestionToken() || resolved.optional;

  return {
    name: pythonName,
    type: optional ? wrapOptional(baseType) : baseType,
    optional
  };
}

function comparePythonFields(left: PythonField, right: PythonField): number {
  if (left.name === "event") {
    return -1;
  }
  if (right.name === "event") {
    return 1;
  }
  if (left.optional === right.optional) {
    return 0;
  }
  return left.optional ? 1 : -1;
}

function mapTypeNodeToPython(
  typeNode: TypeNode,
  propertyName: string,
  usagePayloadSignature: string | undefined
): string {
  if (Node.isUnionTypeNode(typeNode)) {
    const resolved = unwrapOptionalType(typeNode);
    if (resolved.optional) {
      return wrapOptional(
        mapTypeNodeToPython(resolved.typeNode, propertyName, usagePayloadSignature)
      );
    }

    const literalUnion = renderLiteralUnion(typeNode.getTypeNodes());
    if (literalUnion) {
      return literalUnion;
    }

    const memberTypes = [
      ...new Set(
        typeNode
          .getTypeNodes()
          .map((node) => mapTypeNodeToPython(node, propertyName, usagePayloadSignature))
      )
    ];

    return memberTypes.length === 1 ? memberTypes[0] : `Union[${memberTypes.join(", ")}]`;
  }

  if (Node.isParenthesizedTypeNode(typeNode)) {
    return mapTypeNodeToPython(typeNode.getTypeNode(), propertyName, usagePayloadSignature);
  }

  if (Node.isTypeReference(typeNode)) {
    const aliasDeclaration = resolveTypeAliasDeclaration(typeNode);
    if (aliasDeclaration) {
      return mapTypeNodeToPython(
        aliasDeclaration.getTypeNodeOrThrow(),
        propertyName,
        usagePayloadSignature
      );
    }

    if (typeNode.getTypeName().getText() === "Record") {
      return "object";
    }
  }

  if (Node.isLiteralTypeNode(typeNode)) {
    const literal = typeNode.getLiteral();
    if (Node.isStringLiteral(literal)) {
      return `Literal["${literal.getLiteralValue()}"]`;
    }
  }

  if (Node.isTypeLiteral(typeNode)) {
    return isUsagePayloadType(typeNode, usagePayloadSignature) ? "UsageEvent" : "object";
  }

  if (typeNode.getKind() === SyntaxKind.StringKeyword) {
    return "str";
  }

  if (typeNode.getKind() === SyntaxKind.NumberKeyword) {
    return resolvePythonNumberType(propertyName);
  }

  if (typeNode.getKind() === SyntaxKind.BooleanKeyword) {
    return "bool";
  }

  return "object";
}

function renderLiteralUnion(typeNodes: readonly TypeNode[]): string | undefined {
  const literalNodes = typeNodes.filter((typeNode): typeNode is LiteralTypeNode =>
    Node.isLiteralTypeNode(typeNode)
  );

  if (literalNodes.length !== typeNodes.length) {
    return undefined;
  }

  const literalValues = literalNodes
    .map((typeNode) => typeNode.getLiteral())
    .filter(Node.isStringLiteral)
    .map((literal) => literal.getLiteralValue());

  if (literalValues.length !== typeNodes.length) {
    return undefined;
  }

  return `Literal[${literalValues.map((value) => `"${value}"`).join(", ")}]`;
}

function resolveTypeAliasDeclaration(typeNode: TypeNode): TypeAliasDeclaration | undefined {
  if (!Node.isTypeReference(typeNode)) {
    return undefined;
  }

  const type = typeNode.getType();
  const aliasSymbol = type.getAliasSymbol();
  const symbol = aliasSymbol ?? type.getSymbol();

  return symbol?.getDeclarations().find(Node.isTypeAliasDeclaration);
}

function unwrapOptionalType(typeNode: TypeNode): {
  typeNode: TypeNode;
  optional: boolean;
} {
  if (!Node.isUnionTypeNode(typeNode)) {
    return {
      typeNode,
      optional: false
    };
  }

  const nonNullableNodes = typeNode
    .getTypeNodes()
    .filter((node) => node.getKind() !== SyntaxKind.UndefinedKeyword)
    .filter((node) => node.getKind() !== SyntaxKind.NullKeyword);

  if (nonNullableNodes.length !== typeNode.getTypeNodes().length && nonNullableNodes.length === 1) {
    return {
      typeNode: nonNullableNodes[0],
      optional: true
    };
  }

  return {
    typeNode,
    optional: false
  };
}

function resolveStringLiteralType(typeNode: TypeNode): string {
  if (!Node.isLiteralTypeNode(typeNode)) {
    throw new Error(`Expected a string literal type, received ${typeNode.getText()}.`);
  }
  const literal = typeNode.getLiteral();
  if (!Node.isStringLiteral(literal)) {
    throw new Error(`Expected a string literal type, received ${typeNode.getText()}.`);
  }
  return literal.getLiteralValue();
}

function resolveStringLiteralUnion(sourceFile: SourceFile, aliasName: string): string[] {
  const alias = sourceFile.getTypeAliasOrThrow(aliasName);
  const typeNode = alias.getTypeNodeOrThrow();
  const tupleValues = resolveConstTupleValues(sourceFile, typeNode);
  if (tupleValues !== undefined) {
    return tupleValues;
  }

  if (!Node.isUnionTypeNode(typeNode)) {
    return [resolveStringLiteralType(typeNode)];
  }

  return typeNode.getTypeNodes().map(resolveStringLiteralType);
}

function resolveConstTupleValues(sourceFile: SourceFile, typeNode: TypeNode): string[] | undefined {
  if (!Node.isIndexedAccessTypeNode(typeNode)) {
    return undefined;
  }
  if (typeNode.getIndexTypeNode().getKind() !== SyntaxKind.NumberKeyword) {
    return undefined;
  }

  let objectType = typeNode.getObjectTypeNode();
  while (Node.isParenthesizedTypeNode(objectType)) {
    objectType = objectType.getTypeNode();
  }
  if (!Node.isTypeQuery(objectType)) {
    return undefined;
  }

  const tupleName = objectType.getExprName();
  if (!Node.isIdentifier(tupleName)) {
    return undefined;
  }
  const initializer = sourceFile.getVariableDeclaration(tupleName.getText())?.getInitializer();
  const value = Node.isAsExpression(initializer) ? initializer.getExpression() : initializer;
  if (!Node.isArrayLiteralExpression(value)) {
    return undefined;
  }

  return value.getElements().map((element) => {
    if (!Node.isStringLiteral(element)) {
      throw new Error(`Expected a string literal tuple element, received ${element.getText()}.`);
    }
    return element.getLiteralValue();
  });
}

function resolveSpawnableAgentIds(spawnConfigs: readonly SpawnConfigLike[]): string[] {
  return spawnConfigs
    .filter((config) => config.kind === "cli")
    .flatMap((config) => [config.agentId, ...(config.aliases ?? [])]);
}

function shouldSkipProperty(propertyName: string): boolean {
  return propertyName === "_meta";
}

function resolvePythonNumberType(propertyName: string): string {
  return propertyName.toLowerCase().includes("cost") ? "float" : "int";
}

function wrapOptional(typeName: string): string {
  return typeName.startsWith("Optional[") ? typeName : `Optional[${typeName}]`;
}

function isUsagePayloadType(
  typeNode: TypeLiteralNode,
  usagePayloadSignature: string | undefined
): boolean {
  if (!usagePayloadSignature) {
    return false;
  }

  const signature = typeNode
    .getProperties()
    .map((property) => {
      const resolved = unwrapOptionalType(property.getTypeNodeOrThrow());
      return `${property.getName()}:${resolved.typeNode.getText()}:${resolved.optional || property.hasQuestionToken()}`;
    })
    .join("|");

  return signature === usagePayloadSignature;
}

function renderEnum(name: string, values: readonly string[]): string {
  const lines = [`class ${name}(str, Enum):`];

  if (values.length === 0) {
    lines.push("    pass");
    return lines.join("\n");
  }

  for (const value of values) {
    lines.push(`    ${toEnumMemberName(value)} = "${value}"`);
  }

  return lines.join("\n");
}

function renderDataclass(pythonClass: PythonClass): string {
  return [
    "@dataclass",
    `class ${pythonClass.name}:`,
    ...pythonClass.fields.map((field) =>
      field.optional
        ? `    ${field.name}: ${field.type} = None`
        : `    ${field.name}: ${field.type}`
    )
  ].join("\n");
}

function renderAcpEventUnion(eventNames: readonly string[]): string {
  const lines = ["AcpEvent = Union["];

  for (const eventName of eventNames) {
    lines.push(`    ${eventName},`);
  }

  lines.push("]");
  return lines.join("\n");
}

function toEnumMemberName(value: string): string {
  return value
    .replaceAll(/[^a-zA-Z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "")
    .toUpperCase();
}

function toSnakeCase(value: string): string {
  return value
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replaceAll(/-/g, "_")
    .toLowerCase();
}
