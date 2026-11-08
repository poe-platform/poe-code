import { expect, it } from "vitest";
import { renderSkillCatalog } from "./skill-catalog.js";

const file = (name: string, content: string) => ({ name, content, file: `/skills/${name}/SKILL.md` });

it("supports YAML metadata and legacy skills while escaping every catalog field", () => {
  const catalog = renderSkillCatalog([
    file("legacy", "# Private body"),
    file("a&b", "\uFEFF---\r\nname: 'quoted <name>'\r\ndescription: >-\r\n  A \"quoted\"\r\n  description & more.\r\n---\r\nBODY_SECRET")
  ]);
  expect(catalog).toContain("<name>legacy</name>");
  expect(catalog).toContain("<name>quoted &lt;name&gt;</name>");
  expect(catalog).toContain("<description>A &quot;quoted&quot; description &amp; more.</description>");
  expect(catalog).toContain("/skills/a&amp;b/SKILL.md");
  expect(catalog).not.toContain("Private body");
  expect(catalog).not.toContain("BODY_SECRET");
});

it("reports malformed metadata and duplicates without dropping valid skills", () => {
  const catalog = renderSkillCatalog([
    file("missing-fence", "---\nname: lost"),
    file("wrong-type", "---\ndescription: [one, two]\n---\nBODY_SECRET"),
    file("wrong-flag", "---\ndisable-model-invocation: 'false'\n---"),
    file("duplicate-key", "---\nname: first\nname: second\n---"),
    file("good", "---\nname: shared\ndescription: Valid\n---"),
    file("duplicate", "---\nname: shared\n---"),
    file("disabled", "---\ndisable-model-invocation: true\ndescription: HIDDEN\n---")
  ])!;
  expect(catalog).toContain("<description>Valid</description>");
  expect(catalog.split("<diagnostic>")).toHaveLength(6);
  expect(catalog).toContain("Duplicate skill name: shared");
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
    expect(catalog).toContain("<skill_diagnostics>");
    expect(catalog).not.toContain("<skill>");
    expect(catalog).not.toContain("BODY_SECRET");
  }
);
