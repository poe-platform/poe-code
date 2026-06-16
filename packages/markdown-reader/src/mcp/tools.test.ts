import { createMCPServer } from "toolcraft/mcp";
import { describe, expect, it } from "vitest";
import { McpClient, createSdkTestPair } from "tiny-mcp-client";
import { toJsonSchema } from "toolcraft-schema";
import { markdownGroup } from "./group.js";
import { readSectionTool, readTool } from "./tools.js";

const EXPECTED_TOOL_NAMES = ["read", "read_section"];
const FIXTURE_PATH = "packages/markdown-reader/src/testing/fixtures/with-frontmatter.md";

async function createClientPair() {
  const server = createMCPServer(markdownGroup, {
    name: "markdown-reader",
    version: "0.0.1",
    omitRootToolNamePrefix: true
  });

  return createSdkTestPair(server, () =>
    new McpClient({
      clientInfo: {
        name: "test-client",
        version: "1.0.0"
      }
    })
  );
}

describe("markdown-reader MCP tools", () => {
  it("advertises schemas that match core validation boundaries", () => {
    expect(toJsonSchema(readTool.params)).toMatchObject({
      properties: {
        file: { type: "string", minLength: 1 },
        depth: { type: "integer", minimum: 0 }
      }
    });
    expect(toJsonSchema(readSectionTool.params)).toMatchObject({
      properties: {
        file: { type: "string", minLength: 1 },
        section: { type: "string", minLength: 1 }
      }
    });
  });

  it("lists exactly the markdown reader tools and reads a markdown file", async () => {
    const { client, cleanup } = await createClientPair();

    try {
      const tools = await client.listTools();

      expect(tools.tools.map((tool) => tool.name)).toEqual(EXPECTED_TOOL_NAMES);

      const result = await client.callTool({
        name: "read",
        arguments: {
          file: FIXTURE_PATH
        }
      });

      expect(result.isError).not.toBe(true);
      expect(result.content).toEqual([
        {
          type: "text",
          text: expect.any(String)
        }
      ]);
      expect(JSON.parse(result.content[0]!.text)).toEqual({
        file: FIXTURE_PATH,
        frontmatter: {
          owner: "docs",
          tags: ["alpha", "beta"],
          title: "Frontmatter Example"
        },
        sections: [
          {
            depth: 1,
            number: null,
            title: "Frontmatter Title"
          },
          {
            depth: 2,
            number: "1",
            title: "Details"
          }
        ]
      });
    } finally {
      await cleanup();
    }
  });
});
