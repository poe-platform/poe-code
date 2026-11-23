import { parseDocument } from "yaml";
import { templates } from "#skill-templates";
import type { DiscoveredSkill } from "./discover-skills-async.js";

/** Render file metadata without putting instruction bodies in the model catalog. */
export function renderSkillCatalog(files: readonly DiscoveredSkill[]): string | undefined {
  const skills: string[] = [];
  const diagnostics: string[] = [];
  for (const file of files) {
    try {
      const lines = file.content.split("\n");
      let metadata: Record<string, unknown> = {};
      if (lines[0]?.trim() === "---") {
        const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
        if (end < 0) throw new Error("Missing closing frontmatter delimiter.");
        const document = parseDocument(lines.slice(1, end).join("\n"), { prettyErrors: false });
        if (document.errors.length) throw new Error("Invalid YAML frontmatter.");
        let value: unknown;
        try {
          value = document.toJS({ maxAliasCount: 100 });
        } catch {
          throw new Error("Invalid YAML frontmatter.");
        }
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
      if (disabled) continue;
      skills.push(`- ${escapeXml(name.trim())}: ${description.trim() ? `${escapeXml(description.trim())} ` : ""}(file: ${escapeXml(file.file)})`);
    } catch (error) {
      diagnostics.push(`- ${escapeXml(file.file)}: ${escapeXml(error instanceof Error ? error.message : String(error))}`);
    }
  }
  if (!skills.length && !diagnostics.length) return undefined;
  const catalog = [
    ...skills,
    ...(diagnostics.length ? ["", templates["skill-catalog-diagnostics.md"].replace("{{diagnostics}}", () => diagnostics.join("\n")).trim()] : [])
  ].join("\n");
  return templates["skill-catalog.md"].replace("{{catalog}}", () => catalog).trim();
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;").replaceAll("\r", " ").replaceAll("\n", " ");
}
