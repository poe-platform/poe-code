import { describe, expect, it } from "vitest";
import { mergeLayers } from "./merge.js";

describe("mergeLayers", () => {
  it("returns a single layer as-is and marks its source", () => {
    expect(
      mergeLayers([
        {
          source: "local",
          data: {
            title: "Hello",
            count: 2
          }
        }
      ])
    ).toEqual({
      data: {
        title: "Hello",
        count: 2
      },
      sources: {
        title: "local",
        count: "local"
      }
    });
  });

  it("keeps the first scalar when multiple layers define the same key", () => {
    expect(
      mergeLayers([
        {
          source: "first",
          data: {
            title: "First"
          }
        },
        {
          source: "second",
          data: {
            title: "Second"
          }
        }
      ])
    ).toEqual({
      data: {
        title: "First"
      },
      sources: {
        title: "first"
      }
    });
  });

  it("fills fields from later layers when the first layer is missing them", () => {
    expect(
      mergeLayers([
        {
          source: "first",
          data: {
            title: "First"
          }
        },
        {
          source: "second",
          data: {
            count: 2
          }
        }
      ])
    ).toEqual({
      data: {
        title: "First",
        count: 2
      },
      sources: {
        title: "first",
        count: "second"
      }
    });
  });

  it("ignores inherited values when a higher-priority layer is missing a key", () => {
    Object.defineProperty(Object.prototype, "title", {
      configurable: true,
      value: "Polluted"
    });

    try {
      expect(
        mergeLayers([
          {
            source: "first",
            data: {}
          },
          {
            source: "second",
            data: {
              title: "Second"
            }
          }
        ])
      ).toEqual({
        data: {
          title: "Second"
        },
        sources: {
          title: "second"
        }
      });
    } finally {
      delete (Object.prototype as Record<string, unknown>).title;
    }
  });

  it("treats null as defined and does not fall through", () => {
    expect(
      mergeLayers([
        {
          source: "first",
          data: {
            title: null
          }
        },
        {
          source: "second",
          data: {
            title: "Second"
          }
        }
      ])
    ).toEqual({
      data: {
        title: null
      },
      sources: {
        title: "first"
      }
    });
  });

  it("falls through undefined values", () => {
    expect(
      mergeLayers([
        {
          source: "first",
          data: {
            title: undefined
          }
        },
        {
          source: "second",
          data: {
            title: "Second"
          }
        }
      ])
    ).toEqual({
      data: {
        title: "Second"
      },
      sources: {
        title: "second"
      }
    });
  });

  it("keeps the first non-empty prompt", () => {
    expect(
      mergeLayers([
        {
          source: "first",
          data: {
            prompt: "Write something"
          }
        },
        {
          source: "second",
          data: {
            prompt: "Ignored"
          }
        }
      ])
    ).toEqual({
      data: {
        prompt: "Write something"
      },
      sources: {
        prompt: "first"
      }
    });
  });

  it("lets an empty prompt fall through to a later layer", () => {
    expect(
      mergeLayers([
        {
          source: "first",
          data: {
            prompt: ""
          }
        },
        {
          source: "second",
          data: {
            prompt: "Write something"
          }
        }
      ])
    ).toEqual({
      data: {
        prompt: "Write something"
      },
      sources: {
        prompt: "second"
      }
    });
  });

  it("tracks which layer each field came from", () => {
    expect(
      mergeLayers([
        {
          source: "base",
          data: {
            title: "Base"
          }
        },
        {
          source: "project",
          data: {
            count: 2,
            prompt: "Write something"
          }
        },
        {
          source: "local",
          data: {
            count: 3,
            title: "Local"
          }
        }
      ])
    ).toEqual({
      data: {
        title: "Base",
        count: 2,
        prompt: "Write something"
      },
      sources: {
        title: "base",
        count: "project",
        prompt: "project"
      }
    });
  });

  it("uses the correct priority across three layers", () => {
    expect(
      mergeLayers([
        {
          source: "first",
          data: {
            a: "first"
          }
        },
        {
          source: "second",
          data: {
            a: "second",
            b: "second"
          }
        },
        {
          source: "third",
          data: {
            a: "third",
            b: "third",
            c: "third"
          }
        }
      ])
    ).toEqual({
      data: {
        a: "first",
        b: "second",
        c: "third"
      },
      sources: {
        a: "first",
        b: "second",
        c: "third"
      }
    });
  });

  it("keeps the first defined array and does not merge arrays", () => {
    expect(
      mergeLayers([
        {
          source: "first",
          data: {
            items: ["a"]
          }
        },
        {
          source: "second",
          data: {
            items: ["b"]
          }
        }
      ])
    ).toEqual({
      data: {
        items: ["a"]
      },
      sources: {
        items: "first"
      }
    });
  });

  it("merges nested objects by filling gaps from later layers", () => {
    expect(
      mergeLayers([
        {
          source: "first",
          data: {
            a: {
              x: 1
            }
          }
        },
        {
          source: "second",
          data: {
            a: {
              y: 2
            }
          }
        }
      ])
    ).toEqual({
      data: {
        a: {
          x: 1,
          y: 2
        }
      },
      sources: {
        a: "first",
        "a.x": "first",
        "a.y": "second"
      }
    });
  });

  it("distinguishes literal dotted keys from nested provenance paths", () => {
    expect(
      mergeLayers([
        {
          source: "literal",
          data: {
            "service.url": "literal-value"
          }
        },
        {
          source: "nested",
          data: {
            service: {
              url: "nested-value"
            }
          }
        }
      ])
    ).toEqual({
      data: {
        "service.url": "literal-value",
        service: {
          url: "nested-value"
        }
      },
      sources: {
        "service\\.url": "literal",
        service: "nested",
        "service.url": "nested"
      }
    });
  });

  it("rejects cyclic object layers with a controlled error", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => mergeLayers([{ source: "runtime", data: { config: cyclic } }])).toThrow(
      "Cyclic config data is not supported."
    );
  });

  it("keeps the first nested value when both layers define the same nested key", () => {
    expect(
      mergeLayers([
        {
          source: "first",
          data: {
            a: {
              x: 1
            }
          }
        },
        {
          source: "second",
          data: {
            a: {
              x: 2,
              y: 3
            }
          }
        }
      ])
    ).toEqual({
      data: {
        a: {
          x: 1,
          y: 3
        }
      },
      sources: {
        a: "first",
        "a.x": "first",
        "a.y": "second"
      }
    });
  });

  it("keeps the first defined array inside nested objects", () => {
    expect(
      mergeLayers([
        {
          source: "first",
          data: {
            a: {
              items: ["a"]
            }
          }
        },
        {
          source: "second",
          data: {
            a: {
              items: ["b"],
              extra: true
            }
          }
        }
      ])
    ).toEqual({
      data: {
        a: {
          items: ["a"],
          extra: true
        }
      },
      sources: {
        a: "first",
        "a.items": "first",
        "a.extra": "second"
      }
    });
  });

  it("keeps the first defined value when types differ between non-object and object", () => {
    expect(
      mergeLayers([
        {
          source: "first",
          data: {
            a: "value"
          }
        },
        {
          source: "second",
          data: {
            a: {
              nested: true
            }
          }
        }
      ])
    ).toEqual({
      data: {
        a: "value"
      },
      sources: {
        a: "first"
      }
    });
  });

  it("returns empty data and sources when no layers are provided", () => {
    expect(mergeLayers([])).toEqual({
      data: {},
      sources: {}
    });
  });

  it("treats a null prompt as defined and does not fall through", () => {
    expect(
      mergeLayers([
        {
          source: "first",
          data: {
            prompt: null
          }
        },
        {
          source: "second",
          data: {
            prompt: "Write something"
          }
        }
      ])
    ).toEqual({
      data: {
        prompt: null
      },
      sources: {
        prompt: "first"
      }
    });
  });

  it("lets nested empty prompts fall through to later layers", () => {
    expect(
      mergeLayers([
        {
          source: "first",
          data: {
            a: {
              prompt: ""
            }
          }
        },
        {
          source: "second",
          data: {
            a: {
              prompt: "Write something"
            }
          }
        }
      ])
    ).toEqual({
      data: {
        a: {
          prompt: "Write something"
        }
      },
      sources: {
        a: "first",
        "a.prompt": "second"
      }
    });
  });

  it("preserves __proto__ as data without changing result prototypes", () => {
    const malicious = JSON.parse('{"__proto__":{"polluted":"yes"}}') as Record<string, unknown>;
    const result = mergeLayers([{ source: "document", data: malicious }]);

    expect(Object.hasOwn(result.data, "__proto__")).toBe(true);
    expect(result.data.__proto__).toEqual({ polluted: "yes" });
    expect((result.data as { polluted?: string }).polluted).toBeUndefined();
    expect(result.sources.__proto__).toBe("document");
    expect(Object.getPrototypeOf(result.sources)).toBe(Object.prototype);
  });
});
