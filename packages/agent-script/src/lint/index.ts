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
import { AS015 } from "./rules/AS015.js";
import { AS_ASYNC_NOT_NEEDED } from "./rules/AS-async-not-needed.js";
import { AS_AWAIT_NON_PROMISE } from "./rules/AS-await-non-promise.js";
import { AS_DESTRUCTURE_NULL_DEFAULT } from "./rules/AS-destructure-null-default.js";
import { AS_EXPORT_IMPORT_META } from "./rules/AS-export-import-meta.js";
import { AS_FLOATING_PROMISE } from "./rules/AS-floating-promise.js";
import { AS_IMPORT_CYCLE } from "./rules/AS-import-cycle.js";
import { AS_JSDOC_TYPE } from "./rules/AS-jsdoc-type.js";
import { AS_MISSING_ASYNC } from "./rules/AS-missing-async.js";
import { AS_MUTATING_FROZEN } from "./rules/AS-mutating-frozen.js";
import { AS_NEEDLESS_TEMPLATE } from "./rules/AS-needless-template.js";
import { AS_SHADOW_GLOBAL } from "./rules/AS-shadow-global.js";
import { AS_UNBOUNDED_LOOP } from "./rules/AS-unbounded-loop.js";
import { AS_UNREACHABLE } from "./rules/AS-unreachable.js";
import { AS_UNUSED_IMPORT } from "./rules/AS-unused-import.js";
import type { SourceSpan } from "../parse/parser.js";
import type { Modules } from "./rules/module-registry.js";

export type Diagnostic = {
  code: string;
  severity: "error" | "info" | "warning";
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
  AS_SHADOW_GLOBAL,
  AS_UNUSED_IMPORT,
  AS006_007,
  AS_MISSING_ASYNC,
  AS008,
  AS009,
  AS010,
  AS011,
  AS012,
  AS013,
  AS015,
  AS_IMPORT_CYCLE,
  AS_AWAIT_NON_PROMISE,
  AS_FLOATING_PROMISE,
  AS_ASYNC_NOT_NEEDED,
  AS_JSDOC_TYPE,
  AS_NEEDLESS_TEMPLATE,
  AS_MUTATING_FROZEN,
  AS_DESTRUCTURE_NULL_DEFAULT,
  AS_UNBOUNDED_LOOP,
  AS_UNREACHABLE,
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
    diagnostics
      .filter((diagnostic) => diagnostic.code === "AS010")
      .map((diagnostic) => createSpanKey(diagnostic.span))
  );

  return diagnostics
    .filter(
      (diagnostic) => diagnostic.code !== "AS007" || !as010Keys.has(createSpanKey(diagnostic.span))
    )
    .sort(compareDiagnostics);
}

function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  return (
    left.line - right.line || left.column - right.column || left.code.localeCompare(right.code)
  );
}

function createSpanKey(span: SourceSpan): string {
  return `${span.start.offset}:${span.end.offset}`;
}

function hasOnlyRegexLiteralDiagnostics(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.every(
    (diagnostic) => diagnostic.message === "Disallowed syntax: regex literal."
  );
}
