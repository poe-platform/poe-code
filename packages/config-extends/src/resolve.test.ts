import { describe, expect, it } from "vitest";
import path from "node:path";
import { Volume, createFsFromVolume } from "memfs";
import { resolve } from "./resolve.js";
import type { FileSystem } from "./types.js";

function createMemFs(files: Record<string, string> = {}): FileSystem {
  const volume = Volume.fromJSON(files);
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

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

describe("resolve", () => {
  it("throws when the chain does not contain a document layer", async () => {
    const fs = createMemFs();

    await expect(
      resolve(
        [
          {
            source: "base",
            path: "/bases"
          },
          {
            source: "override",
            data: {
              title: "Override"
            }
          }
        ],
        { fs }
      )
    ).rejects.toThrow("Exactly one document layer is required, received 0.");
  });

  it("throws when the chain contains multiple document layers", async () => {
    const fs = createMemFs();

    await expect(
      resolve(
        [
          {
            source: "document-a",
            filePath: "/workspace/review-a.yaml",
            content: "title: A"
          },
          {
            source: "document-b",
            filePath: "/workspace/review-b.yaml",
            content: "title: B"
          }
        ],
        { fs }
      )
    ).rejects.toThrow("Exactly one document layer is required, received 2.");
  });

  it("deep merges document and data layers in chain order without extends", async () => {
    const fs = createMemFs();

    await expect(
      resolve(
        [
          {
            source: "override",
            data: {
              title: "Override",
              nested: {
                shared: "override",
                onlyOverride: true
              }
            }
          },
          {
            source: "document",
            filePath: "/workspace/review.yaml",
            content: [
              "title: Document",
              "nested:",
              "  shared: document",
              "  onlyDocument: true",
              "count: 2"
            ].join("\n")
          },
          {
            source: "fallback",
            data: {
              count: 99,
              nested: {
                onlyFallback: true
              },
              prompt: "Fallback prompt"
            }
          }
        ],
        { fs }
      )
    ).resolves.toEqual({
      data: {
        title: "Override",
        nested: {
          shared: "override",
          onlyOverride: true,
          onlyDocument: true,
          onlyFallback: true
        },
        count: 2,
        prompt: "Fallback prompt"
      },
      sources: {
        title: "override",
        nested: "override",
        "nested.shared": "override",
        "nested.onlyOverride": "override",
        "nested.onlyDocument": "document",
        "nested.onlyFallback": "fallback",
        count: "document",
        prompt: "fallback"
      },
      chain: ["/workspace/review.yaml"]
    });
  });

  it("ignores inherited prompt values during composition", async () => {
    const fs = createMemFs();

    await withObjectPrototypeProperty("prompt", "Polluted prompt", async () => {
      const result = await resolve(
        [
          {
            source: "document",
            filePath: "/workspace/review.yaml",
            content: "title: Document"
          }
        ],
        { fs }
      );

      expect(result.data).toEqual({ title: "Document" });
      expect(Object.hasOwn(result.sources, "prompt")).toBe(false);
    });
  });

  it("finds and merges a base when the document sets extends true", async () => {
    const fs = createMemFs({
      "/bases/review.yaml": ["prompt: Base prompt", "tone: base"].join("\n")
    });

    await expect(
      resolve(
        [
          {
            source: "document",
            filePath: "/workspace/review.yaml",
            content: ["extends: true", "title: Document"].join("\n")
          },
          {
            source: "base",
            path: "/bases"
          }
        ],
        { fs }
      )
    ).resolves.toMatchObject({
      data: {
        title: "Document",
        prompt: "Base prompt",
        tone: "base"
      },
      chain: ["/workspace/review.yaml", "/bases/review.yaml"]
    });
  });

  it("lets a data layer before the document override document fields", async () => {
    const fs = createMemFs();

    const result = await resolve(
      [
        {
          source: "override",
          data: {
            title: "Override"
          }
        },
        {
          source: "document",
          filePath: "/workspace/review.yaml",
          content: "title: Document"
        }
      ],
      { fs }
    );

    expect(result.data.title).toBe("Override");
    expect(result.sources.title).toBe("override");
  });

  it("lets document fields override data layers after the document", async () => {
    const fs = createMemFs();

    const result = await resolve(
      [
        {
          source: "document",
          filePath: "/workspace/review.yaml",
          content: "title: Document"
        },
        {
          source: "fallback",
          data: {
            title: "Fallback"
          }
        }
      ],
      { fs }
    );

    expect(result.data.title).toBe("Document");
    expect(result.sources.title).toBe("document");
  });

  it("fills document gaps from the resolved base", async () => {
    const fs = createMemFs({
      "/bases/review.yaml": "prompt: Base prompt"
    });

    const result = await resolve(
      [
        {
          source: "document",
          filePath: "/workspace/review.yaml",
          content: ["extends: true", "title: Document"].join("\n")
        },
        {
          source: "base",
          path: "/bases"
        }
      ],
      { fs }
    );

    expect(result.data).toEqual({
      title: "Document",
      prompt: "Base prompt"
    });
    expect(result.sources.prompt).toBe("base");
  });

  it("fills remaining gaps from data layers after the document", async () => {
    const fs = createMemFs({
      "/bases/review.yaml": ["prompt: Base prompt", "tone: base"].join("\n")
    });

    const result = await resolve(
      [
        {
          source: "document",
          filePath: "/workspace/review.yaml",
          content: ["extends: true", "title: Document"].join("\n")
        },
        {
          source: "base",
          path: "/bases"
        },
        {
          source: "fallback",
          data: {
            audience: "fallback",
            prompt: "ignored"
          }
        }
      ],
      { fs }
    );

    expect(result.data).toEqual({
      title: "Document",
      prompt: "Base prompt",
      tone: "base",
      audience: "fallback"
    });
    expect(result.sources.audience).toBe("fallback");
  });

  it("deep merges nested objects across override, document, base, and fallback layers", async () => {
    const fs = createMemFs({
      "/bases/review.yaml": [
        "nested:",
        "  fromBase: true",
        "  shared: base",
        "  onlyBase: true"
      ].join("\n")
    });

    const result = await resolve(
      [
        {
          source: "override",
          data: {
            nested: {
              shared: "override",
              onlyOverride: true
            }
          }
        },
        {
          source: "document",
          filePath: "/workspace/review.yaml",
          content: ["extends: true", "nested:", "  shared: document", "  onlyDocument: true"].join(
            "\n"
          )
        },
        {
          source: "base",
          path: "/bases"
        },
        {
          source: "fallback",
          data: {
            nested: {
              onlyFallback: true,
              shared: "fallback"
            }
          }
        }
      ],
      { fs }
    );

    expect(result.data).toEqual({
      nested: {
        shared: "override",
        onlyOverride: true,
        onlyDocument: true,
        fromBase: true,
        onlyBase: true,
        onlyFallback: true
      }
    });
  });

  it("auto-resolves a base when autoExtend is enabled and extends is missing", async () => {
    const fs = createMemFs({
      "/bases/review.md": "---\nprompt: Base prompt\n---\nBase body"
    });

    const result = await resolve(
      [
        {
          source: "document",
          filePath: "/workspace/review.yaml",
          content: "title: Document"
        },
        {
          source: "base",
          path: "/bases"
        }
      ],
      {
        fs,
        autoExtend: true
      }
    );

    expect(result.data).toEqual({
      title: "Document",
      prompt: "Base body"
    });
    expect(result.chain).toEqual(["/workspace/review.yaml", "/bases/review.md"]);
  });

  it("returns the document as-is when autoExtend is enabled and no base matches", async () => {
    const fs = createMemFs();

    await expect(
      resolve(
        [
          {
            source: "document",
            filePath: "/workspace/review.yaml",
            content: "title: Document"
          },
          {
            source: "base",
            path: "/bases"
          }
        ],
        {
          fs,
          autoExtend: true
        }
      )
    ).resolves.toEqual({
      data: {
        title: "Document"
      },
      sources: {
        title: "document"
      },
      chain: ["/workspace/review.yaml"]
    });
  });

  it("returns the document as-is when optional autoExtend discovers the document itself", async () => {
    const fs = createMemFs({
      "/workspace/review.yaml": "title: Document"
    });

    await expect(
      resolve(
        [
          {
            source: "document",
            filePath: "/workspace/review.yaml",
            content: "title: Document"
          },
          {
            source: "base",
            path: "/workspace"
          }
        ],
        {
          fs,
          autoExtend: true
        }
      )
    ).resolves.toEqual({
      data: {
        title: "Document"
      },
      sources: {
        title: "document"
      },
      chain: ["/workspace/review.yaml"]
    });
  });

  it("does not merge an absolute on-disk self match for a relative document path", async () => {
    const relativePath = "workspace/review.yaml";
    const absolutePath = path.resolve(relativePath);
    const fs = createMemFs({
      [absolutePath]: "title: Stale\nstale: true"
    });

    await expect(
      resolve(
        [
          {
            source: "document",
            filePath: relativePath,
            content: "title: Edited"
          },
          {
            source: "base",
            path: path.dirname(absolutePath)
          }
        ],
        {
          fs,
          autoExtend: true
        }
      )
    ).resolves.toEqual({
      data: {
        title: "Edited"
      },
      sources: {
        title: "document"
      },
      chain: [relativePath]
    });
  });

  it("does not auto-resolve when the document explicitly disables extends", async () => {
    const fs = createMemFs({
      "/bases/review.yaml": "prompt: Base prompt"
    });

    await expect(
      resolve(
        [
          {
            source: "document",
            filePath: "/workspace/review.yaml",
            content: ["extends: false", "title: Document"].join("\n")
          },
          {
            source: "base",
            path: "/bases"
          }
        ],
        {
          fs,
          autoExtend: true
        }
      )
    ).resolves.toEqual({
      data: {
        title: "Document"
      },
      sources: {
        title: "document"
      },
      chain: ["/workspace/review.yaml"]
    });
  });

  it("resolves chained bases in order", async () => {
    const fs = createMemFs({
      "/base-a/review.yaml": ["extends: true", "tone: A"].join("\n"),
      "/base-b/review.yaml": ["extends: true", "audience: B"].join("\n"),
      "/base-c/review.md": "---\nstyle: C\n---\nBase body"
    });

    const result = await resolve(
      [
        {
          source: "document",
          filePath: "/workspace/review.yaml",
          content: ["extends: true", "title: Document"].join("\n")
        },
        {
          source: "base-a",
          path: "/base-a"
        },
        {
          source: "base-b",
          path: "/base-b"
        },
        {
          source: "base-c",
          path: "/base-c"
        }
      ],
      { fs }
    );

    expect(result.data).toEqual({
      title: "Document",
      tone: "A",
      audience: "B",
      style: "C",
      prompt: "Base body"
    });
    expect(result.chain).toEqual([
      "/workspace/review.yaml",
      "/base-a/review.yaml",
      "/base-b/review.yaml",
      "/base-c/review.md"
    ]);
  });

  it("throws when the extends depth limit is exceeded", async () => {
    const fs = createMemFs({
      "/base-1/review.yaml": "extends: true\nlevel: 1",
      "/base-2/review.yaml": "extends: true\nlevel: 2",
      "/base-3/review.yaml": "extends: true\nlevel: 3",
      "/base-4/review.yaml": "extends: true\nlevel: 4",
      "/base-5/review.yaml": "extends: true\nlevel: 5",
      "/base-6/review.yaml": "level: 6"
    });

    await expect(
      resolve(
        [
          {
            source: "document",
            filePath: "/workspace/review.yaml",
            content: "extends: true"
          },
          {
            source: "base-1",
            path: "/base-1"
          },
          {
            source: "base-2",
            path: "/base-2"
          },
          {
            source: "base-3",
            path: "/base-3"
          },
          {
            source: "base-4",
            path: "/base-4"
          },
          {
            source: "base-5",
            path: "/base-5"
          },
          {
            source: "base-6",
            path: "/base-6"
          }
        ],
        { fs }
      )
    ).rejects.toThrow("Maximum extends depth exceeded");
  });

  it("throws when a circular base reference is detected", async () => {
    const fs = createMemFs({
      "/base-a/review.yaml": "extends: true\nlevel: A",
      "/base-b/review.yaml": "extends: true\nlevel: B"
    });

    await expect(
      resolve(
        [
          {
            source: "document",
            filePath: "/workspace/review.yaml",
            content: "extends: true"
          },
          {
            source: "base-a",
            path: "/base-a"
          },
          {
            source: "base-b",
            path: "/base-b"
          },
          {
            source: "base-a-again",
            path: "/base-a"
          }
        ],
        { fs }
      )
    ).rejects.toThrow("Circular extends detected");
  });

  it("includes checked paths when extends true cannot find a matching base", async () => {
    const fs = createMemFs();

    await expect(
      resolve(
        [
          {
            source: "document",
            filePath: "/workspace/review.yaml",
            content: "extends: true"
          },
          {
            source: "base-a",
            path: "/base-a"
          },
          {
            source: "base-b",
            path: "/base-b"
          }
        ],
        { fs }
      )
    ).rejects.toThrowError(
      [
        'Base "review" not found.',
        "Checked paths:",
        "- /base-a/review.md",
        "- /base-a/review.yaml",
        "- /base-a/review.yml",
        "- /base-a/review.json",
        "- /base-b/review.md",
        "- /base-b/review.yaml",
        "- /base-b/review.yml",
        "- /base-b/review.json"
      ].join("\n")
    );
  });

  it("supports a YAML document extending a markdown base", async () => {
    const fs = createMemFs({
      "/bases/review.md": "---\ndescription: From markdown\n---\nMarkdown prompt"
    });

    const result = await resolve(
      [
        {
          source: "document",
          filePath: "/workspace/review.yaml",
          content: ["extends: true", "title: YAML document"].join("\n")
        },
        {
          source: "base",
          path: "/bases"
        }
      ],
      { fs }
    );

    expect(result.data).toEqual({
      title: "YAML document",
      description: "From markdown",
      prompt: "Markdown prompt"
    });
  });

  it("resolves a base directory with a trailing separator", async () => {
    const fs = createMemFs({
      "/bases/review.yaml": "tone: base"
    });

    const result = await resolve(
      [
        {
          source: "document",
          filePath: "/project/review.yaml",
          content: "extends: true\ntitle: Document"
        },
        {
          source: "base",
          path: "/bases/"
        }
      ],
      { fs }
    );

    expect(result.data).toEqual({ title: "Document", tone: "base" });
  });

  it("supports a JSON document extending a YAML base", async () => {
    const fs = createMemFs({
      "/bases/review.yaml": ["tone: YAML base", "count: 2"].join("\n")
    });

    const result = await resolve(
      [
        {
          source: "document",
          filePath: "/workspace/review.json",
          content: JSON.stringify({
            extends: true,
            title: "JSON document"
          })
        },
        {
          source: "base",
          path: "/bases"
        }
      ],
      { fs }
    );

    expect(result.data).toEqual({
      title: "JSON document",
      tone: "YAML base",
      count: 2
    });
  });

  it("lets a base prompt wrap a markdown child body with {{yield}}", async () => {
    const fs = createMemFs({
      "/bases/review.md": [
        "---",
        "agent: codex",
        "---",
        "Read {{url}} and make the smallest safe change.",
        "",
        "{{yield}}",
        "",
        "Always explain what changed."
      ].join("\n")
    });

    const result = await resolve(
      [
        {
          source: "document",
          filePath: "/workspace/review.md",
          content: [
            "---",
            "extends: true",
            "---",
            "Focus on test coverage and edge cases in {{repo}}."
          ].join("\n")
        },
        {
          source: "base",
          path: "/bases"
        }
      ],
      { fs }
    );

    expect(result.data).toEqual({
      agent: "codex",
      prompt: [
        "Read {{url}} and make the smallest safe change.",
        "",
        "Focus on test coverage and edge cases in {{repo}}.",
        "",
        "Always explain what changed."
      ].join("\n")
    });
    expect(result.sources.prompt).toBe("document");
  });

  it("lets a child prompt wrap an inherited base prompt with {{yield}}", async () => {
    const fs = createMemFs({
      "/bases/review.md": "Fix the issue described in {{url}}."
    });

    const result = await resolve(
      [
        {
          source: "document",
          filePath: "/workspace/review.md",
          content: [
            "---",
            "extends: true",
            "---",
            "Repository policy:",
            "- keep changes small",
            "- avoid unrelated refactors",
            "",
            "{{yield}}"
          ].join("\n")
        },
        {
          source: "base",
          path: "/bases"
        }
      ],
      { fs }
    );

    expect(result.data.prompt).toBe(
      [
        "Repository policy:",
        "- keep changes small",
        "- avoid unrelated refactors",
        "",
        "Fix the issue described in {{url}}."
      ].join("\n")
    );
    expect(result.sources.prompt).toBe("document");
  });

  it("nests chained layouts while keeping one final template", async () => {
    const fs = createMemFs({
      "/base-a/review.md": ["---", "extends: true", "---", "Base A intro", "", "{{yield}}"].join(
        "\n"
      ),
      "/base-b/review.md": [
        "---",
        "extends: true",
        "---",
        "Base B intro",
        "",
        "{{yield}}",
        "",
        "Base B outro"
      ].join("\n"),
      "/base-c/review.md": "Read {{url}}."
    });

    const result = await resolve(
      [
        {
          source: "document",
          filePath: "/workspace/review.md",
          content: ["---", "extends: true", "---", "Focus on {{repo}}."].join("\n")
        },
        {
          source: "base-a",
          path: "/base-a"
        },
        {
          source: "base-b",
          path: "/base-b"
        },
        {
          source: "base-c",
          path: "/base-c"
        }
      ],
      { fs }
    );

    expect(result.data.prompt).toBe(
      ["Base B intro", "", "Base A intro", "", "Focus on {{repo}}.", "", "Base B outro"].join("\n")
    );
    expect(result.sources.prompt).toBe("document");
  });

  it("replaces {{yield}} with an empty string when the child markdown body is empty", async () => {
    const fs = createMemFs({
      "/bases/review.md": [
        "---",
        "agent: codex",
        "---",
        "Read {{url}}.",
        "",
        "{{yield}}",
        "",
        "Always explain what changed."
      ].join("\n")
    });

    const result = await resolve(
      [
        {
          source: "document",
          filePath: "/workspace/review.md",
          content: ["---", "extends: true", "agent: claude-code", "---"].join("\n")
        },
        {
          source: "base",
          path: "/bases"
        }
      ],
      { fs }
    );

    expect(result.data).toEqual({
      agent: "claude-code",
      prompt: "Read {{url}}.\n\n\n\nAlways explain what changed."
    });
    expect(result.sources.prompt).toBe("base");
  });

  it("lets data layers before the document override the composed prompt", async () => {
    const fs = createMemFs({
      "/bases/review.md": ["Read {{url}}.", "", "{{yield}}"].join("\n")
    });

    const result = await resolve(
      [
        {
          source: "override",
          data: {
            prompt: "Override prompt"
          }
        },
        {
          source: "document",
          filePath: "/workspace/review.md",
          content: ["---", "extends: true", "---", "Focus on {{repo}}."].join("\n")
        },
        {
          source: "base",
          path: "/bases"
        }
      ],
      { fs }
    );

    expect(result.data.prompt).toBe("Override prompt");
    expect(result.sources.prompt).toBe("override");
  });

  it("composes normalized prompt fields from YAML and JSON documents", async () => {
    const fs = createMemFs({
      "/bases/review.json": JSON.stringify({
        prompt: "Read {{url}}."
      })
    });

    const result = await resolve(
      [
        {
          source: "document",
          filePath: "/workspace/review.yaml",
          content: ["extends: true", 'prompt: "Focus on {{repo}}.\\n\\n{{yield}}"'].join("\n")
        },
        {
          source: "base",
          path: "/bases"
        }
      ],
      { fs }
    );

    expect(result.data.prompt).toBe(["Focus on {{repo}}.", "", "Read {{url}}."].join("\n"));
    expect(result.sources.prompt).toBe("document");
  });

  it("throws when a prompt contains more than one {{yield}} token", async () => {
    const fs = createMemFs({
      "/bases/review.md": ["First", "{{yield}}", "Second", "{{yield}}"].join("\n")
    });

    await expect(
      resolve(
        [
          {
            source: "document",
            filePath: "/workspace/review.md",
            content: ["---", "extends: true", "---", "Child body"].join("\n")
          },
          {
            source: "base",
            path: "/bases"
          }
        ],
        { fs }
      )
    ).rejects.toThrow('Prompt composition supports exactly one "{{yield}}" token per prompt.');
  });

  it("throws when the final resolved prompt still contains an unresolved {{yield}}", async () => {
    const fs = createMemFs();

    await expect(
      resolve(
        [
          {
            source: "document",
            filePath: "/workspace/review.yaml",
            content: ['prompt: "Before\\n\\n{{yield}}"'].join("\n")
          }
        ],
        { fs }
      )
    ).rejects.toThrow('Final resolved prompt contains an unresolved "{{yield}}" token.');
  });

  it("tracks the correct source for each resolved field", async () => {
    const fs = createMemFs({
      "/bases/review.yaml": ["prompt: Base prompt", "tone: Base tone"].join("\n")
    });

    const result = await resolve(
      [
        {
          source: "override",
          data: {
            title: "Override"
          }
        },
        {
          source: "document",
          filePath: "/workspace/review.yaml",
          content: ["extends: true", "description: From document"].join("\n")
        },
        {
          source: "base",
          path: "/bases"
        },
        {
          source: "fallback",
          data: {
            count: 2,
            tone: "Fallback tone"
          }
        }
      ],
      { fs }
    );

    expect(result.sources).toEqual({
      title: "override",
      description: "document",
      prompt: "base",
      tone: "base",
      count: "fallback"
    });
  });

  it("lists resolved file paths in the final chain", async () => {
    const fs = createMemFs({
      "/base-a/review.yaml": "extends: true\ntone: A",
      "/base-b/review.md": "---\nstyle: B\n---\nBody"
    });

    const result = await resolve(
      [
        {
          source: "document",
          filePath: "/workspace/review.yaml",
          content: "extends: true"
        },
        {
          source: "base-a",
          path: "/base-a"
        },
        {
          source: "base-b",
          path: "/base-b"
        }
      ],
      { fs }
    );

    expect(result.chain).toEqual([
      "/workspace/review.yaml",
      "/base-a/review.yaml",
      "/base-b/review.md"
    ]);
  });

  it("returns the resolved document shape expected by resolveDocument-style callers", async () => {
    const fs = createMemFs({
      "/bases/review.yaml": ["prompt: Base prompt", "count: 1"].join("\n")
    });

    await expect(
      resolve(
        [
          {
            source: "override",
            data: {
              title: "Override"
            }
          },
          {
            source: "document",
            filePath: "/workspace/review.yaml",
            content: "extends: true"
          },
          {
            source: "base",
            path: "/bases"
          },
          {
            source: "fallback",
            data: {
              audience: "Fallback"
            }
          }
        ],
        { fs }
      )
    ).resolves.toEqual({
      data: {
        title: "Override",
        prompt: "Base prompt",
        count: 1,
        audience: "Fallback"
      },
      sources: {
        title: "override",
        prompt: "base",
        count: "base",
        audience: "fallback"
      },
      chain: ["/workspace/review.yaml", "/bases/review.yaml"]
    });
  });

  it("uses baseName to find the base when the document has a different filename", async () => {
    const fs = createMemFs({
      "/bases/review.yaml": ["prompt: Base prompt", "tone: base"].join("\n")
    });

    await expect(
      resolve(
        [
          {
            source: "document",
            filePath: "/workspace/poe-code-review.yaml",
            content: ["extends: true", "title: Document"].join("\n"),
            baseName: "review"
          },
          {
            source: "base",
            path: "/bases"
          }
        ],
        { fs }
      )
    ).resolves.toMatchObject({
      data: {
        title: "Document",
        prompt: "Base prompt",
        tone: "base"
      },
      chain: ["/workspace/poe-code-review.yaml", "/bases/review.yaml"]
    });
  });

  it("resolves markdown partials and reports every source file", async () => {
    const fs = createMemFs({
      "/workspace/evidence-rules.md": "Evidence for {{company}}.\n{{> output-contract}}",
      "/workspace/output-contract.md": "Return Markdown.",
      "/bases/review.md": "Base instructions.\n\n{{yield}}\n\n{{> shared-style}}",
      "/bases/shared-style.md": "Be concise."
    });

    await expect(
      resolve(
        [
          {
            source: "document",
            filePath: "/workspace/review.md",
            content: "---\nextends: true\n---\n{{> evidence-rules}}\n\nAnalyze {{company}}."
          },
          { source: "base", path: "/bases" }
        ],
        { fs, view: { company: "Poe" }, validate: true }
      )
    ).resolves.toEqual({
      data: {
        prompt: [
          "Base instructions.",
          "",
          "Evidence for Poe.",
          "Return Markdown.",
          "Analyze Poe.",
          "",
          "Be concise."
        ].join("\n")
      },
      sources: { prompt: "document" },
      chain: [
        "/workspace/review.md",
        "/bases/review.md",
        "/workspace/evidence-rules.md",
        "/workspace/output-contract.md",
        "/bases/shared-style.md"
      ]
    });
  });

  it("fails when a markdown partial does not exist", async () => {
    const fs = createMemFs();

    await expect(
      resolve(
        [{ source: "document", filePath: "/workspace/review.md", content: "{{> missing}}" }],
        { fs }
      )
    ).rejects.toThrow('Partial "missing" not found.');
  });

  it("does not treat inherited partial read error codes as missing partials", async () => {
    const raw = createMemFs();
    const fs: FileSystem = {
      readFile: async (filePath, encoding) => {
        if (filePath === "/workspace/rules.md") {
          throw new Error("partial read denied");
        }

        return raw.readFile(filePath, encoding);
      }
    };

    await withObjectPrototypeProperty("code", "ENOENT", async () => {
      await expect(
        resolve(
          [{ source: "document", filePath: "/workspace/review.md", content: "{{> rules}}" }],
          { fs }
        )
      ).rejects.toThrow("partial read denied");
    });
  });

  it("lets document partials override inherited partials", async () => {
    const fs = createMemFs({
      "/workspace/rules.md": "Project rules.",
      "/bases/review.md": "{{> rules}}\n\n{{yield}}",
      "/bases/rules.md": "Base rules."
    });

    await expect(
      resolve(
        [
          {
            source: "document",
            filePath: "/workspace/review.md",
            content: "---\nextends: true\n---\nReview."
          },
          { source: "base", path: "/bases" }
        ],
        { fs }
      )
    ).resolves.toMatchObject({
      data: { prompt: "Project rules.\nReview." },
      chain: ["/workspace/review.md", "/bases/review.md", "/workspace/rules.md"]
    });
  });

  it("composes inheritance when yield is inside a markdown partial", async () => {
    const fs = createMemFs({
      "/bases/review.md": "{{> layout}}",
      "/bases/layout.md": "Before\n\n{{yield}}\n\nAfter"
    });

    await expect(
      resolve(
        [
          {
            source: "document",
            filePath: "/workspace/review.md",
            content: "---\nextends: true\n---\nChild"
          },
          { source: "base", path: "/bases" }
        ],
        { fs }
      )
    ).resolves.toMatchObject({
      data: { prompt: "Before\n\nChild\n\nAfter" },
      chain: ["/workspace/review.md", "/bases/review.md", "/bases/layout.md"]
    });
  });

  it("rejects markdown partial names that escape prompt directories", async () => {
    const fs = createMemFs({
      "/secret.md": "secret"
    });

    await expect(
      resolve(
        [{ source: "document", filePath: "/workspace/review.md", content: "{{> ../secret}}" }],
        { fs }
      )
    ).rejects.toThrow('Partial name must remain inside prompt directories: "../secret".');
  });

  it("fails on circular markdown partial references", async () => {
    const fs = createMemFs({
      "/workspace/one.md": "{{> two}}",
      "/workspace/two.md": "{{> one}}"
    });

    await expect(
      resolve([{ source: "document", filePath: "/workspace/review.md", content: "{{> one}}" }], {
        fs
      })
    ).rejects.toThrow("Circular partial reference detected: one -> two -> one.");
  });

  it("validates variables across resolved prompts before execution", async () => {
    const fs = createMemFs({
      "/workspace/rules.md": "Rules for {{company}}"
    });

    await expect(
      resolve([{ source: "document", filePath: "/workspace/review.md", content: "{{> rules}}" }], {
        fs,
        validate: true
      })
    ).rejects.toThrow('Template variable "company" not found.');
  });
});
