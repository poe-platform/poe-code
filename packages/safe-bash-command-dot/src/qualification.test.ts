// Fast corpus: npm run test:unit --workspace=safe-bash-command-dot
// Fresh external comparisons: npm run test:native --workspace=safe-bash-command-dot
// GRAPHVIZ_DOT and GRAPHVIZ_SVGO override executable paths. Missing native tools
// are reported as skipped; deterministic corpus tests always run. Comparisons
// assert structure and geometry invariants, not identical font/layout metrics.
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import { parseXml, type XmlElement } from "@poe-code/xml-ast";
import sharp from "@poe-code/image-ast";
import { layoutGraph, parseDot, renderSvg, serializeDot } from "@poe-code/graphviz-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandDefinition } from "safe-bash-contracts";
import { createDotCommand } from "./index.js";
import { createNeatoCommand } from "safe-bash-command-neato";
import { createSvgoCommand } from "safe-bash-command-svgo";

const nested =
  Array.from({ length: 24 }, (_, i) => `subgraph cluster_${i} { n${i};`).join(" ") + "}".repeat(24);
const corpus = [
  { name: "nested clusters", source: `digraph { ${nested} }`, nodes: 24, edges: 0, clusters: 24 },
  {
    name: "loops and parallel cycles",
    source: "digraph { a -> a; a -> b; a -> b; b -> c -> a }",
    nodes: 3,
    edges: 5,
    clusters: 0
  },
  {
    name: "100 node SCC",
    source: `digraph { ${Array.from({ length: 100 }, (_, i) => `n${i} -> n${(i + 1) % 100}`).join(";")} }`,
    nodes: 100,
    edges: 100,
    clusters: 0
  },
  {
    name: "HTML tables",
    source:
      'digraph { a [label=<<TABLE><TR><TD>Hello</TD><TD>World</TD></TR><TR><TD COLSPAN="2">Table</TD></TR></TABLE>>]; a -> b }',
    nodes: 2,
    edges: 1,
    clusters: 0
  },
  {
    name: "nested record",
    source: 'digraph { a [shape=record,label="{a | {b | c} | d}"]; a -> z }',
    nodes: 2,
    edges: 1,
    clusters: 0
  },
  {
    name: "Unicode",
    source: 'digraph { "東京" [label="東京 café Ω 🚀"]; "東京" -> "مرحبا" }',
    nodes: 2,
    edges: 1,
    clusters: 0
  }
];
const malformed = [
  "digraph { a -> }",
  "digraph { a [label=] }",
  'digraph { a [label="unfinished] }',
  "digraph { a",
  "graph { a -> b }",
  "digraph { a -- b }"
];
const attr = (element: XmlElement, name: string) =>
  element.attributes.find((a) => a.name === name)?.value ?? "";
const descendants = (element: XmlElement): XmlElement[] => [
  element,
  ...element.children.flatMap(descendants)
];
const numbers = (s: string) =>
  s
    .trim()
    .split(/[\s,]+/u)
    .map(Number);
interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
function box(element: XmlElement): Box {
  if (element.name === "ellipse") {
    const x = Number(attr(element, "cx")),
      y = Number(attr(element, "cy"));
    return {
      left: x - Number(attr(element, "rx")),
      right: x + Number(attr(element, "rx")),
      top: y - Number(attr(element, "ry")),
      bottom: y + Number(attr(element, "ry"))
    };
  }
  if (element.name === "rect") {
    const left = Number(attr(element, "x")),
      top = Number(attr(element, "y"));
    return {
      left,
      top,
      right: left + Number(attr(element, "width")),
      bottom: top + Number(attr(element, "height"))
    };
  }
  expect(element.name).toBe("polygon");
  const points = numbers(attr(element, "points"));
  const xs = points.filter((_, i) => i % 2 === 0),
    ys = points.filter((_, i) => i % 2 === 1);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys)
  };
}
function contains(outer: Box, inner: Box): boolean {
  return (
    inner.left >= outer.left - 0.02 &&
    inner.top >= outer.top - 0.02 &&
    inner.right <= outer.right + 0.02 &&
    inner.bottom <= outer.bottom + 0.02
  );
}
function inspectSvg(source: string, cubic = true) {
  // Native Graphviz emits a fixed public DTD; parse only its SVG document, never resolve it.
  const root = parseXml(source.slice(source.indexOf("<svg")), { retainContent: true });
  const all = descendants(root),
    groups = (kind: string) => all.filter((e) => attr(e, "class") === kind);
  const view = numbers(attr(root, "viewBox"));
  expect(view).toHaveLength(4);
  expect(view.every(Number.isFinite)).toBe(true);
  expect(view[2]).toBeGreaterThan(0);
  expect(view[3]).toBeGreaterThan(0);
  const graph = groups("graph")[0]!;
  // Both renderers use points; native Graphviz flips Y in geometry and translates its graph group.
  const transform = attr(graph, "transform");
  const translation = transform.includes("translate(")
    ? numbers(transform.split("translate(")[1]!.split(")")[0]!)
    : [0, 0];
  const bounds: Box = {
    left: view[0]! - translation[0]!,
    top: view[1]! - translation[1]!,
    right: view[0]! + view[2]! - translation[0]!,
    bottom: view[1]! + view[3]! - translation[1]!
  };
  const frames = (kind: string) =>
    groups(kind).map((g) => ({
      id: g.children.find((e) => e.name === "title")!.text,
      box: box(g.children.find((e) => ["ellipse", "rect", "polygon"].includes(e.name))!)
    }));
  const nodes = frames("node"),
    clusters = frames("cluster");
  for (const frame of [...nodes, ...clusters])
    expect(contains(bounds, frame.box), frame.id).toBe(true);
  for (let i = 0; i < nodes.length; i++)
    for (const b of nodes.slice(i + 1)) {
      const a = nodes[i]!;
      expect(
        a.box.right <= b.box.left + 0.02 ||
          b.box.right <= a.box.left + 0.02 ||
          a.box.bottom <= b.box.top + 0.02 ||
          b.box.bottom <= a.box.top + 0.02,
        `${a.id} overlaps ${b.id}`
      ).toBe(true);
    }
  for (const group of groups("edge"))
    for (const path of group.children.filter((e) => e.name === "path")) {
      const d = attr(path, "d");
      const number = "[-+]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][-+]?[0-9]+)?";
      const pair = `${number}[ ,]+${number}`;
      expect(d).toMatch(
        new RegExp(
          `^M\\s*${pair}(?:\\s*C\\s*${pair}[ ,]+${pair}[ ,]+${pair}(?:[ ,]+${pair}[ ,]+${pair}[ ,]+${pair})*${cubic ? "" : `|\\s*L\\s*${pair}`})+$`,
          "u"
        )
      );

      const points = d.match(new RegExp(number, "gu"))!.map(Number);
      for (let i = 0; i < points.length; i += 2)
        expect(
          contains(bounds, {
            left: points[i]!,
            right: points[i]!,
            top: points[i + 1]!,
            bottom: points[i + 1]!
          })
        ).toBe(true);
    }
  return {
    nodes: nodes.map((n) => n.id).sort(),
    edges: groups("edge")
      .map((g) => g.children.find((e) => e.name === "title")!.text)
      .sort(),
    clusters,
    hierarchy: clusters
      .flatMap((parent) =>
        clusters
          .filter((child) => child !== parent && contains(parent.box, child.box))
          .map((child) => `${parent.id}/${child.id}`)
      )
      .sort()
  };
}
async function run(command: CommandDefinition, args: string[], source: string) {
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const result = await command.execute({
    command: command.name,
    args: createCommandArguments(args).args,
    cwd: "/",
    env: {},
    fs: createMemoryFileSystem(),
    stdin: toByteSource(source),
    stdout: {
      async write(bytes) {
        chunks.push(bytes.slice());
      }
    },
    stderr: {
      async write(bytes) {
        stderr += new TextDecoder().decode(bytes);
      }
    },
    signal: new AbortController().signal
  });
  const bytes = Buffer.concat(chunks);
  return { ...result, bytes, text: bytes.toString(), stderr };
}
const limits = { maxLayoutCost: 1_000_000_000 };
describe("Graphviz qualification corpus", () => {
  test.each(corpus)(
    "$name: AST roundtrip and SVG invariants",
    ({ source, nodes, edges, clusters }) => {
      const ast = parseDot(source);
      expect(parseDot(serializeDot(ast))).toEqual(ast);
      const geometry = layoutGraph(ast),
        result = inspectSvg(renderSvg(geometry));
      expect(result.nodes).toHaveLength(nodes);
      expect(result.edges).toHaveLength(edges);
      expect(result.clusters).toHaveLength(clusters);
      for (const child of geometry.clusters)
        if (child.parent) expect(result.hierarchy).toContain(`${child.parent}/${child.id}`);
    }
  );
  test.each(corpus)("$name: dot and neato commands", async ({ source, nodes, edges, clusters }) => {
    for (const command of [createDotCommand({ limits }), createNeatoCommand({ limits })]) {
      const result = await run(command, ["-Tsvg"], source);
      expect(result.exitCode, result.stderr).toBe(0);
      const svg = inspectSvg(result.text, command.name !== "neato");
      expect(svg.nodes).toHaveLength(nodes);
      expect(svg.edges).toHaveLength(edges);
      expect(svg.clusters).toHaveLength(clusters);
      if (clusters) expect(svg.hierarchy).toHaveLength((clusters * (clusters - 1)) / 2);
    }
  });
  test.each(corpus)("$name: SVGO preserves graph structure", async ({ source }) => {
    const svg = renderSvg(layoutGraph(parseDot(source)));
    const optimized = await run(createSvgoCommand(), ["-", "--multipass", "-p", "3"], svg);
    expect(optimized.exitCode, optimized.stderr).toBe(0);
    const expected = inspectSvg(svg),
      actual = inspectSvg(optimized.text);
    expect(actual).toEqual(expected);
  });
  test.each(["png", "jpg"])(
    "%s contains independently rendered labels and strokes",
    async (format) => {
      for (const source of [
        'digraph { bgcolor=white; a [shape=none,label="HELLO"]; }',
        'digraph { bgcolor=white; a [label=""]; }',
        'digraph { bgcolor=white; a [shape=box,label=""]; }',
        'digraph { bgcolor=white; node [shape=none,label=""]; a -> b; }'
      ]) {
        const result = await run(createDotCommand(), ["-T" + format], source);
        expect(result.exitCode, result.stderr).toBe(0);
        const stats = await sharp(result.bytes).stats();
        expect(stats.channels[0]!.min).toBeLessThan(100);
        expect(stats.channels[0]!.stdev).toBeGreaterThan(5);
      }
    }
  );
  test.each(malformed)("diagnoses %s without partial output", async (source) => {
    expect(() => parseDot(source)).toThrow(SyntaxError);
    for (const command of [createDotCommand(), createNeatoCommand()]) {
      const result = await run(command, ["-Tsvg"], source);
      expect(result.exitCode).toBe(1);
      expect(result.bytes.length).toBe(0);
      expect(result.stderr).toContain(command.name + ":");
      expect(result.stderr).toContain("offset");
    }
  });
  test("seeded graph fuzz preserves topology, bounds and parser roundtrips", () => {
    let seed = 1449;
    const random = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    for (let trial = 0; trial < 40; trial++) {
      const n = 3 + random(12),
        edges = Array.from({ length: 20 }, () => `n${random(n)} -> n${random(n)}`);
      const source = `digraph { rankdir=${["TB", "BT", "LR", "RL"][trial % 4]}; ${Array.from({ length: n }, (_, i) => `n${i}`).join(";")}; ${edges.join(";")} }`;
      const ast = parseDot(source);
      expect(parseDot(serializeDot(ast))).toEqual(ast);
      const svg = inspectSvg(renderSvg(layoutGraph(ast)));
      expect(svg.nodes).toHaveLength(n);
      expect(svg.edges).toHaveLength(20);
    }
  });
  test.each(["png", "jpg"])(
    "%s raster decodes with SVG dimensions and visible labels/strokes",
    async (format) => {
      for (const command of [createDotCommand(), createNeatoCommand()]) {
        const source = 'digraph { bgcolor=white; a [label="HELLO"]; a -> b }';
        const svg = await run(command, ["-Tsvg"], source),
          raster = await run(command, ["-T" + format], source);
        expect(raster.exitCode, raster.stderr).toBe(0);
        const expected = await sharp(svg.bytes).metadata(),
          actual = await sharp(raster.bytes).metadata();
        expect([actual.width, actual.height]).toEqual([expected.width, expected.height]);
        const stats = await sharp(raster.bytes).stats();
        expect(stats.channels[0]!.min).toBeLessThan(100);
        expect(stats.channels[0]!.max).toBeGreaterThan(240);
        expect(stats.channels[0]!.stdev).toBeGreaterThan(5);
      }
    }
  );
});

const nativeEnabled = process.env.GRAPHVIZ_NATIVE === "1";
const dot = process.env.GRAPHVIZ_DOT ?? "/opt/homebrew/bin/dot";
const svgo = process.env.GRAPHVIZ_SVGO ?? "svgo";
function available(binary: string, flag: string) {
  return nativeEnabled && spawnSync(binary, [flag], { timeout: 5000 }).status === 0;
}
function native(binary: string, args: string[], input: string): Buffer {
  const result = spawnSync(binary, args, { input, timeout: 10000, maxBuffer: 16 * 1024 * 1024 });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr?.toString()).toBe(0);
  return result.stdout;
}
describe.skipIf(!available(dot, "-V"))("native Graphviz differential (optional executable)", () => {
  test.each(corpus)("$name: structural SVG parity", async ({ source }) => {
    const expected = inspectSvg(native(dot, ["-Tsvg"], source).toString());
    const result = await run(createDotCommand({ limits }), ["-Tsvg"], source);
    expect(result.exitCode, result.stderr).toBe(0);
    const actual = inspectSvg(result.text);
    expect(actual.nodes).toEqual(expected.nodes);
    expect(actual.edges).toEqual(expected.edges);
    expect(actual.clusters.map((c) => c.id).sort()).toEqual(
      expected.clusters.map((c) => c.id).sort()
    );
    expect(actual.hierarchy).toEqual(expected.hierarchy);
  });
  test.each(corpus)("$name: native neato topology and geometry", async ({ source }) => {
    const expected = inspectSvg(
      native(dot, ["-Kneato", "-Goverlap=false", "-Gsplines=true", "-Tsvg"], source).toString()
    );
    const result = await run(createNeatoCommand({ limits }), ["-Tsvg"], source);
    expect(result.exitCode, result.stderr).toBe(0);
    const actual = inspectSvg(result.text, false);
    expect(actual.nodes).toEqual(expected.nodes);
    expect(actual.edges).toEqual(expected.edges);
  });
  test.each(malformed)("both reject malformed %s", async (source) => {
    const reference = spawnSync(dot, ["-Tsvg"], { input: source, timeout: 5000 });
    expect(reference.error).toBeUndefined();
    expect(reference.status).not.toBe(0);
    expect(reference.stderr.length).toBeGreaterThan(0);
    expect((await run(createDotCommand(), ["-Tsvg"], source)).exitCode).toBe(1);
  });
  test.each(["png", "jpg"])("native %s decodes and matches its SVG dimensions", async (format) => {
    const source = "digraph { bgcolor=white; a -> b }";
    // Layout/font metrics intentionally differ. Compare each raster to its own SVG at 72 DPI.
    const svg = native(dot, ["-Tsvg", "-Gdpi=72"], source),
      raster = native(dot, ["-T" + format, "-Gdpi=72"], source);
    const expected = await sharp(svg).metadata(),
      actual = await sharp(raster).metadata();
    expect(Math.abs(actual.width! - expected.width!)).toBeLessThanOrEqual(1);
    expect(Math.abs(actual.height! - expected.height!)).toBeLessThanOrEqual(1);
    expect((await sharp(raster).stats()).channels[0]!.stdev).toBeGreaterThan(5);
  });
});
describe.skipIf(!available(svgo, "--version"))(
  "native SVGO differential (optional executable)",
  () => {
    test("both optimizers retain rendered content and dimensions", async () => {
      const source =
        '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><!--remove--><metadata>remove</metadata><rect width="120" height="80" fill="white"/><path d="M10 10 L110 10 L110 70 L10 70 Z" fill="none" stroke="black"/><text x="30" y="40">Hello</text></svg>';
      const virtual = await run(createSvgoCommand(), ["-", "--multipass", "-p", "3"], source);
      expect(virtual.exitCode, virtual.stderr).toBe(0);
      const reference = native(svgo, ["-i", "-", "-o", "-", "--multipass", "-p", "3"], source);
      for (const output of [virtual.bytes, reference]) {
        expect(output.toString()).not.toContain("remove");
        expect(output.length).toBeLessThan(Buffer.byteLength(source));
        expect(await sharp(output).metadata()).toMatchObject({ width: 120, height: 80 });
        const before = await sharp(Buffer.from(source)).raw().toBuffer(),
          after = await sharp(output).raw().toBuffer();
        expect(after).toEqual(before);
      }
    });
  }
);
