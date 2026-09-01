import { createFsFromVolume, Volume } from "memfs";
import { parse, stringify } from "yaml";
import { describe, expect, it, vi } from "vitest";
import { runPipeline, type AgentRunInput, type PipelineRunOptions } from "./pipeline.js";

const planPath = "/repo/docs/plans/review.md";
const sourcePath = "/repo/src/code.js";
const include = "{{file 'src/code.js'}}";

function fixture(content: string, document: Record<string, unknown> = {}) {
  const source = `---\n${stringify({
    kind: "pipeline", version: 1,
    tasks: [{ id: "review", title: "Review", prompt: `Before\n${include}\nAfter`, status: "open" }],
    ...document
  })}---\nKeep this body.\n`;
  const fs = createFsFromVolume(Volume.fromJSON({ [planPath]: source, [sourcePath]: content })).promises;
  const runAgent = vi.fn(async (_input: AgentRunInput) => ({ stdout: "", stderr: "", exitCode: 0 }));
  const options: PipelineRunOptions = {
    cwd: "/repo", homeDir: "/home/fixture", plan: planPath, logDir: "/logs",
    agent: "fixture-agent", archive: false, fs, runAgent
  };
  return { fs, runAgent, options };
}

describe("public pipeline literal file includes", () => {
  it.each([
    'export const surround = value => value.replace(/word/g, "[$&]");',
    "$$", "$`", "$'", "$1 $<name>",
    "first\r\n日本語 🚀\r\n", "{{literal}} and {{file 'missing.js'}}", ""
  ])("passes source contents unchanged: %j", async (content) => {
    const state = fixture(content);
    await expect(runPipeline(state.options)).resolves.toMatchObject({ stopReason: "completed", runsCompleted: 1 });
    expect(state.runAgent.mock.calls.map(([input]) => input.prompt)).toEqual([`Before\n${content}\nAfter`]);
    await expect(state.fs.readFile(sourcePath, "utf8")).resolves.toBe(content);
  });

  it("expands original repeated directives rather than directives inserted from source", async () => {
    const content = `const literal = "${include}"; // $$ and $&`;
    const state = fixture(content, { tasks: [{ id: "review", title: "Review", prompt: `${include}\n${include}`, status: "open" }] });
    await expect(runPipeline(state.options)).resolves.toMatchObject({ stopReason: "completed" });
    expect(state.runAgent.mock.calls.map(([input]) => input.prompt)).toEqual([`${content}\n${content}`]);
    await expect(state.fs.readFile(sourcePath, "utf8")).resolves.toBe(content);
  });

  it.each([false, true])("preserves literal contents in every phase (variable=%s)", async (variable) => {
    const content = "const replacement = `$$ $& $'`;\r\n{{file 'src/second.txt'}}";
    const reference = variable ? "{{context}}" : include;
    const state = fixture(content, {
      ...(variable ? { vars: { context: include } } : {}),
      setup: { prompt: `Setup:\n${reference}` },
      teardown: { prompt: `Teardown:\n${reference}` },
      steps: { implement: { prompt: "Implement:\n{{prompt}}" }, verify: { prompt: "Verify:\n{{prompt}}" } },
      tasks: [{ id: "review", title: "Review", prompt: `Task:\n${reference}`, status: { implement: "open", verify: "open" } }]
    });
    await state.fs.writeFile("/repo/src/second.txt", "must remain a literal directive");
    await expect(runPipeline(state.options)).resolves.toMatchObject({ stopReason: "completed", runsCompleted: 2 });
    expect(state.runAgent.mock.calls.map(([input]) => input.prompt)).toEqual([
      `Setup:\n${content}`, `Implement:\nTask:\n${content}`, `Verify:\nTask:\n${content}`, `Teardown:\n${content}`
    ]);
    await expect(state.fs.readFile(sourcePath, "utf8")).resolves.toBe(content);
    const updated = String(await state.fs.readFile(planPath, "utf8"));
    expect(parse(updated.slice(4, updated.indexOf("\n---", 4)))).toMatchObject({ finalization: "completed" });
    expect(updated.endsWith("Keep this body.\n")).toBe(true);
  });

  it.each(["context", "context_doc"])("expands files once through the variable %s", async (key) => {
    const content = "Literal $$ and $& and {{not_a_variable}} and {{file 'src/second.txt'}}";
    const state = fixture(content, {
      vars: { [key]: key === "context_doc" ? "context.md" : `Source:\n${include}` },
      tasks: [{ id: "review", title: "Review", prompt: `{{${key}}}`, status: "open" }]
    });
    await state.fs.writeFile("/repo/context.md", `Source:\n${include}`);
    await state.fs.writeFile("/repo/src/second.txt", "must remain a literal directive");
    await expect(runPipeline(state.options)).resolves.toMatchObject({ stopReason: "completed" });
    expect(state.runAgent.mock.calls.map(([input]) => input.prompt)).toEqual([`Source:\n${content}`]);
  });
});
