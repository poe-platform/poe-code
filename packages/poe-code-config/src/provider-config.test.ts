import { createMockFs } from "@poe-code/config-mutations/testing";
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it } from "vitest";
import {
  loadProviderShapeBaseUrls,
  resolveServicesConfigPath,
  saveProviderShapeBaseUrls
} from "./index.js";

const homeDir = "/home/test";
const servicesConfigPath = resolveServicesConfigPath(homeDir);

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

describe("provider config", () => {
  it("treats a missing providers section as an empty map", async () => {
    const fs = createMockFs(undefined, homeDir);

    await expect(
      loadProviderShapeBaseUrls({
        fs,
        filePath: servicesConfigPath,
        providerId: "poe"
      })
    ).resolves.toEqual({});
  });

  it("saves shape base URLs under the provider entry", async () => {
    const fs = createMockFs(undefined, homeDir);

    await saveProviderShapeBaseUrls({
      fs,
      filePath: servicesConfigPath,
      providerId: "poe",
      shapeBaseUrls: {
        "anthropic-messages": "https://example/anth"
      }
    });

    expect(fs.getContent("~/.config/poe-code/services.json")).toMatchInlineSnapshot(`
      "{
        "providers": {
          "poe": {
            "shapeBaseUrls": {
              "anthropic-messages": "https://example/anth"
            }
          }
        }
      }
      "
    `);
  });

  it("merges new shape base URLs with existing provider config", async () => {
    const fs = createMockFs(
      {
        "~/.config/poe-code/services.json": `${JSON.stringify(
          {
            providers: {
              poe: {
                shapeBaseUrls: {
                  "anthropic-messages": "https://example/anth"
                }
              }
            }
          },
          null,
          2
        )}\n`
      },
      homeDir
    );

    await saveProviderShapeBaseUrls({
      fs,
      filePath: servicesConfigPath,
      providerId: "poe",
      shapeBaseUrls: {
        "openai-responses": "https://example/openai"
      }
    });

    await expect(
      loadProviderShapeBaseUrls({
        fs,
        filePath: servicesConfigPath,
        providerId: "poe"
      })
    ).resolves.toEqual({
      "anthropic-messages": "https://example/anth",
      "openai-responses": "https://example/openai"
    });
  });

  it("ignores inherited provider metadata while loading and saving", async () => {
    const fs = createMockFs(
      {
        "~/.config/poe-code/services.json": "{}\n"
      },
      homeDir
    );

    await withObjectPrototypeProperties(
      {
        providers: {
          poe: {
            shapeBaseUrls: {
              "openai-responses": "https://polluted.example/openai"
            }
          }
        }
      },
      async () => {
        await expect(
          loadProviderShapeBaseUrls({
            fs,
            filePath: servicesConfigPath,
            providerId: "poe"
          })
        ).resolves.toEqual({});

        await saveProviderShapeBaseUrls({
          fs,
          filePath: servicesConfigPath,
          providerId: "poe",
          shapeBaseUrls: {
            "anthropic-messages": "https://example/anth"
          }
        });
      }
    );

    expect(JSON.parse(fs.getContent("~/.config/poe-code/services.json") as string)).toEqual({
      providers: {
        poe: {
          shapeBaseUrls: {
            "anthropic-messages": "https://example/anth"
          }
        }
      }
    });
  });

  it("ignores inherited provider entries in an own providers scope", async () => {
    const fs = createMockFs(
      {
        "~/.config/poe-code/services.json": '{"providers":{}}\n'
      },
      homeDir
    );

    await withObjectPrototypeProperties(
      {
        poe: {
          shapeBaseUrls: {
            "openai-responses": "https://polluted.example/openai"
          }
        }
      },
      async () => {
        await expect(
          loadProviderShapeBaseUrls({
            fs,
            filePath: servicesConfigPath,
            providerId: "poe"
          })
        ).resolves.toEqual({});
      }
    );
  });

  it("does not recover invalid services config when loading in read-only mode", async () => {
    const fs = createMockFs(
      {
        "~/.config/poe-code/services.json": "{invalid json"
      },
      homeDir
    );

    await expect(
      loadProviderShapeBaseUrls({
        fs,
        filePath: servicesConfigPath,
        providerId: "cloudflare",
        readOnly: true
      })
    ).rejects.toThrow(SyntaxError);
    expect(fs.getContent("~/.config/poe-code/services.json")).toBe("{invalid json");
    await expect(fs.readdir("/home/test/.config/poe-code")).resolves.toEqual(["services.json"]);
  });

  it("rejects provider metadata reads through a symlinked services directory", async () => {
    const volume = new Volume();
    volume.mkdirSync(`${homeDir}/.config`, { recursive: true });
    volume.mkdirSync("/outside", { recursive: true });
    volume.symlinkSync("/outside", `${homeDir}/.config/poe-code`);
    volume.writeFileSync(
      "/outside/services.json",
      JSON.stringify({ providers: { cloudflare: { shapeBaseUrls: { "openai-responses": "https://outside" } } } })
    );
    const fs = createFsFromVolume(volume).promises as any;

    await expect(
      loadProviderShapeBaseUrls({
        fs,
        filePath: servicesConfigPath,
        providerId: "cloudflare"
      })
    ).rejects.toThrow("symbolic link");
  });
});
