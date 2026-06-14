import {
  parseModule,
  type ArrayPattern,
  type AssignmentPattern,
  type Identifier,
  type MemberExpression,
  type ObjectPattern,
  type RestElement,
  type SourceSpan,
  type VariableDeclaration
} from "../../parse/parser.js";
import { normalizeModules, type Modules } from "./module-registry.js";

export type Diagnostic = {
  code: "AS013";
  severity: "error";
  message: string;
  filename: string;
  line: number;
  column: number;
  span: SourceSpan;
};

export function AS013(
  source: string,
  options: { allowedExportNames?: readonly string[]; filename?: string; modules?: Modules } = {}
): Diagnostic[] {
  const filename = options.filename ?? "<input>";
  const reservedNames = new Set(normalizeModules(options.modules).keys());
  const allowedExportNames = new Set(options.allowedExportNames ?? []);

  if (reservedNames.size === 0) {
    return [];
  }

  const diagnostics: Diagnostic[] = [];
  const module = parseModule(source, filename);

  for (const statement of module.body) {
    if (statement.type === "VariableDeclaration") {
      collectShadowedBindings(statement, reservedNames, diagnostics, filename);
      continue;
    }

    if (statement.type === "ExportNamedDeclaration") {
      collectShadowedBindings(
        statement.declaration,
        reservedNames,
        diagnostics,
        filename,
        allowedExportNames
      );
    }
  }

  return diagnostics;
}

function collectShadowedBindings(
  declaration: VariableDeclaration,
  reservedNames: ReadonlySet<string>,
  diagnostics: Diagnostic[],
  filename: string,
  allowedNames: ReadonlySet<string> = new Set()
): void {
  for (const declarator of declaration.declarations) {
    collectPatternDiagnostics(declarator.id, reservedNames, diagnostics, filename, allowedNames);
  }
}

function collectPatternDiagnostics(
  pattern:
    | ArrayPattern
    | AssignmentPattern
    | Identifier
    | MemberExpression
    | ObjectPattern
    | RestElement,
  reservedNames: ReadonlySet<string>,
  diagnostics: Diagnostic[],
  filename: string,
  allowedNames: ReadonlySet<string>
): void {
  switch (pattern.type) {
    case "Identifier":
      if (reservedNames.has(pattern.name) && !allowedNames.has(pattern.name)) {
        diagnostics.push({
          code: "AS013",
          severity: "error",
          message: `Top-level binding '${pattern.name}' shadows registered module '${pattern.name}'.`,
          filename,
          line: pattern.span.start.line,
          column: pattern.span.start.column,
          span: pattern.span
        });
      }
      return;
    case "AssignmentPattern":
      collectPatternDiagnostics(pattern.left, reservedNames, diagnostics, filename, allowedNames);
      return;
    case "RestElement":
      collectPatternDiagnostics(
        pattern.argument,
        reservedNames,
        diagnostics,
        filename,
        allowedNames
      );
      return;
    case "ArrayPattern":
      for (const element of pattern.elements) {
        if (element !== null) {
          collectPatternDiagnostics(element, reservedNames, diagnostics, filename, allowedNames);
        }
      }
      return;
    case "ObjectPattern":
      for (const property of pattern.properties) {
        collectPatternDiagnostics(
          property.type === "RestElement" ? property : property.value,
          reservedNames,
          diagnostics,
          filename,
          allowedNames
        );
      }
      return;
    case "MemberExpression":
      return;
  }
}
