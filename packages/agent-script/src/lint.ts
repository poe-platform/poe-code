import { AS001, type Diagnostic as AS001Diagnostic } from "./lint/rules/AS001.js";
import { AS002, type Diagnostic as AS002Diagnostic } from "./lint/rules/AS002.js";
import { AS003, type Diagnostic as AS003Diagnostic } from "./lint/rules/AS003.js";
import { AS004, type Diagnostic as AS004Diagnostic } from "./lint/rules/AS004.js";
import { AS005, type Diagnostic as AS005Diagnostic } from "./lint/rules/AS005.js";
import { AS006_007, type Diagnostic as AS006007Diagnostic } from "./lint/rules/AS006-007.js";
import { AS008, type Diagnostic as AS008Diagnostic } from "./lint/rules/AS008.js";
import { AS009, type Diagnostic as AS009Diagnostic } from "./lint/rules/AS009.js";
import { AS010, type Diagnostic as AS010Diagnostic } from "./lint/rules/AS010.js";
import { AS011, type Diagnostic as AS011Diagnostic } from "./lint/rules/AS011.js";
import { AS012, type Diagnostic as AS012Diagnostic } from "./lint/rules/AS012.js";
import type { Modules } from "./lint/rules/module-registry.js";

export type Diagnostic =
  | AS001Diagnostic
  | AS002Diagnostic
  | AS003Diagnostic
  | AS004Diagnostic
  | AS005Diagnostic
  | AS006007Diagnostic
  | AS008Diagnostic
  | AS009Diagnostic
  | AS010Diagnostic
  | AS011Diagnostic
  | AS012Diagnostic;

export function lint(source: string, options: { filename?: string; modules?: Modules } = {}): Diagnostic[] {
  const diagnostics = [
    ...AS001(source, options),
    ...AS002(source, options),
    ...AS003(source, options),
    ...AS004(source, options),
    ...AS005(source, options),
    ...AS006_007(source, options),
    ...AS008(source, options),
    ...AS009(source, options),
    ...AS010(source, options),
    ...AS011(source, options),
    ...AS012(source, options)
  ];

  const as010Keys = new Set(
    diagnostics
      .filter((diagnostic): diagnostic is AS010Diagnostic => diagnostic.code === "AS010")
      .map((diagnostic) => createSpanKey(diagnostic.span))
  );

  return diagnostics
    .filter((diagnostic) => diagnostic.code !== "AS007" || !as010Keys.has(createSpanKey(diagnostic.span)))
    .sort(compareDiagnostics);
}

function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  return (
    left.span.start.offset - right.span.start.offset ||
    left.span.end.offset - right.span.end.offset ||
    left.code.localeCompare(right.code)
  );
}

function createSpanKey(span: Diagnostic["span"]): string {
  return `${span.start.offset}:${span.end.offset}`;
}
