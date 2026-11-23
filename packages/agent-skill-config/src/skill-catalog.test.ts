import { expect, it } from "vitest";
import { renderSkillCatalog } from "./skill-catalog.js";

const file = (name: string, content: string) => ({ name, content, file: `/skills/${name}/SKILL.md` });

it("supports YAML metadata and legacy skills while escaping every catalog field", () => {
  const catalog = renderSkillCatalog([
    file("legacy", "# Private body"),
    file("a&b", "\uFEFF---\r\nname: 'quoted <name>'\r\ndescription: >-\r\n  A \"quoted\"\r\n  description & more.\r\n---\r\nBODY_SECRET")
  ]);
  expect(catalog).toContain("<skills_instructions>\n## Skills\n");
  expect(catalog).toContain("### Available skills\n- legacy: (file: /skills/legacy/SKILL.md)");
  expect(catalog).toContain("- quoted &lt;name&gt;: A &quot;quoted&quot; description &amp; more. (file: /skills/a&amp;b/SKILL.md)");
  expect(catalog).toContain("### How to use skills");
  expect(catalog).toContain("read its `SKILL.md` completely");
  expect(catalog).toContain("configured filesystem");
  expect(catalog).toContain("</skills_instructions>");
  expect(catalog).not.toContain("<available_skills>");
  expect(catalog).toContain("/skills/a&amp;b/SKILL.md");
  expect(catalog).not.toContain("Private body");
  expect(catalog).not.toContain("BODY_SECRET");
});

it("reports malformed metadata and retains same-name skills at distinct paths like Codex", () => {
  const catalog = renderSkillCatalog([
    file("missing-fence", "---\nname: lost"),
    file("wrong-type", "---\ndescription: [one, two]\n---\nBODY_SECRET"),
    file("wrong-flag", "---\ndisable-model-invocation: 'false'\n---"),
    file("duplicate-key", "---\nname: first\nname: second\n---"),
    file("good", "---\nname: shared\ndescription: Valid\n---"),
    file("duplicate", "---\nname: shared\n---"),
    file("disabled", "---\ndisable-model-invocation: true\ndescription: HIDDEN\n---")
  ])!;
  expect(catalog).toContain("- shared: Valid (file: /skills/good/SKILL.md)");
  expect(catalog).toContain("- shared: (file: /skills/duplicate/SKILL.md)");
  expect(catalog).toContain("### Skill diagnostics");
  expect(catalog).toContain("/skills/missing-fence/SKILL.md");
  expect(catalog).toContain("/skills/wrong-type/SKILL.md");
  expect(catalog).toContain("/skills/wrong-flag/SKILL.md");
  expect(catalog).toContain("/skills/duplicate-key/SKILL.md");
  expect(catalog).not.toContain("Duplicate skill name");
  expect(catalog).not.toContain("HIDDEN");
  expect(catalog).not.toContain("BODY_SECRET");
});

it("omits an empty or entirely explicit-only catalog", () => {
  expect(renderSkillCatalog([])).toBeUndefined();
  expect(renderSkillCatalog([file("private", "---\ndisable-model-invocation: true\n---")])).toBeUndefined();
});

it.each(["name: null", "description: null", "disable-model-invocation: null", "[one, two]", "!!set {one, two}"])(
  "reports invalid metadata: %s", (metadata) => {
    const catalog = renderSkillCatalog([file("invalid", `---\n${metadata}\n---\nBODY_SECRET`)]);
    expect(catalog).toContain("### Skill diagnostics");
    expect(catalog).not.toContain("- invalid:");
    expect(catalog).not.toContain("BODY_SECRET");
  }
);

it("keeps multiline metadata on one catalog row and preserves literal template syntax", () => {
  const catalog = renderSkillCatalog([file("multiline", "---\nname: report\ndescription: |\n  First line\n  {{diagnostics}} $& </skills_instructions>\n---")]);
  expect(catalog).toContain("- report: First line {{diagnostics}} $&amp; &lt;/skills_instructions&gt; (file: /skills/multiline/SKILL.md)");
  expect(catalog).not.toContain("### Skill diagnostics");
});
