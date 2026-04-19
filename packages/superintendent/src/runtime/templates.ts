export type TemplateContext = {
  plan: { path: string };
  builder: { summary: string; log: string; log_path: string };
  inspectors: Record<string, string>;
  inspector_logs: Record<string, string>;
  superintendent: { summary: string; log_path?: string };
  owner: { feedback: string; log_path?: string };
};

const templateVariablePattern = /{{\s*([A-Za-z0-9_.-]+)\s*}}/g;
const inspectorReferencePattern = /{{\s*inspectors\.([A-Za-z0-9_-]+)\s*}}/g;

export function resolveTemplate(template: string, context: Partial<TemplateContext>): string {
  return template.replace(templateVariablePattern, (match, variablePath: string) => {
    const value = readTemplateValue(context, variablePath);
    return typeof value === "string" ? value : match;
  });
}

export function collectReferencedInspectors(template: string): Set<string> {
  const names = new Set<string>();

  for (const match of template.matchAll(inspectorReferencePattern)) {
    names.add(match[1]);
  }

  return names;
}

function readTemplateValue(context: Partial<TemplateContext>, variablePath: string): unknown {
  return variablePath
    .split(".")
    .reduce<unknown>((value, segment) => (isRecord(value) ? value[segment] : undefined), context);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
