import { parseDocument } from "yaml";
import type { DiscoveredSkill } from "./discover-skills-async.js";

/** Render file metadata without putting instruction bodies in the model catalog. */
export function renderSkillCatalog(files: readonly DiscoveredSkill[]): string | undefined {
  const skills: string[] = [];
  const diagnostics: string[] = [];
  const names = new Set<string>();
  for (const file of files) {
    try {
      const lines = file.content.split("\n");
      let metadata: Record<string, unknown> = {};
      if (lines[0]?.trim() === "---") {
        const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
        if (end < 0) throw new Error("Missing closing frontmatter delimiter.");
        const document = parseDocument(lines.slice(1, end).join("\n"), { prettyErrors: false });
        if (document.errors.length) throw document.errors[0];
        const value: unknown = document.toJS({ maxAliasCount: 100 });
        if (value !== null && (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype)) {
          throw new Error("Skill frontmatter must be a mapping.");
        }
        metadata = (value ?? {}) as Record<string, unknown>;
      }
      const name = Object.hasOwn(metadata, "name") ? metadata.name : file.name;
      const description = Object.hasOwn(metadata, "description") ? metadata.description : "";
      const disabled = Object.hasOwn(metadata, "disable-model-invocation") ? metadata["disable-model-invocation"] : false;
      if (typeof name !== "string" || !name.trim()) throw new Error("Skill name must be a nonempty string.");
      if (typeof description !== "string") throw new Error("Skill description must be a string.");
      if (typeof disabled !== "boolean") throw new Error("disable-model-invocation must be a boolean.");
      if (names.has(name.trim())) throw new Error(`Duplicate skill name: ${name.trim()}`);
      names.add(name.trim());
      if (disabled) continue;
      skills.push(`<skill>\n<name>${escapeXml(name.trim())}</name>\n<description>${escapeXml(description.trim())}</description>\n<location>${escapeXml(file.file)}</location>\n</skill>`);
    } catch (error) {
      diagnostics.push(`<diagnostic><location>${escapeXml(file.file)}</location><message>${escapeXml(error instanceof Error ? error.message : String(error))}</message></diagnostic>`);
    }
  }
  if (!skills.length && !diagnostics.length) return undefined;
  return [
    "<available_skills>", ...skills, "</available_skills>",
    ...(diagnostics.length ? ["<skill_diagnostics>", ...diagnostics, "</skill_diagnostics>"] : [])
  ].join("\n");
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
