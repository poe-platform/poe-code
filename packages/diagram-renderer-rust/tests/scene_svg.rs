use document_ast_rust::vector::svg::to_svg;
use document_ast_rust::{
    Image,
    cooperate::block_on,
    vector::{FillRule, LineCap, LineJoin, Node, NodeKind, Path, PathSegment, Scene, Stroke, Text},
};
use terminal_png_rust::xml::{self, Element, Node as XmlNode};
fn descendants<'a>(e: &'a Element, name: &str) -> Vec<&'a Element> {
    let mut out = vec![];
    if e.name == name {
        out.push(e);
    }
    for n in &e.children {
        if let XmlNode::Element(e) = n {
            out.extend(descendants(e, name));
        }
    }
    out
}
fn triangle() -> Path {
    Path {
        segments: vec![
            PathSegment::MoveTo([0., 0.]),
            PathSegment::LineTo([40., 0.]),
            PathSegment::LineTo([0., 30.]),
            PathSegment::Close,
        ],
        rule: FillRule::EvenOdd,
    }
}
fn serialize(nodes: Vec<Node>) -> Result<Element, String> {
    let svg = block_on(to_svg(&Scene {
        width: 150.,
        height: 75.,
        nodes,
    }))?;
    xml::parse(&svg).map_err(str::to_string)
}
#[test]
fn keeps_semantic_text_metrics_style_and_physical_dimensions() {
    let root = serialize(vec![Node {
        id: Some("label<&\"".into()),
        transform: [0.8, 0.6, -0.6, 0.8, 20., 30.],
        bounds: [3., 5., 90., 16.],
        kind: NodeKind::Text(Text {
            text: "office <&> 🌱".into(),
            baseline: [3., 17.],
            width: 90.,
            ascent: 12.,
            font_size: 16.,
            font_family: "DejaVu Sans, \"fallback\"".into(),
            bold: true,
            italic: true,
            underline: true,
            strike: true,
            color: [12, 34, 56, 128],
        }),
        ..Node::default()
    }])
    .unwrap();
    assert_eq!(root.attribute("width"), Some("200"));
    assert_eq!(root.attribute("height"), Some("100"));
    assert_eq!(root.attribute("viewBox"), Some("0 0 150 75"));
    let group = descendants(&root, "g")[0];
    assert_eq!(group.attribute("id"), Some("label<&\""));
    assert_eq!(
        group.attribute("transform"),
        Some("matrix(0.8 0.6 -0.6 0.8 20 30)")
    );
    let text = descendants(&root, "text")[0];
    assert_eq!(text.text(), "office <&> 🌱");
    for (key, value) in [
        ("x", "3"),
        ("y", "17"),
        ("textLength", "90"),
        ("data-vector-ascent", "12"),
        ("font-size", "16"),
        ("font-weight", "700"),
        ("font-style", "italic"),
        ("text-decoration", "underline line-through"),
        ("lengthAdjust", "spacingAndGlyphs"),
        ("xml:space", "preserve"),
        ("font-family", "DejaVu Sans, \"fallback\""),
    ] {
        assert_eq!(text.attribute(key), Some(value), "{key}");
    }
    assert_eq!(text.attribute("fill"), Some("#0c2238"));
    assert!(
        (text
            .attribute("fill-opacity")
            .unwrap()
            .parse::<f64>()
            .unwrap()
            - 128. / 255.)
            .abs()
            < 1e-12
    );
}
#[test]
fn keeps_group_opacity_and_clips_separate_from_paint_alpha() {
    let stroke = Stroke {
        color: [255, 0, 0, 128],
        width: 2.,
        dash: vec![3., 2.],
        dash_offset: 1.,
        line_cap: LineCap::Round,
        line_join: LineJoin::Bevel,
        miter_limit: 4.,
    };
    let root = serialize(vec![Node {
        id: Some("document-vector-clip-1".into()),
        opacity: 0.4,
        clip: Some(triangle()),
        bounds: [0., 0., 40., 30.],
        kind: NodeKind::Group(vec![Node {
            bounds: [0., 0., 40., 30.],
            kind: NodeKind::Path {
                path: triangle(),
                fill: Some([0, 0, 255, 64]),
                stroke: Some(stroke),
            },
            ..Node::default()
        }]),
        ..Node::default()
    }])
    .unwrap();
    let groups = descendants(&root, "g");
    assert_eq!(groups[0].attribute("opacity"), Some("0.4"));
    assert_eq!(groups[2].attribute("opacity"), Some("1"));
    let clip = descendants(&root, "clipPath")[0];
    assert_eq!(clip.attribute("id"), Some("document-vector-clip-2"));
    assert_eq!(
        groups[1].attribute("clip-path"),
        Some("url(#document-vector-clip-2)")
    );
    let paths = descendants(&root, "path");
    assert_eq!(paths[0].attribute("clip-rule"), Some("evenodd"));
    assert_eq!(paths[1].attribute("fill-rule"), Some("evenodd"));
    assert_eq!(paths[1].attribute("stroke-dasharray"), Some("3 2"));
    assert_eq!(paths[1].attribute("stroke-linecap"), Some("round"));
    assert_eq!(paths[1].attribute("stroke-linejoin"), Some("bevel"));
    assert_eq!(paths[1].attribute("stroke-dashoffset"), Some("1"));
}
#[test]
fn preserves_original_raster_bytes_in_every_base64_tail_length() {
    for len in 1..=8 {
        let bytes = (0..len).map(|i| (i * 37) as u8).collect::<Vec<_>>();
        let root = serialize(vec![Node {
            bounds: [2., 3., 40., 20.],
            kind: NodeKind::Raster(Image {
                bytes: bytes.clone(),
                mime: "image/png".into(),
                width: 40.,
                height: 20.,
                alt: "Photo & description".into(),
                title: "Original <photo>".into(),
                link: None,
            }),
            ..Node::default()
        }])
        .unwrap();
        let image = descendants(&root, "image")[0];
        let encoded = image
            .attribute("href")
            .unwrap()
            .strip_prefix("data:image/png;base64,")
            .unwrap();
        assert!(mcp_protocol_rust::formats::is_base64(
            &encoded.encode_utf16().collect::<Vec<_>>()
        ));
        assert_eq!(
            mcp_protocol_rust::formats::base64_decode(encoded).unwrap(),
            bytes
        );
        assert_eq!(image.attribute("x"), Some("2"));
        assert_eq!(image.attribute("preserveAspectRatio"), Some("none"));
        assert_eq!(descendants(image, "title")[0].text(), "Original <photo>");
        assert_eq!(descendants(image, "desc")[0].text(), "Photo & description");
    }
}
#[test]
fn invalid_scene_or_xml_metadata_fails_instead_of_corrupt_svg() {
    assert!(
        serialize(vec![Node {
            opacity: f64::NAN,
            ..Node::default()
        }])
        .is_err()
    );
    assert!(
        serialize(vec![Node {
            id: Some("bad\0id".into()),
            ..Node::default()
        }])
        .is_err()
    );
    assert!(
        serialize(vec![Node {
            kind: NodeKind::Text(Text {
                text: "unmeasured".into(),
                ..Text::default()
            }),
            ..Node::default()
        }])
        .is_err()
    );
}
