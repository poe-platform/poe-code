import type { TemplateLiteral } from "../parse.js";
import type { Budget } from "./budget.js";
import type { SandboxArray } from "./values.js";

export const templateRealms = new WeakMap<Budget, Map<TemplateLiteral, SandboxArray>>();

export function releaseTemplateObjects(budget: Budget): void {
  const realm = templateRealms.get(budget);
  if (realm !== undefined) budget.setRetainedValues(realm, undefined);
  templateRealms.delete(budget);
}
