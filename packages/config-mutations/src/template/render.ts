import { renderTemplate as renderDesignTemplate } from "@poe-code/design-system";

export type TemplateVariables = Record<string, string | number | boolean | string[]>;

/**
 * Render a mustache template with the given variables.
 * HTML escaping is disabled.
 */
export function renderTemplate(
  template: string,
  variables: TemplateVariables
): string {
  return renderDesignTemplate(template, variables, { escape: "none" });
}
