use document_ast_rust::{Block, Document, cooperate::block_on, vector::*};
fn scene(nodes: Vec<Node>) -> Scene {
    Scene {
        width: 100.,
        height: 80.,
        nodes,
    }
}
fn path() -> Path {
    Path {
        segments: vec![
            PathSegment::MoveTo([0., 0.]),
            PathSegment::LineTo([20., 30.]),
        ],
        ..Default::default()
    }
}
fn node() -> Node {
    Node {
        bounds: [0., 0., 20., 30.],
        kind: NodeKind::Path {
            path: path(),
            fill: None,
            stroke: Some(Stroke::default()),
        },
        ..Default::default()
    }
}
#[test]
fn shared_scenes_validate_geometry_text_and_paint_attributes() {
    block_on(validate_async(&scene(vec![node()]))).unwrap();
    for change in 0..6 {
        let mut n = node();
        match change {
            0 => n.transform[2] = f64::INFINITY,
            1 => n.bounds[2] = -1.,
            2 => n.opacity = f64::NAN,
            3 => {
                n.clip = Some(Path {
                    segments: vec![PathSegment::Close],
                    ..Default::default()
                })
            }
            4 => {
                n.kind = NodeKind::Path {
                    path: path(),
                    fill: None,
                    stroke: Some(Stroke {
                        dash: vec![0., 0.],
                        ..Default::default()
                    }),
                }
            }
            _ => {
                n.kind = NodeKind::Text(Text {
                    text: "Unmeasured".into(),
                    width: 0.,
                    ..Default::default()
                })
            }
        }
        assert!(
            block_on(validate_async(&scene(vec![n]))).is_err(),
            "case {change}"
        );
    }
}
#[test]
fn vector_nodes_share_document_content_and_nesting_budgets() {
    let many = Path {
        segments: vec![PathSegment::MoveTo([0., 0.]); 100000],
        ..Default::default()
    };
    let s = scene(vec![Node {
        kind: NodeKind::Path {
            path: many,
            fill: None,
            stroke: None,
        },
        ..Default::default()
    }]);
    block_on(validate_async(&s)).unwrap();
    let doc = Document {
        blocks: vec![Block::Vector(s.clone()), Block::Vector(s)],
        ..Default::default()
    };
    assert!(
        document_ast_rust::validate(&doc)
            .unwrap_err()
            .contains("content limit")
    );
    let mut nodes = vec![node()];
    for _ in 0..66 {
        nodes = vec![Node {
            kind: NodeKind::Group(nodes),
            ..Default::default()
        }];
    }
    assert!(
        block_on(validate_async(&scene(nodes)))
            .unwrap_err()
            .contains("nesting")
    );
}
#[test]
fn raster_nodes_require_authored_embedded_raster_types() {
    let image = document_ast_rust::Image {
        bytes: b"<svg/>".to_vec(),
        mime: "image/svg+xml".into(),
        width: 10.,
        height: 10.,
        alt: String::new(),
        title: String::new(),
        link: None,
    };
    let s = scene(vec![Node {
        bounds: [0., 0., 10., 10.],
        kind: NodeKind::Raster(image),
        ..Default::default()
    }]);
    assert!(
        block_on(validate_async(&s))
            .unwrap_err()
            .contains("raster image")
    );
}
