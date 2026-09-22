import type { XmlElement } from "@poe-code/safe-fs/core";
import type { Json } from "../structured/limits.js";
import type { XmlBudget } from "./limits.js";

// Python yq's xq uses xmltodict's attribute, text and repeated-child mapping.
export async function xmlToJson(root: XmlElement, budget: XmlBudget): Promise<Json> {
  async function element(node: XmlElement): Promise<Json> {
    await budget.tick();
    const result: Record<string, Json> = Object.create(null);
    const names = new Set<string>();
    for (const attribute of node.attributes) {
      await budget.tick();
      result["@" + attribute.name] = attribute.value;
    }
    const text: string[] = [];
    for (const child of node.content) {
      await budget.tick();
      if (child.kind === "text" || child.kind === "cdata") text.push(child.text);
      else if (child.kind === "element") {
        const value = await element(child);
        if (!names.has(child.name)) {
          result[child.name] = value;
          names.add(child.name);
        } else {
          const previous = result[child.name]!;
          if (Array.isArray(previous)) previous.push(value);
          else result[child.name] = [previous, value];
        }
      }
    }
    const value = text.join("").trim();
    if (Object.keys(result).length === 0) return value || null;
    if (value) result["#text"] = value;
    return result;
  }
  const result: Record<string, Json> = Object.create(null);
  result[root.name] = await element(root);
  return result;
}
