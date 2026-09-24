import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  layoutMermaid,
  parseMermaid,
  renderMermaidPng,
  renderMermaidSvg,
  verifySceneGeometry
} from "./index.js";

export const CLASS_FIXTURES: Record<string, string> = {
  "class-compartments-visibility": `classDiagram
    class DiagramRenderer {
      <<interface>>
      +renderSvg(source: string) MermaidSvgResult
      +renderPng(source: string) MermaidPngResult
    }
    class DeterministicEngine {
      +string version
      #MermaidLimits defaultLimits
      -MermaidBudget activeBudget
      +parse(source: string) MermaidDocument
      +layout(doc: MermaidDocument) MermaidScene
      -verifyGeometry(scene: MermaidScene) boolean
    }
    DiagramRenderer <|.. DeterministicEngine : implements
  `,
  "class-inheritance-composition-multiplicity": `classDiagram
    class VirtualShell {
      +FileSystem fs
      +exec(command: string) Promise
      +use(plugin: VirtualShellPlugin) VirtualShell
    }
    class CommandRegistry {
      -Map commands
      +register(def: CommandDefinition) void
    }
    class MmdcCommand {
      +string name
      +execute(ctx: CommandContext) Promise
    }
    class ThemeTokens {
      +string canvas
      +string surface
      +string accent
    }
    VirtualShell "1" *-- "1" CommandRegistry : owns
    CommandRegistry "1" o-- "0..*" MmdcCommand : dispatches
    MmdcCommand --> ThemeTokens : resolves
  `,
  "class-namespaces": `classDiagram
    namespace SafeBashCore {
      class ShellHost {
        +string cwd
        +spawn(argv: string[]) number
      }
      class VfsMount {
        +string rootPath
        +readFile(path: string) Uint8Array
      }
    }
    namespace MmdcPlugin {
      class SceneSerializer {
        +serializeSvg(scene: MermaidScene) string
        +encodePng(scene: MermaidScene) Uint8Array
      }
    }
    ShellHost --> VfsMount : reads/writes
    ShellHost ..> SceneSerializer : invokes
  `
};

describe("classDiagram parser, layout, and geometry invariants", () => {
  for (const [source, startMarker, endMarker] of [
    ["Foo-->Bar", "none", "arrow"],
    ["Foo--Bar", "none", "none"],
    ["Repo-->Service", "none", "arrow"],
    ["Foo o--Bar", "umlAggregation", "none"],
    ['"Foo"o--Bar', "umlAggregation", "none"]
  ] as const) {
    it(`preserves endpoint identifiers and markers for ${source}`, () => {
      const doc = parseMermaid(`classDiagram\n${source}`);
      assert.deepEqual(doc.nodes.map(node => node.id), source.startsWith("Repo") ? ["Repo", "Service"] : ["Foo", "Bar"]);
      assert.equal(doc.edges.length, 1);
      assert.equal(doc.edges[0]!.startMarker, startMarker);
      assert.equal(doc.edges[0]!.endMarker, endMarker);
    });
  }

  for (const member of ["+parse(...args)", "+parse(a--b)", "+range: 0..10", "+flag: a--b"]) {
    it(`keeps relation tokens inside member ${member}`, () => {
      const doc = parseMermaid(`classDiagram\nParser : ${member}`);
      assert.deepEqual(doc.nodes.map(node => node.id), ["Parser"]);
      assert.equal(doc.edges.length, 0);
      const node = doc.nodes[0]!;
      assert.equal((member.includes("(") ? node.methods : node.attributes)!.length, 1);
      assert.equal(node.methods?.[0]?.name ?? node.attributes?.[0]?.typeOrReturn, member.includes("(") ? member.slice(1) : member.slice(member.indexOf(":") + 2));
    });
  }

  for (const declaration of ["class Foo { }", "class Foo{}", 'class Foo["Display { }"] { }', "class Foo <<interface>> { }"]) {
    it(`parses empty block ${declaration} without retaining block state`, () => {
      const doc = parseMermaid(`classDiagram\nnamespace Example {\n${declaration}\nclass Bar\n}\nFoo-->Bar : uses.. -- labels`);
      assert.deepEqual(doc.nodes.map(node => node.id), ["Foo", "Bar"]);
      assert.deepEqual(doc.nodes[0]!.methods, []);
      assert.equal(doc.nodes[0]!.groupId, "Example");
      assert.equal(doc.nodes[0]!.label, declaration.includes("Display") ? "Display { }" : "Foo");
      assert.equal(doc.nodes[0]!.stereotype, declaration.includes("interface") ? "interface" : undefined);
      assert.equal(doc.edges[0]!.label, "uses.. -- labels");
    });
  }

  for (const [name, source] of Object.entries(CLASS_FIXTURES)) {
    it(`parses, lays out, and satisfies all geometric invariants for ${name}`, () => {
      const doc = parseMermaid(source);
      assert.equal(doc.family, "class");
      for (const mode of ["light", "dark"] as const) {
        const scene = layoutMermaid(doc, { theme: mode });
        const check = verifySceneGeometry(scene);
        assert.equal(
          check.ok,
          true,
          `Geometry violations for ${name} (${mode}): ${check.violations.join("; ")}`
        );
        const svgRes = renderMermaidSvg(source, { theme: mode });
        assert.ok(svgRes.svg.includes("<svg"));
        const pngRes = renderMermaidPng(source, { theme: mode, scale: 2 });
        assert.ok(pngRes.png.byteLength > 100);
      }
    });
  }
});
