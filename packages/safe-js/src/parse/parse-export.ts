import type { Token } from "./tokenizer.js";
import type {
  ClassDeclaration,
  Expression,
  FunctionDeclaration,
  Module,
  SourceSpan,
  VariableDeclaration,
  VariableDeclarator
} from "./parser.js";

export type ExportNamedDeclaration = {
  nodeId?: number;
  type: "ExportNamedDeclaration";
  declaration: VariableDeclaration;
  span: SourceSpan;
};

export type ExportDefaultDeclaration = {
  nodeId?: number;
  type: "ExportDefaultDeclaration";
  declaration: Expression | ClassDeclaration | FunctionDeclaration;
  span: SourceSpan;
};

export type ExtractedNamedExport = {
  type: "named";
  name: string;
  declaration: VariableDeclarator;
  statement: ExportNamedDeclaration;
  span: SourceSpan;
};

export type ExtractedDefaultExport = {
  type: "default";
  name: "default";
  declaration: Expression | ClassDeclaration | FunctionDeclaration;
  statement: ExportDefaultDeclaration;
  span: SourceSpan;
};

export type ExtractedTopLevelExport = ExtractedDefaultExport | ExtractedNamedExport;

export class ExportExtractionError extends Error {
  readonly span?: SourceSpan;

  constructor(message: string, span?: SourceSpan) {
    super(
      span === undefined
        ? message
        : `${message} At line ${span.start.line}, column ${span.start.column}.`
    );
    this.name = "ExportExtractionError";
    this.span = span;
  }
}

export function extractTopLevelExports(module: Module): ExtractedTopLevelExport[] {
  const exports: ExtractedTopLevelExport[] = [];
  let defaultExport: ExportDefaultDeclaration | undefined;

  for (const statement of module.body) {
    if (statement.type === "ExportDefaultDeclaration") {
      if (defaultExport !== undefined) {
        throw new ExportExtractionError(
          "Module contains more than one export default declaration.",
          statement.span
        );
      }

      defaultExport = statement;
      exports.push({
        type: "default",
        name: "default",
        declaration: statement.declaration,
        statement,
        span: statement.span
      });
      continue;
    }

    if (statement.type !== "ExportNamedDeclaration") {
      continue;
    }

    for (const declaration of statement.declaration.declarations) {
      if (declaration.id.type !== "Identifier") {
        throw new ExportExtractionError(
          "Exported const declarations must bind identifiers.",
          declaration.id.span
        );
      }

      exports.push({
        type: "named",
        name: declaration.id.name,
        declaration,
        statement,
        span: declaration.span
      });
    }
  }

  return exports;
}

export function createExportNamedDeclaration(
  exportToken: Token,
  declaration: VariableDeclaration
): ExportNamedDeclaration {
  return {
    type: "ExportNamedDeclaration",
    declaration,
    span: createSpan(exportToken.start, declaration.span.end)
  };
}

export function createExportDefaultDeclaration(
  exportToken: Token,
  declaration: Expression | ClassDeclaration | FunctionDeclaration
): ExportDefaultDeclaration {
  return {
    type: "ExportDefaultDeclaration",
    declaration,
    span: createSpan(exportToken.start, declaration.span.end)
  };
}

function createSpan(start: SourceSpan["start"], end: SourceSpan["end"]): SourceSpan {
  return {
    start: { ...start },
    end: { ...end }
  };
}
