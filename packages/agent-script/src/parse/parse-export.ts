import type { Token } from "./tokenizer.js";
import type { ArrowFunctionExpression, SourceSpan, VariableDeclaration } from "./parser.js";

export type ExportNamedDeclaration = {
  nodeId?: number;
  type: "ExportNamedDeclaration";
  declaration: VariableDeclaration;
  span: SourceSpan;
};

export type ExportDefaultDeclaration = {
  nodeId?: number;
  type: "ExportDefaultDeclaration";
  declaration: ArrowFunctionExpression;
  span: SourceSpan;
};

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
  declaration: ArrowFunctionExpression
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
