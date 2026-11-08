# Graphviz AST

Parse DOT graphs, calculate layered layouts, and render deterministic SVG without
a Graphviz executable, DOM, network access, or runtime dependencies. This private
package supplies the graph engine for safe-bash Graphviz commands.

| API                                | Use                                                                                |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `parseDot(source)`                 | Read directed/undirected DOT, clusters, defaults, chains, ports and HTML label IDs |
| `serializeDot(graph)`              | Write an editable DOT AST back to DOT                                              |
| `layoutGraph(graph, options?)`     | Resolve graph semantics and calculate nodes, clusters, edge paths and bounds       |
| `renderSvg(layout)`                | Render graph geometry and labels as SVG                                            |
| `optimizeSvg(svg, { precision? })` | Strip comments/metadata, round geometry, compact paths and flatten empty groups    |

```ts
import { parseDot, layoutGraph, renderSvg, optimizeSvg } from "@poe-code/graphviz-ast";

const graph = parseDot(`digraph workflow {
  rankdir=LR;
  node [shape=box, style=rounded];
  subgraph cluster_build { label="Build"; compile -> test; }
  test -> publish;
}`);
const geometry = layoutGraph(graph);
const svg = optimizeSvg(renderSvg(geometry), { precision: 2 });
```

`layoutGraph` accepts `{ graph, node, edge }` attribute overrides. Dimensions and
coordinates in its result are points (72 points per inch), with the origin at
the top left. Nodes contain centers, dimensions, ranks, resolved attributes and
record port centers. Edges preserve their original direction, expose the cycle
removal flag, routing points, an SVG path and a label position. Clusters contain
bounding rectangles and member IDs. The result is JSON-serializable.

Layouts support `TB`, `BT`, `LR`, `RL`, rank groups, node/rank separation, margins,
padding, cubic splines, orthogonal routes, polylines, straight lines and hidden
edges. Supported shapes include rectangles, ellipses, circles, double circles,
diamonds, plaintext, records, rounded records, cylinders, folders, components,
notes and tabs. Font advances are estimated deterministically; installed fonts
do not affect geometry. HTML label markup is retained in the AST and its text
content is rendered safely. Records retain field dividers and port locations.

The engine implements Sugiyama layout with greedy feedback-arc cycle removal,
longest-path feasible ranks and network-simplex tightening, dummy vertices,
barycenter/median and transpose crossing sweeps, and four-way Brandes–Köpf block
alignment. Its geometry is deterministic, but is not intended to be byte-identical
to native Graphviz. Invalid DOT/XML throws `SyntaxError`; nesting is bounded at
256 levels. SVG optimization preserves meaningful groups, IDs, transforms,
namespaces and text. It is an optimizer, not an untrusted SVG sanitizer.
