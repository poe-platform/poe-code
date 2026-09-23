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
