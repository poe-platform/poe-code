import type { SourceSpan } from "../../parse/parser.js";
import {
  collectImportDeclarations,
  createUnknownExportMessage,
  normalizeModules,
  type Modules
} from "./module-registry.js";

export type Diagnostic = {
  code: "AS005";
  severity: "error";
  message: string;
  filename: string;
  line: number;
  column: number;
  span: SourceSpan;
};

export function AS005(
  source: string,
  options: { filename?: string; modules?: Modules } = {}
): Diagnostic[] {
  const filename = options.filename ?? "<input>";
  const modules = normalizeModules(options.modules);

  return collectImportDeclarations(source, filename).flatMap((declaration) => {
    const availableExports = modules.get(declaration.source.value);
    if (availableExports === undefined) {
      return [];
    }

    return declaration.specifiers.flatMap((specifier) => {
      if (specifier.type === "ImportNamespaceSpecifier") {
        return [];
      }

      const importName =
        specifier.type === "ImportDefaultSpecifier" ? "default" : specifier.imported.name;
      if (availableExports.includes(importName)) {
        return [];
      }

      const span =
        specifier.type === "ImportDefaultSpecifier"
          ? specifier.local.span
          : specifier.imported.span;

      return [
        {
          code: "AS005" as const,
          severity: "error" as const,
          message: createUnknownExportMessage(
            declaration.source.value,
            importName,
            availableExports
          ),
          filename,
          line: span.start.line,
          column: span.start.column,
          span
        }
      ];
    });
  });
}
