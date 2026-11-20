use document_ast_rust::{cooperate::block_on, vector::*};
use document_converter_rust::{Format, vector};
use mcp_protocol_rust::json::{self, Value};
fn parse(source: &str) -> Value {
    json::parse(
        source.as_bytes(),
        json::Limits {
            max_bytes: 1024 * 1024,
            max_depth: 256,
            max_nodes: 100_000,
        },
    )
    .unwrap()
}
fn example() -> Scene {
    Scene {
        width: 120.,
        height: 80.,
        nodes: vec![Node {
            id: Some("box".into()),
            bounds: [2., 3., 100., 50.],
            kind: NodeKind::Group(vec![
                Node {
                    bounds: [0., 0., 100., 50.],
                    kind: NodeKind::Path {
                        path: Path {
                            segments: vec![
                                PathSegment::MoveTo([0., 0.]),
                                PathSegment::LineTo([100., 0.]),
                                PathSegment::CurveTo([100., 10., 90., 50., 0., 50.]),
                                PathSegment::Close,
                            ],
                            rule: FillRule::EvenOdd,
                        },
                        fill: Some([1, 2, 3, 128]),
                        stroke: Some(Stroke {
                            dash: vec![2., 3.],
                            line_cap: LineCap::Round,
                            line_join: LineJoin::Bevel,
                            ..Default::default()
                        }),
                    },
                    ..Default::default()
                },
                Node {
                    bounds: [5., 10., 70., 15.],
                    kind: NodeKind::Text(Text {
                        text: "Editable café".into(),
                        baseline: [5., 22.],
                        width: 70.,
                        font_size: 12.,
                        bold: true,
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            ]),
            ..Default::default()
        }],
    }
}
#[test]
fn scene_json_roundtrip_keeps_geometry_identity_and_text() {
    block_on(async {
        let first = vector::to_json(&example()).await.unwrap();
        let scene = vector::from_json(&first).await.unwrap();
        let second = vector::to_json(&scene).await.unwrap();
        assert_eq!(json::stringify(&first), json::stringify(&second));
        let encoded = json::stringify(&second);
        for text in ["box", "Editable café", "evenodd", "round", "bevel"] {
            assert!(encoded.contains(text));
        }
    })
}
#[test]
fn rejects_unknown_fields_nonfinite_numbers_invalid_color_and_path() {
    block_on(async {
        for source in [
            r#"{"width":0,"height":1,"nodes":[]}"#,
            r#"{"width":1,"height":1,"nodes":[],"ignored":true}"#,
            r#"{"width":1,"height":1,"nodes":[{"bounds":[0,0,1,1],"transform":[1,0,0,1,0,0],"opacity":1,"kind":"path","path":{"rule":"nonzero","segments":[["L",0,0]]},"fill":[0,0,0,255]}]}"#,
            r#"{"width":1,"height":1,"nodes":[{"bounds":[0,0,1,1],"transform":[1,0,0,1,0,0],"opacity":1,"kind":"path","path":{"rule":"nonzero","segments":[["M",0,0]]},"fill":[0,0,0,256]}]}"#,
            r#"{"width":1,"height":1,"nodes":[{"bounds":[0,0,1,1],"transform":[1,0,0,1,0,0],"opacity":2,"kind":"group","children":[]}]}"#,
        ] {
            assert!(vector::from_json(&parse(source)).await.is_err(), "{source}");
        }
        let duplicate = Value::Object(vec![
            ("width".encode_utf16().collect(), Value::Number(1.)),
            ("width".encode_utf16().collect(), Value::Number(2.)),
            ("height".encode_utf16().collect(), Value::Number(1.)),
            ("nodes".encode_utf16().collect(), Value::Array(vec![])),
        ]);
        assert!(vector::from_json(&duplicate).await.is_err());
        let mut scene = example();
        scene.width = f64::NAN;
        assert!(vector::to_json(&scene).await.is_err());
    })
}
#[test]
fn rejects_depth_and_path_work_before_large_conversion() {
    block_on(async {
        let mut nodes = Value::Array(vec![]);
        for _ in 0..66 {
            nodes = Value::Array(vec![Value::Object(vec![
                ("bounds".encode_utf16().collect(), parse("[0,0,1,1]")),
                ("transform".encode_utf16().collect(), parse("[1,0,0,1,0,0]")),
                ("opacity".encode_utf16().collect(), Value::Number(1.)),
                ("kind".encode_utf16().collect(), parse("\"group\"")),
                ("children".encode_utf16().collect(), nodes),
            ])]);
        }
        let value = Value::Object(vec![
            ("width".encode_utf16().collect(), Value::Number(1.)),
            ("height".encode_utf16().collect(), Value::Number(1.)),
            ("nodes".encode_utf16().collect(), nodes),
        ]);
        assert_eq!(vector::from_json(&value).await.unwrap_err().code, "E_LIMIT");
        let mut scene = example();
        scene.nodes = vec![Node {
            kind: NodeKind::Path {
                path: Path {
                    segments: vec![PathSegment::MoveTo([0., 0.]); 200_001],
                    ..Default::default()
                },
                fill: None,
                stroke: None,
            },
            ..Default::default()
        }];
        assert!(vector::to_json(&scene).await.is_err());
    })
}
#[test]
fn embedded_raster_roundtrips_and_rejects_mismatched_mime() {
    block_on(async {
        let data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";
        let source = format!(
            r#"{{"width":1,"height":1,"nodes":[{{"bounds":[0,0,1,1],"transform":[1,0,0,1,0,0],"opacity":1,"kind":"raster","image":{{"data":"data:image/png;base64,{data}","width":1,"height":1,"alt":"pixel","title":"","link":null}}}}]}}"#
        );
        let scene = vector::from_json(&parse(&source)).await.unwrap();
        let serialized = vector::to_json(&scene).await.unwrap();
        assert!(json::stringify(&serialized).contains(data));
        assert!(
            vector::from_json(&parse(&source.replace("image/png", "image/jpeg")))
                .await
                .is_err()
        );
        assert!(
            vector::from_json(&parse(&source.replace(data, "@@@@")))
                .await
                .is_err()
        );
    })
}
#[test]
fn pandoc_vector_maps_to_native_block_for_both_writers() {
    block_on(async {
        let value = Value::Object(vec![(
            "blocks".encode_utf16().collect(),
            Value::Array(vec![Value::Object(vec![
                ("t".encode_utf16().collect(), parse("\"Vector\"")),
                (
                    "c".encode_utf16().collect(),
                    vector::to_json(&example()).await.unwrap(),
                ),
            ])]),
        )]);
        for format in [Format::Docx, Format::Pdf] {
            let document = document_converter_rust::map_pandoc(
                &value,
                format,
                &Default::default(),
                &mut Default::default(),
                false,
                None,
                &mut vec![],
            )
            .await
            .unwrap();
            assert!(matches!(
                document.blocks.as_slice(),
                [document_ast_rust::Block::Vector(_)]
            ));
        }
    })
}

#[test]
fn forged_frame_length_and_huge_allocation_fail_without_allocating() {
    let frame = u32::MAX.to_le_bytes();
    assert!(document_converter_rust::convert(&frame, Format::Docx).is_err());
    assert!(block_on(document_converter_rust::drawing::render_async(&frame)).is_err());
    assert!(document_converter_rust::document_alloc(usize::MAX).is_null());
    assert!(document_converter_rust::document_alloc(256 * 1024 * 1024 + 1).is_null());
}

#[test]
fn drawings_return_scene_and_svg_and_reject_unsupported_sources() {
    fn frame(value: &str) -> Vec<u8> {
        let mut out = (value.len() as u32).to_le_bytes().to_vec();
        out.extend(value.as_bytes());
        out
    }
    block_on(async {
        for source in [
            r#"{"mode":"drawing","format":"mermaid","source":"flowchart LR\nA[Start] --> B[Finish]"}"#,
            r#"{"mode":"drawing","format":"graphviz","source":"digraph G { Start -> Finish; }"}"#,
        ] {
            let out = document_converter_rust::drawing::render_async(&frame(source))
                .await
                .unwrap();
            let result = json::parse(
                &out.bytes,
                json::Limits {
                    max_bytes: 16 * 1024 * 1024,
                    max_depth: 256,
                    max_nodes: 200_000,
                },
            )
            .unwrap();
            assert!(result.get("svg").is_some());
            let scene = vector::from_json(result.get("scene").unwrap())
                .await
                .unwrap();
            assert!(scene.width > 0. && scene.height > 0. && !scene.nodes.is_empty());
        }
        for source in [
            r#"{"mode":"drawing","format":"png","source":"ignored"}"#,
            r#"{"mode":"drawing","format":"svg","source":"<svg><foreignObject>VISIBLE</foreignObject></svg>"}"#,
        ] {
            assert!(
                document_converter_rust::drawing::render_async(&frame(source))
                    .await
                    .is_err()
            );
        }
    });
}
