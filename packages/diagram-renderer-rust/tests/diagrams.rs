use diagram_renderer_rust::{render_graphviz, render_mermaid};
use document_ast_rust::vector::{Node, NodeKind};
fn inspect(nodes: &[Node], text: &mut Vec<String>, paths: &mut usize) {
    for node in nodes {
        assert!(node.clip.is_none(), "Native diagram geometry must not need clipping");
        match &node.kind {
            NodeKind::Group(nodes) => inspect(nodes, text, paths),
            NodeKind::Text(run) => {
                assert!(run.width > 0.);
                text.push(run.text.clone());
            }
            NodeKind::Path { path, .. } => {
                assert!(!path.segments.is_empty());
                *paths += 1;
            }
            NodeKind::Raster(_) => panic!("A native diagram must remain editable vectors and text"),
        }
    }
}
#[test]
fn every_native_mermaid_family_keeps_text_and_geometry() {
    for (source, expected) in [
        (
            "flowchart LR\n A[Start] --> B{Ready?}\n B -->|yes| C[Done]",
            "Start",
        ),
        (
            "sequenceDiagram\n participant A as Alice\n participant B as Bob\n A->>B: Hello\n B-->>A: Thanks",
            "Hello",
        ),
        (
            "stateDiagram-v2\n [*] --> Active\n Active --> [*]",
            "Active",
        ),
        (
            "classDiagram\n class Person\n class Team\n Person --> Team",
            "Person",
        ),
        ("erDiagram\n PERSON ||--o{ ORDER : places", "PERSON"),
        ("pie title Sample\n \"Done\": 2\n \"Pending\": 1", "Done"),
        (
            "gantt\n title Schedule\n dateFormat YYYY-MM-DD\n section Build\n Work :a, 2025-01-01, 2d",
            "Work",
        ),
        (
            "gitGraph\n commit\n branch work\n checkout work\n commit",
            "work",
        ),
        ("mindmap\n root((Root))\n  Child", "Root"),
        ("timeline\n title Timeline\n 2025 : Launch", "Launch"),
        (
            "journey\n title Day\n section Work\n Plan: 5: Alice",
            "Plan",
        ),
    ] {
        let output = render_mermaid(source, 16 * 1024 * 1024)
            .unwrap_or_else(|error| panic!("{source}\n{error}"));
        assert!(output.svg.contains("<svg") && output.svg.contains("<text"));
        let (mut text, mut paths) = (vec![], 0);
        inspect(&output.scene.nodes, &mut text, &mut paths);
        assert!(paths > 0);
        assert!(
            text.iter().any(|s| s.contains(expected)),
            "{source}: {text:?}"
        );
        assert!(output.scene.width > 0. && output.scene.height > 0.);
    }
}
#[test]
fn graphviz_shapes_records_labels_and_arrows_remain_editable() {
    let output=render_graphviz(r##"digraph {rankdir=LR; bgcolor="#fff"; subgraph cluster_team {label="Team"; a [shape=record,label="{Name|Value}"];} b [shape=diamond,label="Ready?"]; c [shape=cylinder,label="Data"]; a -> b [label="check",style=dashed]; b -> c; }"##,16*1024*1024).unwrap();
    let (mut text, mut paths) = (vec![], 0);
    inspect(&output.scene.nodes, &mut text, &mut paths);
    for expected in ["Team", "Name", "Value", "Ready?", "Data", "check"] {
        assert!(text.iter().any(|s| s == expected), "{text:?}");
    }
    assert!(paths >= 10);
    assert!(output.svg.contains("Ready?"));
}
#[test]
fn diagram_admission_is_bounded_and_unknown_families_fail() {
    assert!(
        render_mermaid("flowchart LR\n A-->B", 1)
            .unwrap_err()
            .contains("limit")
    );
    assert!(
        render_graphviz("digraph {a->b}", 1)
            .unwrap_err()
            .contains("limit")
    );
    assert!(
        render_mermaid("imaginaryDiagram\n A-->B", 65536)
            .unwrap_err()
            .contains("Unsupported")
    );
    assert!(render_graphviz("digraph { a -> }", 65536).is_err());
    let graph = format!(
        "digraph {{{}}}",
        (0..257).map(|n| format!("n{n};")).collect::<String>()
    );
    assert!(
        render_graphviz(&graph, 65536)
            .unwrap_err()
            .contains("node limit")
    );
}
#[test]
fn mermaid_normalizes_source_viewport_to_document_points() {
    let output = render_mermaid(
        "---\nconfig:\n  width: 400\n---\nflowchart LR\n A-->B",
        16 * 1024 * 1024,
    )
    .unwrap();
    assert_eq!(output.scene.width, 300.);
    assert!(output.svg.contains("width=\"400\""));
}

#[test]
fn public_svg_serializes_the_same_editable_scene() {
    for output in [
        render_mermaid("flowchart LR\n A[Start] --> B[Done]", 65536).unwrap(),
        render_graphviz("digraph {a [label=\"Start\"]; a->b}", 65536).unwrap(),
    ] {
        let canonical = document_ast_rust::cooperate::block_on(
            diagram_renderer_rust::svg::to_svg(&output.scene),
        ).unwrap();
        assert_eq!(output.svg, canonical);
    }
}

#[test]
fn graphviz_retains_endpoint_labels_and_label_font() {
    let output = render_graphviz(
        r#"digraph {a -> b [label="edge",headlabel="head",taillabel="tail",labelfontsize=18,labelfontcolor=red,labeldistance=2,labelangle=30]}"#,
        65536,
    ).unwrap();
    let (mut labels, mut paths) = (Vec::new(), 0);
    inspect(&output.scene.nodes, &mut labels, &mut paths);
    for expected in ["edge", "head", "tail"] {
        assert!(labels.iter().any(|label| label == expected));
        assert!(output.svg.contains(expected));
    }
    let edge = output.scene.nodes.iter().find(|node| node.id.as_deref() == Some("edge-0")).unwrap();
    let NodeKind::Group(children) = &edge.kind else { panic!("edge group") };
    for child in children {
        if let NodeKind::Text(run) = &child.kind {
            if matches!(run.text.as_str(), "head" | "tail") {
                assert_eq!(run.font_size, 18.);
                assert_eq!(run.color, [255, 0, 0, 255]);
            }
        }
    }
}

#[test]
fn endpoint_label_extents_expand_the_viewport() {
    fn check(nodes: &[Node], offset: [f64; 2], size: [f64; 2]) {
        for node in nodes {
            let offset = [offset[0] + node.transform[4], offset[1] + node.transform[5]];
            match &node.kind {
                NodeKind::Group(children) => check(children, offset, size),
                NodeKind::Text(run) if run.text.starts_with("Outside") => {
                    let [x, y, w, h] = node.bounds;
                    assert!(x + offset[0] >= 0. && y + offset[1] >= 0.);
                    assert!(x + offset[0] + w <= size[0] && y + offset[1] + h <= size[1]);
                }
                _ => {}
            }
        }
    }
    let output = render_graphviz(
        r#"digraph {a -> b [headlabel="Outside graph: a long endpoint label",taillabel="Outside tail",labelangle=90,labeldistance=30]}"#,
        65536,
    ).unwrap();
    check(&output.scene.nodes, [0., 0.], [output.scene.width, output.scene.height]);
}
