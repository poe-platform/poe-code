import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { generateProjectVariablesFile, loadVariableStatuses, loadVariables } = await import("./variables.js");

describe("variables", () => {
  beforeEach(() => {
    vol.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads built-in defaults when there is no project variables file", async () => {
    vol.fromJSON({
      "/built-in/variables.yaml": [
        "response_style: |",
        "  - Start with a direct answer.",
        "verify_before_responding: |",
        "  Verify against the repo.",
        ""
      ].join("\n")
    });

    await expect(loadVariables("/built-in")).resolves.toEqual({
      response_style: "- Start with a direct answer.\n",
      verify_before_responding: "Verify against the repo.\n"
    });
  });

  it("ignores commented-out project defaults", async () => {
    vol.fromJSON({
      "/built-in/variables.yaml": [
        "response_style: |",
        "  - Start with a direct answer.",
        "verify_before_responding: |",
        "  Verify against the repo.",
        ""
      ].join("\n"),
      "/repo/.poe-code/github-workflows/variables.yaml": [
        "# response_style: |",
        "#   - Custom response style.",
        "# verify_before_responding: |",
        "#   Custom verification.",
        ""
      ].join("\n")
    });

    await expect(loadVariables("/built-in", "/repo/.poe-code/github-workflows")).resolves.toEqual({
      response_style: "- Start with a direct answer.\n",
      verify_before_responding: "Verify against the repo.\n"
    });
  });

  it("lets project overrides replace built-ins and add custom keys", async () => {
    vol.fromJSON({
      "/built-in/variables.yaml": [
        "response_style: |",
        "  - Start with a direct answer.",
        "verify_before_responding: |",
        "  Verify against the repo.",
        ""
      ].join("\n"),
      "/repo/.poe-code/github-workflows/variables.yaml": [
        "response_style: |",
        "  - Answer in the house style.",
        "custom_project_rules: |",
        "  Check docs/internal.md first.",
        ""
      ].join("\n")
    });

    await expect(loadVariables("/built-in", "/repo/.poe-code/github-workflows")).resolves.toEqual({
      response_style: "- Answer in the house style.\n",
      verify_before_responding: "Verify against the repo.\n",
      custom_project_rules: "Check docs/internal.md first.\n"
    });
  });

  it("drops variables explicitly disabled with an empty string", async () => {
    vol.fromJSON({
      "/built-in/variables.yaml": [
        "response_style: |",
        "  - Start with a direct answer.",
        "skill_github_cli: |",
        "  Use gh for GitHub operations.",
        ""
      ].join("\n"),
      "/repo/.poe-code/github-workflows/variables.yaml": 'skill_github_cli: ""\n'
    });

    await expect(loadVariables("/built-in", "/repo/.poe-code/github-workflows")).resolves.toEqual({
      response_style: "- Start with a direct answer.\n"
    });
  });

  it("reports default, overridden, disabled, and custom variable statuses", async () => {
    vol.fromJSON({
      "/built-in/variables.yaml": [
        "response_style: |",
        "  - Start with a direct answer.",
        "verify_before_responding: |",
        "  Verify against the repo.",
        "skill_github_cli: |",
        "  Use gh for GitHub operations.",
        ""
      ].join("\n"),
      "/repo/.poe-code/github-workflows/variables.yaml": [
        "verify_before_responding: |",
        "  Check the changed files first.",
        'skill_github_cli: ""',
        "custom_project_rules: |",
        "  Follow docs/internal.md.",
        ""
      ].join("\n")
    });

    await expect(loadVariableStatuses("/built-in", "/repo/.poe-code/github-workflows")).resolves.toEqual([
      { name: "response_style", source: "built-in", status: "default" },
      {
        name: "verify_before_responding",
        source: "/repo/.poe-code/github-workflows/variables.yaml",
        status: "overridden"
      },
      {
        name: "skill_github_cli",
        source: "/repo/.poe-code/github-workflows/variables.yaml",
        status: "disabled"
      },
      {
        name: "custom_project_rules",
        source: "/repo/.poe-code/github-workflows/variables.yaml",
        status: "custom"
      }
    ]);
  });

  it("generates a fully commented project file when no existing content is provided", () => {
    const content = generateProjectVariablesFile({
      response_style: "Be direct.\n",
      verify_before_responding: "Check the repo.\n"
    });

    expect(content).toBe(
      [
        "# Preview rendered prompt: poe-code github-workflows prompt-preview <name>",
        "#",
        "# Built-in defaults are shown below as comments.",
        "# To override a variable, uncomment it and replace the value.",
        '# To disable a variable, uncomment it and set it to empty string: ""',
        "# Variables left commented out keep the built-in default.",
        "",
        "# response_style: |",
        "#   Be direct.",
        "",
        "# verify_before_responding: |",
        "#   Check the repo.",
        ""
      ].join("\n")
    );
  });

  it("reapplies user overrides onto refreshed commented defaults", () => {
    const content = generateProjectVariablesFile(
      {
        response_style: "Be direct.\n",
        verify_before_responding: "Check the repo.\n",
        skill_github_cli: "Use gh.\n"
      },
      [
        "# Old generated header",
        "# response_style: |",
        "#   Old response style.",
        "",
        "verify_before_responding: |",
        "  Verify against the changed files first.",
        "",
        "custom_project_rules: |",
        "  Follow docs/internal.md.",
        ""
      ].join("\n")
    );

    expect(content).toBe(
      [
        "# Preview rendered prompt: poe-code github-workflows prompt-preview <name>",
        "#",
        "# Built-in defaults are shown below as comments.",
        "# To override a variable, uncomment it and replace the value.",
        '# To disable a variable, uncomment it and set it to empty string: ""',
        "# Variables left commented out keep the built-in default.",
        "",
        "# response_style: |",
        "#   Be direct.",
        "",
        "verify_before_responding: |",
        "  Verify against the changed files first.",
        "",
        "# skill_github_cli: |",
        "#   Use gh.",
        "",
        "custom_project_rules: |",
        "  Follow docs/internal.md.",
        ""
      ].join("\n")
    );
  });

  it("preserves user-authored override formatting when regenerating the project file", () => {
    const content = generateProjectVariablesFile(
      {
        response_style: "Be direct.\n",
        verify_before_responding: "Check the repo.\n",
        skill_github_cli: "Use gh.\n"
      },
      [
        "# Old generated header",
        "verify_before_responding: >-",
        "  Verify against the changed files first.",
        "",
        "skill_github_cli: ''",
        ""
      ].join("\n")
    );

    expect(content).toBe(
      [
        "# Preview rendered prompt: poe-code github-workflows prompt-preview <name>",
        "#",
        "# Built-in defaults are shown below as comments.",
        "# To override a variable, uncomment it and replace the value.",
        '# To disable a variable, uncomment it and set it to empty string: ""',
        "# Variables left commented out keep the built-in default.",
        "",
        "# response_style: |",
        "#   Be direct.",
        "",
        "verify_before_responding: >-",
        "  Verify against the changed files first.",
        "",
        "skill_github_cli: ''",
        ""
      ].join("\n")
    );
  });
});
