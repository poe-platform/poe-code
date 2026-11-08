import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure dot & neato Graphviz AST layout, SVG/PDF/raster & multi-tool pipelines", () => {
  it("1. renders layered digraph with nested clusters, HTML table labels, and C-style comments to SVG and optimizes via svgo", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/arch.dot": `
          /* Multi-tier service topology */
          digraph Architecture {
            rankdir=LR;
            bgcolor="#fafafa";
            label="Platform Topology";
            // Frontend cluster
            subgraph cluster_edge {
              label="Edge Tier";
              style="filled,dashed";
              fillcolor="#e8f4f8";
              gw [shape=component, label=<<table><tr><td>API &amp; Gateway</td></tr><tr><td>v2.4&#33;</td></tr></table>>];
              auth [shape=note, label="OAuth2\\nVerifier"];
              gw -> auth [label="verify", penwidth=2];
            }
            subgraph cluster_core {
              label="Core Data";
              subgraph cluster_storage {
                label="Shards";
                db1 [shape=cylinder, style=filled, fillcolor="#fff3cd", label="Primary\\N"];
                db2 [shape=folder, label="Replica"];
              }
              cache [shape=tab, label="Redis"];
            }
            gw -> cache [style=dotted, color="#0066cc"];
            gw -> db1 [weight=3, minlen=2];
            db1 -> db2 [dir=both, arrowsize=1.2];
          }
        `,
      },
    });
    const res = await h.exec(`
      set -euo pipefail
      dot -Tsvg /workspace/arch.dot -o /workspace/arch.svg
      svgo -i /workspace/arch.svg -o /workspace/arch.min.svg
      grep -q '<svg' /workspace/arch.min.svg
      grep -q 'API &amp; Gateway' /workspace/arch.svg
      grep -q 'v2.4!' /workspace/arch.svg
      grep -q 'Primarydb1' /workspace/arch.svg
      grep -q 'Platform Topology' /workspace/arch.svg
      echo "OK"
    `);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout.trim(), "OK");
  });

  it("2. computes record and Mrecord port geometry with compass attachments in JSON format and queries with jq", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/records.dot": `
          digraph Records {
            node [shape=record, fontname="Courier-Mono", fontsize=12];
            r1 [label="<h>Header|{<f0>left|<f1>mid|<f2>right}|<t>Footer"];
            r2 [shape=Mrecord, label="{<in>Ingress|{Stage A|<out>Egress}}"];
            r1:f0:s -> r2:in:n [label="pipe-0"];
            r1:f2:e -> r2:out:w [label="bypass", style=dashed];
            r1:h:c -> r1:t:c [label="self-port"];
          }
        `,
      },
    });
    const res = await h.exec(`
      set -euo pipefail
      dot -Tjson /workspace/records.dot | jq -c '{
        id: .id,
        directed: .directed,
        nodes: [.nodes[] | {id, shape: .attributes.shape, ports: (.ports | keys | sort)}],
        edges: [.edges[] | {from: .tail.id, fromPort: .tail.port, fromCompass: .tail.compass, to: .head.id, toPort: .head.port, toCompass: .head.compass}]
      }'
    `);
    assert.equal(res.exitCode, 0, res.stderr);
    const parsed = JSON.parse(res.stdout.trim());
    assert.equal(parsed.id, "Records");
    assert.equal(parsed.directed, true);
    assert.deepEqual(parsed.nodes, [
      { id: "r1", shape: "record", ports: ["f0", "f1", "f2", "h", "t"] },
      { id: "r2", shape: "Mrecord", ports: ["in", "out"] },
    ]);
    assert.equal(parsed.edges.length, 3);
    assert.deepEqual(parsed.edges[0], {
      from: "r1",
      fromPort: "f0",
      fromCompass: "s",
      to: "r2",
      toPort: "in",
      toCompass: "n",
    });
  });

  it("3. round-trips canonical DOT (-Tcanon) and positioned DOT (-Tdot) preserving attributes and bounding box", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(`
      set -euo pipefail
      cat <<'DOT' | dot -Grankdir=BT -Nshape=box -Ecolor=red -Tcanon > /workspace/canon.dot
digraph "My Graph" {
  "node a" + "1" [label="Alpha\\nOne"];
  "node a1" -> b_2 [weight=2];
}
DOT
      dot -Tdot /workspace/canon.dot > /workspace/positioned.dot
      grep -Fq 'graph ["rankdir"="BT"];' /workspace/canon.dot
      grep -Fq 'node ["shape"="box"];' /workspace/canon.dot
      grep -Fq 'edge ["color"="red"];' /workspace/canon.dot
      grep -Fq 'graph ["bb"="0,0,' /workspace/positioned.dot
      grep -Fq '"pos"="' /workspace/positioned.dot
      dot -Tjson /workspace/positioned.dot | jq -r '.nodes | length'
    `);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout.trim(), "2");
  });

  it("4. executes neato spring layout on strict undirected graphs with parallel edge deduplication and self-loops", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/mesh.dot": `
          strict graph Mesh {
            subgraph cluster_ring {
              label="Ring";
              n1 -- n2 -- n3 -- n4 -- n1 [color=blue];
            }
            n1 -- n2 [color=green, label="merged"];
            n2 -- n1 [weight=5];
            n3 -- n3 [label="loop"];
          }
        `,
      },
    });
    const res = await h.exec(`
      set -euo pipefail
      neato -Tjson /workspace/mesh.dot > /workspace/neato.json
      dot -Kneato -Tjson /workspace/mesh.dot > /workspace/dot_kneato.json
      cmp -s /workspace/neato.json /workspace/dot_kneato.json
      jq -c '{
        directed: .directed,
        strict: .strict,
        nodeCount: (.nodes | length),
        edgeCount: (.edges | length),
        mergedEdge: (.edges[] | select((.tail.id == "n1" and .head.id == "n2") or (.tail.id == "n2" and .head.id == "n1")) | .attributes)
      }' /workspace/neato.json
    `);
    assert.equal(res.exitCode, 0, res.stderr);
    const info = JSON.parse(res.stdout.trim());
    assert.equal(info.directed, false);
    assert.equal(info.strict, true);
    assert.equal(info.nodeCount, 4);
    assert.equal(info.edgeCount, 5);
    assert.equal(info.mergedEdge.color, "green");
    assert.equal(info.mergedEdge.label, "merged");
    assert.equal(info.mergedEdge.weight, "5");
  });

  it("5. renders DOT and neato graphs directly to PDF and inspects text and visual diffs with pdfinfo, pdftotext, and diffpdf", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/v1.dot": `
          digraph ReleaseFlow {
            build [label="Build Artifact"];
            test [label="Run Suite"];
            publish [label="Publish Package"];
            build -> test -> publish [label="pass"];
          }
        `,
        "/workspace/v2.dot": `
          digraph ReleaseFlow {
            build [label="Build Artifact"];
            test [label="Run Suite"];
            publish [label="Rollback Package"];
            build -> test -> publish [label="fail"];
          }
        `,
      },
    });
    const res = await h.exec(`
      set -euo pipefail
      dot -Tpdf /workspace/v1.dot -o /workspace/v1.pdf
      dot -Tpdf /workspace/v1.dot -o /workspace/v1_copy.pdf
      dot -Tpdf /workspace/v2.dot -o /workspace/v2.pdf
      pdfinfo /workspace/v1.pdf | grep -Eq "Pages:[[:space:]]+1"
      pdftotext /workspace/v1.pdf - | grep -q "Build Artifact"
      pdftotext /workspace/v1.pdf - | grep -q "Publish Package"
      diffpdf /workspace/v1.pdf /workspace/v1_copy.pdf
      if diffpdf /workspace/v1.pdf /workspace/v2.pdf >/dev/null; then
        echo "Expected PDFs to differ" >&2
        exit 1
      fi
      echo "PDF_OK"
    `);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout.trim(), "PDF_OK");
  });

  it("6. renders PNG, JPEG, and WebP raster images from DOT and validates metadata via identify, exiftool, and magick", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/g.dot": `
          digraph Raster {
            pad="0.2,0.2";
            margin="0.1,0.1";
            a [shape=diamond, label="Decision"];
            b [shape=circle, label="OK"];
            c [shape=doublecircle, label="Done"];
            a -> b -> c;
          }
        `,
      },
    });
    const res = await h.exec(`
      set -euo pipefail
      dot -Tpng /workspace/g.dot -o /workspace/g.png
      dot -Tjpg /workspace/g.dot -o /workspace/g.jpg
      dot -Tjpeg /workspace/g.dot -o /workspace/g.jpeg
      dot -Twebp /workspace/g.dot -o /workspace/g.webp
      cmp -s /workspace/g.jpg /workspace/g.jpeg
      identify /workspace/g.png | grep -q "PNG "
      identify /workspace/g.jpg | grep -q "JPEG "
      identify /workspace/g.webp | grep -q "WEBP "
      exiftool -s3 -FileType /workspace/g.png
      exiftool -s3 -FileType /workspace/g.jpg
      exiftool -s3 -FileType /workspace/g.webp
    `);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.deepEqual(res.stdout.trim().split("\n"), ["PNG", "JPEG", "WEBP"]);
  });

  it("7. supports plain output format (-Tplain) and parses coordinates and edge control points with awk", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(`
      set -euo pipefail
      cat <<'DOT' | dot -Tplain > /workspace/out.plain
digraph PlainCheck {
  rankdir=TB;
  alpha [label="Alpha Node", shape=box, style=filled, color=navy, fillcolor= ivory];
  beta [label="Beta Node", shape=ellipse];
  alpha -> beta [label="hop", style=dashed, color=crimson];
}
DOT
      awk '
        NR == 1 && $1 == "graph" { has_graph = ($2 == 1 && $3 > 0 && $4 > 0) }
        $1 == "node" { nodes++ }
        $1 == "edge" { edges++; pts = $4 }
        $1 == "stop" { stopped = 1 }
        END {
          if (has_graph && nodes == 2 && edges == 1 && pts >= 2 && stopped) print "PLAIN_VALID";
          else print "PLAIN_BAD";
        }
      ' /workspace/out.plain
      grep -q '"Alpha Node" "filled" "box" "navy" "ivory"' /workspace/out.plain
      grep -q '"hop"' /workspace/out.plain
    `);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout.trim(), "PLAIN_VALID");
  });

  it("8. handles splines=ortho, splines=line, splines=none, and splines=spline with parallel edges and same-rank edges", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/base.dot": `
          digraph Splines {
            { rank=same; a; b; }
            a -> b [label="same1"];
            a -> b [label="same2"];
            a -> c [label="down1"];
            a -> c [label="down2"];
            c -> c [label="self1"];
            c -> c [label="self2"];
          }
        `,
      },
    });
    const res = await h.exec(`
      set -euo pipefail
      dot -Gsplines=ortho -Tjson /workspace/base.dot | jq -r '.edges[2].path' > /workspace/ortho.path
      dot -Gsplines=line -Tjson /workspace/base.dot | jq -r '.edges[2].path' > /workspace/line.path
      dot -Gsplines=none -Tjson /workspace/base.dot | jq -r '.edges[2].path' > /workspace/none.path
      dot -Gsplines=spline -Tjson /workspace/base.dot | jq -r '.edges[2].path' > /workspace/spline.path
      grep -q '^M.*L' /workspace/ortho.path
      grep -q '^M.*L' /workspace/line.path
      test ! -s /workspace/none.path || test "$(cat /workspace/none.path)" = ""
      grep -q '^M.*C' /workspace/spline.path
      echo "SPLINES_OK"
    `);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout.trim(), "SPLINES_OK");
  });

  it("9. enforces rank=min, rank=source, rank=max, rank=sink, rank=same, and constraint=false feedback arcs", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/ranks.dot": `
          digraph Ranks {
            mid1 -> mid2 [minlen=2];
            mid2 -> mid1 [constraint=false, label="feedback"];
            { rank=source; src; }
            { rank=sink; snk; }
            { rank=same; mid2; peer2; }
            isolated;
          }
        `,
      },
    });
    const res = await h.exec(`
      set -euo pipefail
      dot -Tjson /workspace/ranks.dot | jq -c '
        (.nodes | map({(.id): .rank}) | add) as $r |
        {
          srcIsMin: ($r.src == 0),
          midOrder: ($r.mid1 < $r.mid2),
          sameRank: ($r.mid2 == $r.peer2),
          snkIsMax: ($r.snk > $r.mid2 and $r.snk > $r.isolated),
          feedbackReversed: (.edges[] | select(.attributes.label == "feedback") | .reversed)
        }
      '
    `);
    assert.equal(res.exitCode, 0, res.stderr);
    const out = JSON.parse(res.stdout.trim());
    assert.deepEqual(out, {
      srcIsMin: true,
      midOrder: true,
      sameRank: true,
      snkIsMax: true,
      feedbackReversed: true,
    });
  });

  it("10. expands subgraph-to-subgraph Cartesian product edges and semicolon/comma attribute lists", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(`
      set -euo pipefail
      cat <<'DOT' | dot -Tjson | jq -c '{nodes: (.nodes | length), edges: [.edges[] | "\\(.tail.id)->\\(.head.id):\\(.attributes.style):\\(.attributes.weight)"]}'
digraph SubCartesian {
  edge [style=dashed; weight=4, color=purple]
  { a; b } -> { c; d } [weight=9]
}
DOT
    `);
    assert.equal(res.exitCode, 0, res.stderr);
    const out = JSON.parse(res.stdout.trim());
    assert.equal(out.nodes, 4);
    assert.deepEqual(out.edges, [
      "a->c:dashed:9",
      "a->d:dashed:9",
      "b->c:dashed:9",
      "b->d:dashed:9",
    ]);
  });

  it("11. renders all specialized node shapes and edge arrow directions and styles to SVG and converts via rsvg-convert", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/shapes.dot": `
          digraph Shapes {
            n_plain [shape=plaintext, label="PlainText"];
            n_none [shape=none, label="NoneShape"];
            n_ell [shape=ellipse, label="Ellipse"];
            n_oval [shape=oval, label="Oval"];
            n_circ [shape=circle, fixedsize=true, width=0.9, height=0.6, label="C"];
            n_dcirc [shape=doublecircle, label="DC"];
            n_dia [shape=diamond, label="Dia"];
            n_cyl [shape=cylinder, label="Cyl"];
            n_fold [shape=folder, label="Fold"];
            n_tab [shape=tab, label="Tab"];
            n_note [shape=note, label="Note"];
            n_comp [shape=component, label="Comp"];
            n_box [shape=box, style="rounded,filled", fillcolor="#ddeeff", label="RoundedBox"];
            n_invis [style=invis, label="HiddenNode"];
            n_plain -> n_none [dir=both, arrowsize=1.5];
            n_none -> n_ell [dir=back, arrowtail=normal];
            n_ell -> n_oval [dir=none];
            n_oval -> n_circ [arrowhead=none];
            n_circ -> n_dcirc -> n_dia -> n_cyl -> n_fold -> n_tab -> n_note -> n_comp -> n_box;
            n_box -> n_invis [style=invis];
          }
        `,
      },
    });
    const res = await h.exec(`
      set -euo pipefail
      dot -Tsvg /workspace/shapes.dot -o /workspace/shapes.svg
      grep -q 'HiddenNode' /workspace/shapes.svg && exit 1 || true
      grep -q 'rx="8"' /workspace/shapes.svg
      rsvg-convert -f pdf /workspace/shapes.svg -o /workspace/shapes.pdf
      pdftotext /workspace/shapes.pdf - | grep -q "RoundedBox"
      echo "SHAPES_OK"
    `);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout.trim(), "SHAPES_OK");
  });

  it("12. supports rankdir=LR, RL, BT, TB coordinate transforms and font/margin sizing", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/dir.dot": `
          digraph Dir {
            a [label="Start", fontname="Arial-Helvetica", fontsize=16];
            b [label="End", fontname="Times-Roman", fontsize=10];
            a -> b;
          }
        `,
      },
    });
    const res = await h.exec(`
      set -euo pipefail
      tb=$(dot -Grankdir=TB -Tjson /workspace/dir.dot | jq -c '(.nodes[0].y < .nodes[1].y) and (.nodes[0].x == .nodes[1].x)')
      bt=$(dot -Grankdir=BT -Tjson /workspace/dir.dot | jq -c '(.nodes[0].y > .nodes[1].y) and (.nodes[0].x == .nodes[1].x)')
      lr=$(dot -Grankdir=LR -Tjson /workspace/dir.dot | jq -c '(.nodes[0].x < .nodes[1].x) and (.nodes[0].y == .nodes[1].y)')
      rl=$(dot -Grankdir=RL -Tjson /workspace/dir.dot | jq -c '(.nodes[0].x > .nodes[1].x) and (.nodes[0].y == .nodes[1].y)')
      echo "$tb $bt $lr $rl"
    `);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout.trim(), "true true true true");
  });

  it("13. handles CLI flags -V, --help, -?, separated -T / -K / -o / -G / -N / -E arguments, and multiple file inputs", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/g1.dot": "digraph G1 { a -> b; }\n",
        "/workspace/g2.dot": "digraph G2 { c -> d; }\n",
      },
    });
    const res = await h.exec(`
      set -euo pipefail
      dot --help | grep -q "Usage: dot"
      neato -? | grep -q "Usage: neato"
      dot -V 2>&1 | grep -q "dot (Safe Bash Graphviz) 0.0.1"
      neato -V 2>&1 | grep -q "neato (Safe Bash Graphviz) 0.0.1"
      dot -T canon -K dot -G rankdir=LR -N shape=box -E style=dotted -o /workspace/multi.dot -- /workspace/g1.dot /workspace/g2.dot
      grep -c '^digraph ' /workspace/multi.dot
    `);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout.trim(), "2");
  });

  it("14. decodes numeric hex/decimal HTML entities and line-break tags (<br/>, </tr>, </td>) in HTML labels", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(`
      set -euo pipefail
      cat <<'DOT' | dot -Tsvg > /workspace/entities.svg
digraph Entities {
  n1 [label=<<table><tr><td>Col1</td><td>Col2</td></tr><tr><td>&#65;&#x42;&nbsp;&apos;&quot;&lt;&gt;&amp;</td><td>Line1<br/>Line2</td></tr></table>>];
}
DOT
      xq -r '.svg.g.g.text | map(."#text") | join("|")' /workspace/entities.svg
    `);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout.trim(), `Col1 Col2|AB '"<>& Line1|Line2`);
  });

  it("15. minimizes crossings on bipartite/layered graphs and aligns Brandes-Kopf coordinates without node overlap", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/layered.dot": `
          digraph Layered {
            nodesep=0.4;
            ranksep=0.6;
            a1 -> b2;
            a2 -> b1;
            a1 -> b1;
            a2 -> b2;
            b1 -> c1;
            b2 -> c2;
            a1 -> c2 [minlen=2];
          }
        `,
      },
    });
    const res = await h.exec(`
      set -euo pipefail
      dot -Tjson /workspace/layered.dot | jq -c '
        [
          .nodes as $ns |
          range(0; $ns | length) as $i |
          range($i + 1; $ns | length) as $j |
          select($ns[$i].rank == $ns[$j].rank) |
          (($ns[$i].x - $ns[$j].x | fabs) >= (($ns[$i].width + $ns[$j].width) / 2))
        ] | all
      '
    `);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout.trim(), "true");
  });

  it("16. propagates nested cluster bounding boxes in both dot layered layout and neato spring layout", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/nested_clusters.dot": `
          digraph Clusters {
            subgraph cluster_outer {
              label="Outer";
              margin=12;
              o1 [label="OuterNode"];
              subgraph cluster_inner {
                label="Inner";
                margin=10;
                i1 [label="Inner1"];
                i2 [label="Inner2"];
                i1 -> i2;
              }
              o1 -> i1;
            }
          }
        `,
      },
    });
    const res = await h.exec(`
      set -euo pipefail
      for eng in dot neato; do
        $eng -Tjson /workspace/nested_clusters.dot | jq -c '
          (.clusters[] | select(.id == "cluster_outer")) as $outer |
          (.clusters[] | select(.id == "cluster_inner")) as $inner |
          {
            parent: $inner.parent,
            containsX: ($outer.x <= $inner.x and ($outer.x + $outer.width) >= ($inner.x + $inner.width)),
            containsY: ($outer.y <= $inner.y and ($outer.y + $outer.height) >= ($inner.y + $inner.height))
          }
        '
      done
    `);
    assert.equal(res.exitCode, 0, res.stderr);
    const lines = res.stdout.trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(lines, [
      { parent: "cluster_outer", containsX: true, containsY: true },
      { parent: "cluster_outer", containsX: true, containsY: true },
    ]);
  });

  it("17. handles preprocessor directives (#line), backslash-escaped quotes, and \\N/\\l/\\r label escapes", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/escapes.dot": `
          # 1 "generated.dot"
          digraph Escapes {
            id_01 [label="Node:\\N\\lLeft-aligned\\rRight-aligned\\nQuote:\\"ok\\""];
          }
        `,
      },
    });
    const res = await h.exec(`
      set -euo pipefail
      dot -Tsvg /workspace/escapes.dot | xq -r '.svg.g.g.text | map(."#text") | join("|")'
    `);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout.trim(), 'Node:id_01|Left-aligned|Right-aligned|Quote:"ok"');
  });

  it("18. deduplicates directed vs undirected edges in strict mode while merging edge attributes", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(`
      set -euo pipefail
      d_count=$(printf 'strict digraph D { a -> b [color=red]; a -> b [label=ab]; b -> a [color=blue]; }' | dot -Tjson | jq '.edges | length')
      u_count=$(printf 'strict graph U { a -- b [color=red]; b -- a [label=ab]; }' | dot -Tjson | jq '.edges | length')
      u_attrs=$(printf 'strict graph U { a -- b [color=red]; b -- a [label=ab]; }' | dot -Tjson | jq -c '.edges[0].attributes')
      echo "$d_count $u_count $u_attrs"
    `);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout.trim(), '2 1 {"color":"red","label":"ab"}');
  });

  it("19. rejects invalid CLI options, unsupported formats/layouts, missing files, and DOT syntax errors with exit code 1", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(`
      set -uo pipefail
      dot -Tinvalid <<< 'digraph { a -> b }' 2>/workspace/e1 && exit 1
      grep -q "dot: unknown format: invalid" /workspace/e1

      dot -Kfdp <<< 'digraph { a -> b }' 2>/workspace/e2 && exit 1
      grep -q "dot: unsupported layout: fdp" /workspace/e2

      dot -Gbadattr <<< 'digraph { a -> b }' 2>/workspace/e3 && exit 1
      grep -q "dot: expected -Gname=value" /workspace/e3

      dot -Zfoo <<< 'digraph { a -> b }' 2>/workspace/e4 && exit 1
      grep -q "dot: unknown option: -Zfoo" /workspace/e4

      dot -o 2>/workspace/e5 && exit 1
      grep -q "dot: missing value for -o" /workspace/e5

      dot /workspace/no_such_file.dot 2>/workspace/e6 && exit 1
      grep -q "dot:" /workspace/e6

      dot <<< 'graph G { a -> b }' 2>/workspace/e7 && exit 1
      grep -q "Wrong edge operator for graph type" /workspace/e7

      dot <<< 'digraph G { a -- b }' 2>/workspace/e8 && exit 1
      grep -q "Wrong edge operator for graph type" /workspace/e8

      dot <<< 'digraph G { a [label="unterminated] }' 2>/workspace/e9 && exit 1
      grep -q "Unterminated string" /workspace/e9

      echo "ERRORS_OK"
    `);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout.trim(), "ERRORS_OK");
  });

  it("20. integrates SQLite, jq, dot, svgo, rsvg-convert, and tar in an end-to-end dependency graph report pipeline", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(`
      set -euo pipefail
      sqlite3 /workspace/deps.db <<'SQL'
CREATE TABLE services (id TEXT PRIMARY KEY, tier TEXT, shape TEXT);
CREATE TABLE calls (caller TEXT, callee TEXT, rps INTEGER);
INSERT INTO services VALUES ('gateway', 'edge', 'component'), ('auth', 'edge', 'box'), ('orders', 'core', 'ellipse'), ('ledger', 'core', 'cylinder');
INSERT INTO calls VALUES ('gateway', 'auth', 450), ('gateway', 'orders', 320), ('orders', 'ledger', 310);
SQL
      {
        echo "digraph ServiceDeps {"
        echo "  rankdir=LR;"
        sqlite3 -json /workspace/deps.db "SELECT id, tier, shape FROM services ORDER BY id" |
          jq -r '.[] | "  " + .id + " [shape=" + .shape + ", label=" + ((.id + " (" + .tier + ")") | @json) + "];"'
        sqlite3 -json /workspace/deps.db "SELECT caller, callee, rps FROM calls ORDER BY caller, callee" |
          jq -r '.[] | "  " + .caller + " -> " + .callee + " [label=" + (((.rps | tostring) + " rps") | @json) + "];"'
        echo "}"
      } > /workspace/deps.dot

      dot -Tsvg /workspace/deps.dot | svgo -i - -o /workspace/deps.svg
      dot -Tpdf /workspace/deps.dot -o /workspace/deps.pdf
      dot -Tjson /workspace/deps.dot -o /workspace/deps.json
      tar -czf /workspace/report.tar.gz -C /workspace deps.dot deps.svg deps.pdf deps.json
      files=$(tar -tzf /workspace/report.tar.gz | sort | paste -sd, -)
      pdftotext /workspace/deps.pdf - | grep -q "310 rps"
      edges=$(jq -r '.edges | length' /workspace/deps.json)
      echo "$files:$edges"
    `);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout.trim(), "deps.dot,deps.json,deps.pdf,deps.svg:3");
  });
});
