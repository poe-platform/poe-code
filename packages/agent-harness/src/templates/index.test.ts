import { readFile } from "node:fs/promises";
import { dirname } from "node:path";

import { lint, makeAgentModule, run, splitFrontmatter } from "@poe-code/safe-js";
import { describe, expect, it, vi } from "vitest";

import * as api from "../index.js";
import { extractSchema } from "../loader/extract-schema.js";
import { validateFrontmatter } from "../loader/validate.js";
import { makeSchemaModule } from "../modules/schema.js";
import { listBuiltinTemplates } from "./index.js";

const lintModules = {
  agent: ["spawn"],
  log: ["event"],
  schema: ["S"]
};

describe("builtin harness templates", () => {
  it("is re-exported from the package entrypoint", () => {
    expect(api.listBuiltinTemplates).toBe(listBuiltinTemplates);
  });

  it("lists the five demo template pairs", () => {
    expect(listBuiltinTemplates().map((template) => template.kind)).toEqual([
      "ralph-demo",
      "coverage-demo",
      "experiment-demo",
      "pipeline-demo",
      "superintendent-demo"
    ]);
  });

  it.each(listBuiltinTemplates())(
    "$kind lints, validates its default frontmatter, and runs with a stub agent",
    async (template) => {
      const [ajsSource, mdSource] = await Promise.all([
        readFile(template.ajsPath, "utf8"),
        readFile(template.mdPath, "utf8")
      ]);
      const { frontmatter, body } = splitFrontmatter(mdSource);

      expect(
        lint(ajsSource, {
          allowedExportNames: ["schema"],
          filename: template.ajsPath,
          modules: lintModules
        })
      ).toEqual([]);

      const schema = await extractSchema(ajsSource, template.ajsPath);
      expect(schema).toBeDefined();

      const validated = validateFrontmatter(schema!, frontmatter, template.mdPath);
      expect(validated).toMatchObject({
        kind: template.kind,
        version: 1
      });

      const flow: string[] = [];
      const spawn = vi.fn(async () => ({
        durationMs: 1,
        exitCode: 0,
        stderr: "",
        stdout: "",
        summary: `stub summary ${spawn.mock.calls.length}`
      }));
      const event = vi.fn((name: string, payload: Record<string, unknown>) => {
        flow.push(
          `${name}:${String(payload.id ?? payload.attempt ?? payload.iteration ?? payload.round)}`
        );
      });
      spawn.mockImplementation(async (_agent, options: { prompt: string }) => {
        flow.push(`spawn:${options.prompt.split("\n", 1)[0]}`);
        return {
          durationMs: 1,
          exitCode: 0,
          stderr: "",
          stdout: "",
          summary: `stub summary ${spawn.mock.calls.length}`
        };
      });
      const result = await run(ajsSource, {
        entryPointArgs: [validated],
        filename: template.ajsPath,
        importMeta: {
          body,
          dirname: dirname(template.mdPath),
          filename: template.mdPath,
          kind: template.kind,
          version: 1
        },
        modules: {
          agent: { spawn },
          log: { event },
          schema: makeSchemaModule()
        }
      });

      expect(result).toMatchObject({
        ok: true
      });
      if (template.kind === "coverage-demo") {
        expect(spawn).not.toHaveBeenCalled();
      } else {
        expect(spawn).toHaveBeenCalled();
        expect(
          spawn.mock.calls.every(([, options]) => (options as { check?: boolean }).check === true)
        ).toBe(true);
      }
      expect(result.ok ? result.returnValue : undefined).toMatchObject({
        kind: template.kind
      });
      expect(flow).toEqual(expectedFlow[template.kind]);

      if (template.kind !== "coverage-demo") {
        const failedSpawn = vi.fn(async () => ({
          durationMs: 1,
          exitCode: 7,
          stderr: "child failed",
          stdout: "partial",
          summary: "partial"
        }));
        const completed = vi.fn();
        await expect(
          run(ajsSource, {
            entryPointArgs: [validated],
            importMeta: {
              body,
              dirname: dirname(template.mdPath),
              filename: template.mdPath,
              kind: template.kind,
              version: 1
            },
            modules: {
              agent: makeAgentModule(failedSpawn),
              log: { event: completed },
              schema: makeSchemaModule()
            }
          })
        ).rejects.toMatchObject({ message: expect.stringContaining("child failed") });
        expect(failedSpawn).toHaveBeenCalledOnce();
        expect(completed.mock.calls.some(([name]) => String(name).endsWith(".completed"))).toBe(
          false
        );
      }
    }
  );
});

const expectedFlow: Record<string, string[]> = {
  "coverage-demo": [],
  "ralph-demo": [
    "spawn:Improve the current repository state while preserving tests.",
    "iteration.completed:inspect",
    "spawn:Improve the current repository state while preserving tests.",
    "iteration.completed:improve"
  ],
  "experiment-demo": [
    "spawn:Make a conservative improvement attempt.",
    "attempt.kept:baseline",
    "spawn:Try one follow-up based on the previous attempt shape.",
    "attempt.kept:follow-up"
  ],
  "pipeline-demo": [
    "task.started:inspect-worktree",
    "spawn:inspect-worktree: Inspect worktree",
    "spawn:Review inspect-worktree",
    "task.completed:inspect-worktree",
    "task.started:review-diff",
    "spawn:review-diff: Review diff",
    "spawn:Review review-diff",
    "task.completed:review-diff"
  ],
  "superintendent-demo": [
    "spawn:Round 1: ",
    "spawn:Inspect round 1",
    "spawn:Inspect round 1",
    "spawn:Inspect round 1",
    "spawn:Judge round 1",
    "spawn:stub summary 5",
    "round.completed:1"
  ]
};
