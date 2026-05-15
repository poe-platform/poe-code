import { AS001 } from "./rules/AS001.js";
import { AS002 } from "./rules/AS002.js";
import { AS003 } from "./rules/AS003.js";
import { AS004 } from "./rules/AS004.js";
import { AS005 } from "./rules/AS005.js";
import { AS006_007 } from "./rules/AS006-007.js";
import { AS008 } from "./rules/AS008.js";
import { AS009 } from "./rules/AS009.js";
import { AS010 } from "./rules/AS010.js";
import { AS011 } from "./rules/AS011.js";
import { AS012 } from "./rules/AS012.js";
import { AS013 } from "./rules/AS013.js";
import { AS014 } from "./rules/AS014.js";
import { AS015 } from "./rules/AS015.js";
import { AS_EXPORT_IMPORT_META } from "./rules/AS-export-import-meta.js";
import type { SourceSpan } from "../parse/parser.js";
import type { Modules } from "./rules/module-registry.js";

export type Diagnostic = {
  code: string;
  severity: "error" | "warning";
  message: string;
  filename: string;
  line: number;
  column: number;
  span: SourceSpan;
  hint?: string;
};

export type LintOptions = {
  allowedExportNames?: readonly string[];
  allowedGlobals?: readonly string[];
  filename?: string;
  modules?: Modules;
};

type LintRule = (source: string, options: LintOptions) => readonly Diagnostic[];

const RULES: readonly LintRule[] = [
  AS002,
  AS003,
  AS004,
  AS005,
  AS006_007,
  AS008,
  AS009,
  AS010,
  AS011,
  AS012,
  AS013,
  AS014,
  AS015,
  AS_EXPORT_IMPORT_META
];

export function lint(source: string, options: LintOptions = {}): Diagnostic[] {
  const as001Diagnostics = AS001(source, options);
  if (as001Diagnostics.length > 0 && !hasOnlyRegexLiteralDiagnostics(as001Diagnostics)) {
    return [...as001Diagnostics].sort(compareDiagnostics);
  }

  const diagnostics: Diagnostic[] = [...as001Diagnostics];
  for (const rule of RULES) {
    diagnostics.push(...rule(source, options));
  }

  const as010Keys = new Set(
    diagnostics.filter((diagnostic) => diagnostic.code === "AS010").map((diagnostic) => createSpanKey(diagnostic.span))
  );

  return diagnostics
    .filter((diagnostic) => diagnostic.code !== "AS007" || !as010Keys.has(createSpanKey(diagnostic.span)))
    .sort(compareDiagnostics);
}

function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  return left.line - right.line || left.column - right.column || left.code.localeCompare(right.code);
}

function createSpanKey(span: SourceSpan): string {
  return `${span.start.offset}:${span.end.offset}`;
}

function hasOnlyRegexLiteralDiagnostics(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.every((diagnostic) => diagnostic.message === "Disallowed syntax: regex literal.");
}
