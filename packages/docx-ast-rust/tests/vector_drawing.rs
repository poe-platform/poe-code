use document_ast_rust::{vector::*, *};
use office_package_rust::xml;

fn scene() -> Scene {
    Scene {
        width: 200.,
        height: 100.,
        nodes: vec![Node {
            id: Some("source-object".into()),
            bounds: [0., 0., 100., 70.],
            kind: NodeKind::Group(vec![Node {
                bounds: [8., 12., 90., 16.],
                kind: NodeKind::Text(Text {
                    text: "Semantic <label> & text".into(),
                    baseline: [8., 24.],
                    width: 90.,
                    font_size: 12.,
                    ..Default::default()
                }),
                ..Default::default()
            }]),
            ..Default::default()
        }],
    }
}
fn document(scene: Scene) -> Document {
    Document {
        blocks: vec![Block::Vector(scene)],
        ..Default::default()
    }
}
fn part(package: &docx_ast_rust::Package, name: &str) -> String {
    String::from_utf8(
        package
            .parts
            .iter()
            .find(|p| p.name == name)
            .unwrap()
            .bytes
            .clone(),
    )
    .unwrap()
}
fn elements<'a>(nodes: &'a [xml::Node], tag: &str) -> Vec<&'a xml::Element> {
    let mut result = Vec::new();
    for n in nodes {
        if let xml::Node::Element(e) = n {
            if e.tag == tag {
                result.push(e);
            }
            result.extend(elements(&e.children, tag));
        }
    }
    result
}
fn attr<'a>(e: &'a xml::Element, key: &str) -> Option<&'a str> {
    e.attrs
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.as_str())
}

#[test]
fn svg_only_picture_matches_actual_pandoc_extension_structure() {
    let package = docx_ast_rust::to_package(&document(scene())).unwrap();
    let source = part(&package, "word/document.xml");
    let ours = xml::parse(&source, None, None).unwrap();
    let reference = xml::parse(include_str!("fixtures/pandoc-svg-blip.xml"), None, None).unwrap();
    for tree in [&ours.nodes, &reference.nodes] {
        let blips = elements(tree, "a:blip");
        assert_eq!(blips.len(), 1);
        assert!(
            attr(blips[0], "r:embed").is_none(),
            "base blip is not an SVG relationship"
        );
        let ext = elements(&blips[0].children, "a:ext")
            .into_iter()
            .find(|e| attr(e, "uri") == Some("{96DAC541-7B7A-43D3-8B79-37D633B846F1}"))
            .unwrap();
        let svg = elements(&ext.children, "asvg:svgBlip");
        assert_eq!(svg.len(), 1);
        assert_eq!(
            attr(svg[0], "xmlns:asvg"),
            Some("http://schemas.microsoft.com/office/drawing/2016/SVG/main")
        );
        assert!(attr(svg[0], "r:embed").is_some());
    }
    let blips = elements(&ours.nodes, "asvg:svgBlip");
    let rel_id = attr(blips[0], "r:embed").unwrap();
    let rels = xml::parse(&part(&package, "word/_rels/document.xml.rels"), None, None).unwrap();
    let rel = elements(&rels.nodes, "Relationship")
        .into_iter()
        .find(|e| attr(e, "Id") == Some(rel_id))
        .unwrap();
    assert_eq!(
        attr(rel, "Type"),
        Some("http://schemas.openxmlformats.org/officeDocument/2006/relationships/image")
    );
    assert!(attr(rel, "TargetMode").is_none());
    let media: Vec<_> = package
        .parts
        .iter()
        .filter(|p| p.name.starts_with("word/media/"))
        .collect();
    assert_eq!(media.len(), 1);
    assert!(media[0].name.ends_with(".svg"));
    assert_eq!(
        format!("word/{}", attr(rel, "Target").unwrap()),
        media[0].name
    );
    assert!(part(&package, "[Content_Types].xml").contains("ContentType=\"image/svg+xml\""));
    let svg = String::from_utf8(media[0].bytes.clone()).unwrap();
    assert!(svg.contains("Semantic &lt;label&gt; &amp; text"));
    assert!(svg.contains("source-object"));
    assert!(!source.contains("wps:wsp") && !source.contains("wpg:wgp"));
    assert!(package.write().unwrap().starts_with(b"PK"));
}

#[test]
fn clipping_group_opacity_and_nonuniform_transforms_remain_vector() {
    let mut scene = scene();
    scene.nodes[0].opacity = 0.5;
    scene.nodes[0].transform = [2., 0.3, 0., 1., 2., 3.];
    scene.nodes[0].clip = Some(Path {
        segments: vec![
            PathSegment::MoveTo([0., 0.]),
            PathSegment::LineTo([100., 0.]),
            PathSegment::CurveTo([100., 50., 50., 100., 0., 0.]),
            PathSegment::Close,
        ],
        rule: FillRule::EvenOdd,
    });
    let package = docx_ast_rust::to_package(&document(scene)).unwrap();
    let svg = String::from_utf8(
        package
            .parts
            .iter()
            .find(|p| p.name.ends_with(".svg"))
            .unwrap()
            .bytes
            .clone(),
    )
    .unwrap();
    for token in [
        "<clipPath",
        "clip-path=",
        "opacity=\"0.5\"",
        "matrix(2 0.3 0 1 2 3)",
        "Semantic &lt;label&gt;",
    ] {
        assert!(svg.contains(token), "missing {token}: {svg}");
    }
}

#[test]
fn invalid_scene_is_rejected_before_packaging() {
    let mut bad = scene();
    bad.nodes[0].transform[0] = f64::NAN;
    assert!(docx_ast_rust::to_package(&document(bad)).is_err());
    let mut bad = scene();
    bad.height = 0.;
    assert!(docx_ast_rust::to_package(&document(bad)).is_err());
}

#[test]
fn vector_picture_fits_table_cell_and_keeps_unique_drawing_ids() {
    let mut large = scene();
    large.width = 1000.;
    let document = Document {
        blocks: vec![
            Block::Vector(scene()),
            Block::Table {
                width: Some(0.4),
                column_widths: vec![1., 1.],
                rows: vec![TableRow {
                    header: false,
                    cells: vec![
                        TableCell {
                            header: false,
                            blocks: vec![Block::Vector(large)],
                            align: Align::Center,
                            colspan: 1,
                            rowspan: 1,
                        },
                        TableCell {
                            header: false,
                            blocks: vec![],
                            align: Align::Default,
                            colspan: 1,
                            rowspan: 1,
                        },
                    ],
                }],
            },
        ],
        ..Default::default()
    };
    let package = docx_ast_rust::to_package(&document).unwrap();
    let source = part(&package, "word/document.xml");
    let parsed = xml::parse(&source, None, None).unwrap();
    let extents = elements(&parsed.nodes, "wp:extent");
    assert_eq!(extents.len(), 2);
    assert_eq!(attr(extents[0], "cx"), Some("2540000"));
    assert!(attr(extents[1], "cx").unwrap().parse::<u64>().unwrap() <= 100 * 12700);
    let ids: std::collections::HashSet<_> = elements(&parsed.nodes, "wp:docPr")
        .into_iter()
        .map(|e| attr(e, "id").unwrap())
        .collect();
    assert_eq!(ids.len(), 2);
}

#[test]
fn authored_raster_is_embedded_inside_svg_without_a_diagram_bitmap() {
    let png = vec![
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6,
        0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 8, 215, 99, 248, 207, 192, 240, 31,
        0, 5, 0, 1, 255, 137, 153, 61, 29, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ];
    let mut scene = scene();
    scene.nodes.push(Node {
        bounds: [100., 20., 20., 20.],
        kind: NodeKind::Raster(Image {
            bytes: png,
            mime: "image/png".into(),
            width: 1.,
            height: 1.,
            alt: "Authored photo".into(),
            title: "Photo title".into(),
            link: None,
        }),
        ..Default::default()
    });
    let package = docx_ast_rust::to_package(&document(scene)).unwrap();
    let media: Vec<_> = package
        .parts
        .iter()
        .filter(|p| p.name.starts_with("word/media/"))
        .collect();
    assert_eq!(media.len(), 1);
    assert!(media[0].name.ends_with(".svg"));
    let svg = String::from_utf8(media[0].bytes.clone()).unwrap();
    assert!(svg.contains("data:image/png;base64,iVBORw0KGgo"));
    assert!(svg.contains("Authored photo"));
    assert!(svg.contains("Photo title"));
    assert!(svg.contains("Semantic &lt;label&gt; &amp; text"));
}
