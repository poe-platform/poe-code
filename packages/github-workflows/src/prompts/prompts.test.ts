import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { discoverAutomations } from "../discover.js";

const promptsDir = fileURLToPath(new URL(".", import.meta.url));

const expectedPromptNames = [
  "fix-vulnerabilities",
  "github-issue-comment-created",
  "github-issue-opened",
  "github-pull-request-comment-created",
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
        const prefixes = Array.isArray(automation.prefix) ? automation.prefix : [automation.prefix];
        expect(prefixes.length).toBeGreaterThan(0);
        for (const prefix of prefixes) {
          expect(prefix.length).toBeGreaterThan(0);
          expect(prefix.trim()).toBe(prefix);
        }
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

    expect(automation?.prompt).toContain(
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

  it("tells the issue comment handler to open or update a PR for code changes", async () => {
    const automations = await discoverAutomations(promptsDir);
    const automation = automations.find(({ name }) => name === "github-issue-comment-created");

    expect(automation?.prompt).toContain("open or update a PR");
    expect(automation?.prompt).toContain("leave a visible GitHub response");
    expect(automation?.prompt).toContain("check for existing open PRs");
  });

  it("restricts comment-triggered write automations to current collaborators", async () => {
    const automations = await discoverAutomations(promptsDir);

    for (const name of [
      "github-issue-comment-created",
      "github-pull-request-comment-created"
    ]) {
      expect(automations.find((automation) => automation.name === name)?.allow).toEqual([
        "OWNER",
        "MEMBER",
        "COLLABORATOR"
      ]);
    }
  });

  it("keeps issue-opened automation from closing unclear issues", async () => {
    const automations = await discoverAutomations(promptsDir);
    const automation = automations.find(({ name }) => name === "github-issue-opened");

    expect(automation?.prompt).toContain("ask for the missing details");
    expect(automation?.prompt).not.toContain("gh issue close");
  });

  it("uses shared response variables in the GitHub issue prompts", async () => {
    const automations = await discoverAutomations(promptsDir);

    for (const name of ["github-issue-opened", "github-issue-comment-created"]) {
      const automation = automations.find((candidate) => candidate.name === name);

      expect(automation?.prompt).toContain("{{response_style}}");
      expect(automation?.prompt).toContain("{{verify_before_responding}}");
      expect(automation?.prompt).not.toContain("- Start with a direct answer or decision.");
      expect(automation?.prompt).not.toContain("Before answering:");
    }
  });


  it("tells GitHub responders to use body files for multiline gh content", async () => {
    const automations = await discoverAutomations(promptsDir);

    for (const name of [
      "github-issue-opened",
      "github-issue-comment-created",
      "github-pull-request-opened",
      "github-pull-request-comment-created",
      "github-pull-request-synchronized"
    ]) {
      const automation = automations.find((candidate) => candidate.name === name);

      expect(automation?.prompt).toContain("--body-file");
      expect(automation?.prompt).toContain("quoted heredoc");
    }
  });
});
