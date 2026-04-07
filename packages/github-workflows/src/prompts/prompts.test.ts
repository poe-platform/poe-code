import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { discoverAutomations } from "../discover.js";

const promptsDir = fileURLToPath(new URL(".", import.meta.url));

const expectedPromptNames = [
  "fix-vulnerabilities",
  "github-issue-comment-created",
  "github-issue-opened",
  "github-pull-request-opened",
  "github-pull-request-synchronized",
  "update-dependencies",
  "update-documentation"
];

const validAuthorAssociations = new Set([
  "COLLABORATOR",
  "CONTRIBUTOR",
  "FIRST_TIMER",
  "FIRST_TIME_CONTRIBUTOR",
  "MANNEQUIN",
  "MEMBER",
  "NONE",
  "OWNER"
]);

describe("built-in prompts", () => {
  it("parses every built-in prompt without error", async () => {
    await expect(discoverAutomations(promptsDir)).resolves.toMatchObject(
      expectedPromptNames.map((name) => ({ name }))
    );
  });

  it("uses valid allow and prefix values when present", async () => {
    const automations = await discoverAutomations(promptsDir);

    expect(automations.map((automation) => automation.name)).toEqual(expectedPromptNames);

    for (const automation of automations) {
      if (automation.allow !== undefined) {
        expect(automation.allow.length).toBeGreaterThan(0);
        for (const association of automation.allow) {
          expect(validAuthorAssociations.has(association)).toBe(true);
        }
      }

      if (automation.prefix !== undefined) {
        expect(automation.prefix.length).toBeGreaterThan(0);
        expect(automation.prefix.trim()).toBe(automation.prefix);
      }
    }
  });

  it("preserves the sourced automation metadata for fix-vulnerabilities", async () => {
    const automations = await discoverAutomations(promptsDir);
    const automation = automations.find(({ name }) => name === "fix-vulnerabilities");

    expect(automation).toMatchObject({
      name: "fix-vulnerabilities",
      source:
        `gh api repos/{owner}/{repo}/dependabot/alerts --jq '[.[] | select(.state=="open")]'`,
      agent: "claude-code"
    });
    expect(automation?.mcp).toBeUndefined();

    expect(automation?.prompt.trimEnd()).toBe(
      "Fix {{dependency.package.name}} ({{security_advisory.severity}}): {{security_advisory.summary}}"
    );
  });

  it("tells the documentation updater to review the full day and reuse its open PR", async () => {
    const automations = await discoverAutomations(promptsDir);
    const automation = automations.find(({ name }) => name === "update-documentation");

    expect(automation?.prompt).toContain("last 24 hours");
    expect(automation?.prompt).toContain("agent/update-documentation");
    expect(automation?.prompt).toContain("update that existing PR");
  });
});
