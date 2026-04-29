import { AS001, type Diagnostic as AS001Diagnostic } from "./lint/rules/AS001.js";
import { AS002, type Diagnostic as AS002Diagnostic } from "./lint/rules/AS002.js";
import { AS003, type Diagnostic as AS003Diagnostic } from "./lint/rules/AS003.js";
import { AS004, type Diagnostic as AS004Diagnostic } from "./lint/rules/AS004.js";
import { AS005, type Diagnostic as AS005Diagnostic } from "./lint/rules/AS005.js";
import { AS006_007, type Diagnostic as AS006007Diagnostic } from "./lint/rules/AS006-007.js";
import { AS008, type Diagnostic as AS008Diagnostic } from "./lint/rules/AS008.js";
import { AS009, type Diagnostic as AS009Diagnostic } from "./lint/rules/AS009.js";
import type { Modules } from "./lint/rules/module-registry.js";

export type Diagnostic =
  | AS001Diagnostic
  | AS002Diagnostic
  | AS003Diagnostic
  | AS004Diagnostic
  | AS005Diagnostic
  | AS006007Diagnostic
  | AS008Diagnostic
  | AS009Diagnostic;

export function lint(source: string, options: { filename?: string; modules?: Modules } = {}): Diagnostic[] {
  return [
    ...AS001(source, options),
    ...AS002(source, options),
    ...AS003(source, options),
    ...AS004(source, options),
    ...AS005(source, options),
    ...AS006_007(source, options),
    ...AS008(source, options),
    ...AS009(source, options)
  ].sort(compareDiagnostics);
}

function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  return (
    left.span.start.offset - right.span.start.offset ||
    left.span.end.offset - right.span.end.offset ||
    left.code.localeCompare(right.code)
  );
}
