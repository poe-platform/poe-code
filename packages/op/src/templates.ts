import type { OpField, OpObject, OpSection } from "./types.js";

export interface OpItemTemplate {
  title: string;
  category: string;
  fields: OpField[];
  sections?: OpSection[];
  [key: string]: unknown;
}

const login: OpItemTemplate = {
  title: "",
  category: "LOGIN",
  fields: [
    { id: "username", type: "STRING", purpose: "USERNAME", label: "username", value: "" },
    { id: "password", type: "CONCEALED", purpose: "PASSWORD", label: "password", password_details: { strength: "TERRIBLE" }, value: "" },
    { id: "notesPlain", type: "STRING", purpose: "NOTES", label: "notesPlain", value: "" }
  ]
};

function normalize(value: string): string {
  return value.toUpperCase().split(" ").join("_");
}

export function getItemTemplate(category: string, templates: readonly OpObject[] = [], fallback?: OpObject): OpItemTemplate {
  const selector = normalize(category);
  const matches = templates.filter(template => [template.id, template.name, template.category].some(value => typeof value === "string" && normalize(value) === selector));
  if (matches.length > 1) throw new Error("Ambiguous item template");
  let selected = matches[0];
  if (!selected) {
    if (selector === "LOGIN") return structuredClone(login);
    if (typeof fallback?.category === "string" && normalize(fallback.category) === selector) selected = fallback;
    else throw new Error("Item template schema is unavailable");
  }
  if (typeof selected.category !== "string" || !selected.category || typeof selected.title !== "string" || !Array.isArray(selected.fields) || selected.fields.some(field => field === null || typeof field !== "object" || typeof field.id !== "string" || typeof field.type !== "string")) throw new Error("Invalid item template schema");
  const result: Record<string, unknown> = structuredClone(selected);
  delete result.id;
  delete result.name;
  return result as OpItemTemplate;
}

export function listItemTemplates(templates: readonly OpObject[] = []): string[] {
  const names = new Map<string, string>([["LOGIN", "Login"]]);
  for (const template of templates) {
    const schema = getItemTemplate(template.id, templates);
    names.set(normalize(schema.category), template.name ?? schema.category);
  }
  return [...names.values()];
}
