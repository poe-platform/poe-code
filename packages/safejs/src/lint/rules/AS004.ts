import type { SourceSpan } from "../../parse/parser.js";
import {
  collectImportDeclarations,
  createUnknownModuleMessage,
  normalizeModules,
  type Modules
} from "./module-registry.js";

export type Diagnostic = {
  code: "AS004";
  severity: "error";
  message: string;
  filename: string;
  line: number;
  column: number;
  span: SourceSpan;
};

export function AS004(
  source: string,
  options: { filename?: string; modules?: Modules } = {}
): Diagnostic[] {
  const filename = options.filename ?? "<input>";
  const modules = normalizeModules(options.modules);
  const moduleNames = [...modules.keys()].sort((left, right) => left.localeCompare(right));

  return collectImportDeclarations(source, filename).flatMap((declaration) => {
    if (modules.has(declaration.source.value)) {
      return [];
    }

    return [
      {
        code: "AS004" as const,
        severity: "error" as const,
        message: createUnknownModuleMessage(declaration.source.value, moduleNames),
        filename,
        line: declaration.source.span.start.line,
        column: declaration.source.span.start.column,
        span: declaration.source.span
      }
    ];
  });
}
