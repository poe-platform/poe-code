import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { generateProjectVariablesFile, loadVariableStatuses, loadVariables } = await import("./variables.js");

async function withObjectPrototypeProperty<T>(
  key: string,
  value: unknown,
  callback: () => Promise<T>
): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(Object.prototype, key);
  Object.defineProperty(Object.prototype, key, {
    configurable: true,
    value
  });

  try {
    return await callback();
  } finally {
    if (original === undefined) {
      delete (Object.prototype as Record<string, unknown>)[key];
    } else {
      Object.defineProperty(Object.prototype, key, original);
    }
  }
}

describe("variables", () => {
  beforeEach(() => {
    vol.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads built-in defaults when the project variables file is missing", async () => {
    vol.fromJSON({
      "/built-in/variables.yaml": [
        "response_style: |",
        "  - Start with a direct answer.",
        "verify_before_responding: |",
        "  Verify against the repo.",
        ""
      ].join("\n")
    });

    await expect(loadVariables("/built-in", "/repo/.github/workflows")).resolves.toEqual({
      response_style: "- Start with a direct answer.\n",
      verify_before_responding: "Verify against the repo.\n"
    });
  });

  it("does not hide project variables read failures with inherited missing-file codes", async () => {
    vol.fromJSON({
      "/built-in/variables.yaml": ["response_style: |", "  Be direct.", ""].join("\n")
    });
    const readFile = vol.promises.readFile.bind(vol.promises);
    vi.spyOn(vol.promises, "readFile").mockImplementation(async (...args) => {
      if (String(args[0]) === "/repo/.github/workflows/variables.yaml") {
        throw new Error("project variables read denied");
      }

      return readFile(...args);
    });

    await withObjectPrototypeProperty("code", "ENOENT", async () => {
      await expect(loadVariables("/built-in", "/repo/.github/workflows")).rejects.toThrow(
        "project variables read denied"
      );
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
      "/repo/.github/workflows/variables.yaml": [
        "# response_style: |",
        "#   - Custom response style.",
        "# verify_before_responding: |",
        "#   Custom verification.",
        ""
      ].join("\n")
    });

    await expect(loadVariables("/built-in", "/repo/.github/workflows")).resolves.toEqual({
      response_style: "- Start with a direct answer.\n",
      verify_before_responding: "Verify against the repo.\n"
    });
  });

  it("lets a project override replace a built-in variable", async () => {
    vol.fromJSON({
      "/built-in/variables.yaml": [
        "response_style: |",
        "  - Start with a direct answer.",
        "verify_before_responding: |",
        "  Verify against the repo.",
        ""
      ].join("\n"),
      "/repo/.github/workflows/variables.yaml": [
        "response_style: |",
        "  - Answer in the house style.",
        ""
      ].join("\n")
    });

    await expect(loadVariables("/built-in", "/repo/.github/workflows")).resolves.toEqual({
      response_style: "- Answer in the house style.\n",
      verify_before_responding: "Verify against the repo.\n"
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
      "/repo/.github/workflows/variables.yaml": 'skill_github_cli: ""\n'
    });

    await expect(loadVariables("/built-in", "/repo/.github/workflows")).resolves.toEqual({
      response_style: "- Start with a direct answer.\n"
    });
  });

  it("includes custom project variables in the resolved result", async () => {
    vol.fromJSON({
      "/built-in/variables.yaml": [
        "response_style: |",
        "  - Start with a direct answer.",
        "verify_before_responding: |",
        "  Verify against the repo.",
        ""
      ].join("\n"),
      "/repo/.github/workflows/variables.yaml": [
        "custom_project_rules: |",
        "  Check docs/internal.md first.",
        ""
      ].join("\n")
    });

    await expect(loadVariables("/built-in", "/repo/.github/workflows")).resolves.toEqual({
      response_style: "- Start with a direct answer.\n",
      verify_before_responding: "Verify against the repo.\n",
      custom_project_rules: "Check docs/internal.md first.\n"
    });
  });

  it("lets a project opt out of built-in defaults with extends: false", async () => {
    vol.fromJSON({
      "/built-in/variables.yaml": [
        "response_style: |",
        "  - Start with a direct answer.",
        "verify_before_responding: |",
        "  Verify against the repo.",
        ""
      ].join("\n"),
      "/repo/.github/workflows/variables.yaml": [
        "extends: false",
        "custom_project_rules: |",
        "  Check docs/internal.md first.",
        ""
      ].join("\n")
    });

    await expect(loadVariables("/built-in", "/repo/.github/workflows")).resolves.toEqual({
      custom_project_rules: "Check docs/internal.md first.\n"
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
      "/repo/.github/workflows/variables.yaml": [
        "verify_before_responding: |",
        "  Check the changed files first.",
        'skill_github_cli: ""',
        "custom_project_rules: |",
        "  Follow docs/internal.md.",
        ""
      ].join("\n")
    });

    await expect(loadVariableStatuses("/built-in", "/repo/.github/workflows")).resolves.toEqual([
      { name: "response_style", source: "built-in", status: "default" },
      {
        name: "verify_before_responding",
        source: "/repo/.github/workflows/variables.yaml",
        status: "overridden"
      },
      {
        name: "skill_github_cli",
        source: "/repo/.github/workflows/variables.yaml",
        status: "disabled"
      },
      {
        name: "custom_project_rules",
        source: "/repo/.github/workflows/variables.yaml",
        status: "custom"
      }
    ]);
  });

  it("reports only project-defined variables when extends: false disables built-in inheritance", async () => {
    vol.fromJSON({
      "/built-in/variables.yaml": [
        "response_style: |",
        "  - Start with a direct answer.",
        "verify_before_responding: |",
        "  Verify against the repo.",
        ""
      ].join("\n"),
      "/repo/.github/workflows/variables.yaml": [
        "extends: false",
        "response_style: |",
        "  - Answer in the house style.",
        "custom_project_rules: |",
        "  Follow docs/internal.md.",
        ""
      ].join("\n")
    });

    await expect(loadVariableStatuses("/built-in", "/repo/.github/workflows")).resolves.toEqual([
      {
        name: "response_style",
        source: "/repo/.github/workflows/variables.yaml",
        status: "overridden"
      },
      {
        name: "custom_project_rules",
        source: "/repo/.github/workflows/variables.yaml",
        status: "custom"
      }
    ]);
  });

  it("ignores inherited extends flags when reporting project variable statuses", async () => {
    vol.fromJSON({
      "/built-in/variables.yaml": ["response_style: |", "  Be direct.", ""].join("\n"),
      "/repo/.github/workflows/variables.yaml": "{}\n"
    });

    await withObjectPrototypeProperty("extends", false, async () => {
      await expect(loadVariableStatuses("/built-in", "/repo/.github/workflows")).resolves.toEqual([
        { name: "response_style", source: "built-in", status: "default" }
      ]);
    });
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

  it("preserves extends: false when regenerating the project file", () => {
    const content = generateProjectVariablesFile(
      {
        response_style: "Be direct.\n",
        verify_before_responding: "Check the repo.\n"
      },
      ["extends: false", "", "custom_project_rules: |", "  Follow docs/internal.md.", ""].join("\n")
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
        "extends: false",
        "",
        "# response_style: |",
        "#   Be direct.",
        "",
        "# verify_before_responding: |",
        "#   Check the repo.",
        "",
        "custom_project_rules: |",
        "  Follow docs/internal.md.",
        ""
      ].join("\n")
    );
  });

  it("preserves a user override named __proto__ when regenerating the project file", () => {
    const content = generateProjectVariablesFile({}, "__proto__: visible\n");

    expect(content).toContain("__proto__: visible");
  });
});
