import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { resolve } from "./resolve.js";
import type { FileSystem } from "./types.js";

function createMemFs(files: Record<string, string> = {}): FileSystem {
  const volume = Volume.fromJSON(files);
  return createFsFromVolume(volume).promises as unknown as FileSystem;
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
          content: [
            "extends: true",
            "nested:",
            "  shared: document",
            "  onlyDocument: true"
          ].join("\n")
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
});
