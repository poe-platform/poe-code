import { describe, expect, it } from "vitest";
import {
  buildExecutionPrompt,
  resolveFileIncludes,
  selectNextExecution,
  type ExecutionSelection
} from "./runner.js";
import type { PipelinePlan, ResolvedStepDefinitions } from "../types.js";

function getSelection(plan: PipelinePlan): ExecutionSelection {
  return selectNextExecution(plan);
}

describe("selectNextExecution", () => {
  it("selects the first open stepless task", () => {
    const selection = getSelection({
      tasks: [
        { id: "one", title: "One", prompt: "One", status: "open" }
      ]
    });

    expect(selection).toMatchObject({
      kind: "run",
      task: { id: "one" }
    });
  });

  it("skips completed tasks and selects the next open one", () => {
    const selection = getSelection({
      tasks: [
        { id: "one", title: "One", prompt: "One", status: "done" },
        { id: "two", title: "Two", prompt: "Two", status: "open" }
      ]
    });

    expect(selection).toMatchObject({
      kind: "run",
      task: { id: "two" }
    });
  });

  it("returns a blocking failure for a failed stepless task", () => {
    const selection = getSelection({
      tasks: [
        { id: "one", title: "One", prompt: "One", status: "failed" },
        { id: "two", title: "Two", prompt: "Two", status: "open" }
      ]
    });

    expect(selection).toEqual({
      kind: "blocked",
      task: { id: "one", title: "One", prompt: "One", status: "failed" }
    });
  });

  it("picks the first open step in a stepped task", () => {
    const selection = getSelection({
      tasks: [
        {
          id: "one",
          title: "One",
          prompt: "One",
          status: {
            implement: "done",
            test: "open",
            commit: "open"
          }
        }
      ]
    });

    expect(selection).toMatchObject({
      kind: "run",
      task: { id: "one" },
      stepName: "test"
    });
  });

  it("blocks when any step has failed", () => {
    const selection = getSelection({
      tasks: [
        {
          id: "one",
          title: "One",
          prompt: "One",
          status: {
            implement: "done",
            test: "failed",
            commit: "open"
          }
        }
      ]
    });

    expect(selection).toMatchObject({
      kind: "blocked",
      task: { id: "one" },
      stepName: "test"
    });
  });

  it("returns completed when all work is done", () => {
    const selection = getSelection({
      tasks: [
        { id: "one", title: "One", prompt: "One", status: "done" },
        {
          id: "two",
          title: "Two",
          prompt: "Two",
          status: {
            implement: "done"
          }
        }
      ]
    });

    expect(selection).toEqual({ kind: "completed" });
  });
});

describe("buildExecutionPrompt", () => {
  const steps: ResolvedStepDefinitions = {
    implement: {
      mode: "edit",
      prompt: "{{id}} {{title}}\n{{prompt}}\nPlan: {{plan_path}}"
    }
  };

  it("interpolates step placeholders", () => {
    const prompt = buildExecutionPrompt({
      selection: {
        kind: "run",
        task: {
          id: "auth-hardening",
          title: "Harden auth flow",
          prompt: "Improve auth validation",
          status: {
            implement: "open"
          }
        },
        stepName: "implement"
      },
      steps,
      planPath: ".poe-code/pipeline/plans/plan-auth.yaml"
    });

    expect(prompt).toBe(
      "auth-hardening Harden auth flow\nImprove auth validation\nPlan: .poe-code/pipeline/plans/plan-auth.yaml"
    );
  });

  it("uses the task prompt directly for stepless tasks", () => {
    const prompt = buildExecutionPrompt({
      selection: {
        kind: "run",
        task: {
          id: "quick-fix",
          title: "Quick fix",
          prompt: "Fix the timeout regression",
          status: "open"
        }
      },
      steps,
      planPath: "ignored.yaml"
    });

    expect(prompt).toBe("Fix the timeout regression");
  });
});

describe("resolveFileIncludes", () => {
  const readFile = async (filePath: string): Promise<string> => {
    const files: Record<string, string> = {
      "/repo/docs/context.md": "# Context\nSome context here.",
      "/repo/notes.txt": "Important notes."
    };
    const content = files[filePath];
    if (content === undefined) throw new Error(`File not found: ${filePath}`);
    return content;
  };

  it("returns the template unchanged when there are no file includes", async () => {
    const result = await resolveFileIncludes("plain prompt text", "/repo", readFile);
    expect(result).toBe("plain prompt text");
  });

  it("replaces a single file include with file contents", async () => {
    const result = await resolveFileIncludes(
      "Preamble\n{{file 'docs/context.md'}}\nPostamble",
      "/repo",
      readFile
    );
    expect(result).toBe("Preamble\n# Context\nSome context here.\nPostamble");
  });

  it("supports double-quoted paths", async () => {
    const result = await resolveFileIncludes(
      '{{file "notes.txt"}}',
      "/repo",
      readFile
    );
    expect(result).toBe("Important notes.");
  });

  it("resolves paths relative to cwd", async () => {
    const result = await resolveFileIncludes(
      "{{file 'docs/context.md'}}",
      "/repo",
      readFile
    );
    expect(result).toBe("# Context\nSome context here.");
  });

  it("throws when the referenced file does not exist", async () => {
    await expect(
      resolveFileIncludes("{{file 'missing.md'}}", "/repo", readFile)
    ).rejects.toThrow("File not found: /repo/missing.md");
  });
});
