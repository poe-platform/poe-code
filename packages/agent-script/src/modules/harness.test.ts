import { describe, expect, it } from "vitest";

import { makeHarnessModule } from "./harness.js";

describe("makeHarnessModule", () => {
  it("exposes harness frontmatter data and metadata as deep-copied pure data", () => {
    const frontmatter = {
      agents: {
        planner: {
          agent: "codex",
          model: "openai/gpt-5.4"
        }
      },
      tasks: [
        {
          id: "plan",
          steps: ["inspect", "patch"]
        }
      ],
      limits: {
        rounds: 3
      }
    };
    const module = makeHarnessModule(frontmatter, {
      filepath: "/repo/docs/plans/test.md",
      kind: "pipeline",
      version: 1
    });

    expect(module).toEqual({
      agents: {
        planner: {
          agent: "codex",
          model: "openai/gpt-5.4"
        }
      },
      meta: {
        filepath: "/repo/docs/plans/test.md",
        frontmatter: {
          agents: {
            planner: {
              agent: "codex",
              model: "openai/gpt-5.4"
            }
          },
          limits: {
            rounds: 3
          },
          tasks: [
            {
              id: "plan",
              steps: ["inspect", "patch"]
            }
          ]
        },
        kind: "pipeline",
        version: 1
      },
      tasks: [
        {
          id: "plan",
          steps: ["inspect", "patch"]
        }
      ]
    });

    frontmatter.agents.planner.model = "changed";
    frontmatter.tasks[0]?.steps.push("mutated");
    frontmatter.limits.rounds = 9;

    expect(module.agents).toEqual({
      planner: {
        agent: "codex",
        model: "openai/gpt-5.4"
      }
    });
    expect(module.tasks).toEqual([
      {
        id: "plan",
        steps: ["inspect", "patch"]
      }
    ]);
    expect(module.meta.frontmatter).toEqual({
      agents: {
        planner: {
          agent: "codex",
          model: "openai/gpt-5.4"
        }
      },
      limits: {
        rounds: 3
      },
      tasks: [
        {
          id: "plan",
          steps: ["inspect", "patch"]
        }
      ]
    });
  });

  it("exposes undefined tasks and agents when the frontmatter omits them", () => {
    expect(
      makeHarnessModule(
        {
          title: "Untitled"
        },
        {
          filepath: "/repo/docs/plans/untitled.md",
          kind: "experiment",
          version: "2026-04-29"
        }
      )
    ).toEqual({
      agents: undefined,
      meta: {
        filepath: "/repo/docs/plans/untitled.md",
        frontmatter: {
          title: "Untitled"
        },
        kind: "experiment",
        version: "2026-04-29"
      },
      tasks: undefined
    });
  });

  it("preserves own __proto__ data without mutating copied object prototypes", () => {
    const frontmatter = {
      tasks: {
        safe: true
      }
    } as Record<string, unknown>;

    Object.defineProperty(frontmatter, "__proto__", {
      enumerable: true,
      value: {
        polluted: true
      }
    });

    const module = makeHarnessModule(frontmatter, {
      filepath: "/repo/docs/plans/proto.md",
      kind: {
        mode: "test"
      },
      version: {
        major: 1
      }
    });

    expect(Object.hasOwn(module.meta.frontmatter, "__proto__")).toBe(true);
    expect(module.meta.frontmatter.__proto__).toEqual({
      polluted: true
    });
    expect(Object.getPrototypeOf(module.meta.frontmatter)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("deep-copies structured meta values independently from the source input", () => {
    const kind = {
      name: "pipeline"
    };
    const version = [1, 0] as number[];
    const module = makeHarnessModule(
      {
        tasks: []
      },
      {
        filepath: "/repo/docs/plans/meta.md",
        kind,
        version
      }
    );

    kind.name = "changed";
    version.push(1);

    expect(module.meta.kind).toEqual({
      name: "pipeline"
    });
    expect(module.meta.version).toEqual([1, 0]);
  });

  it("rejects non-data values from frontmatter or metadata", () => {
    expect(() =>
      makeHarnessModule(
        {
          tasks: [() => "nope"]
        },
        {
          filepath: "/repo/docs/plans/invalid-frontmatter.md",
          kind: "pipeline",
          version: 1
        }
      )
    ).toThrow("Unsupported sandbox value at <root>.tasks[0]: function");

    expect(() =>
      makeHarnessModule(
        {
          tasks: []
        },
        {
          filepath: "/repo/docs/plans/invalid-meta.md",
          kind: new Date("2026-04-29T00:00:00Z"),
          version: 1
        }
      )
    ).toThrow("Unsupported sandbox value at <root>: Date");
  });
});
