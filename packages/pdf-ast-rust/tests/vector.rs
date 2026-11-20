use document_ast_rust::{Block, Document, Inline, Paragraph, TextStyle, vector::*};
use pdf_ast_rust::{
    PageBox, Paint, PdfDocument, PdfOptions, layout_document, serialize_pdf, write_pdf_with_options,
};

fn rect(x: f64, y: f64, w: f64, h: f64) -> Path {
    Path {
        segments: vec![
            PathSegment::MoveTo([x, y]),
            PathSegment::LineTo([x + w, y]),
            PathSegment::LineTo([x + w, y + h]),
            PathSegment::LineTo([x, y + h]),
            PathSegment::Close,
        ],
        ..Default::default()
    }
}
fn shape(x: f64, y: f64, w: f64, h: f64, color: Color) -> Node {
    Node {
        bounds: [x, y, w, h],
        kind: NodeKind::Path {
            path: rect(x, y, w, h),
            fill: Some(color),
            stroke: None,
        },
        ..Default::default()
    }
}
fn text(value: &str, x: f64, y: f64, family: &str) -> Node {
    Node {
        bounds: [x, y - 10., value.len() as f64 * 7., 14.],
        kind: NodeKind::Text(Text {
            text: value.into(),
            baseline: [x, y],
            width: value.len() as f64 * 7.,
            ascent: 10.,
            font_size: 12.,
            font_family: family.into(),
            ..Default::default()
        }),
        ..Default::default()
    }
}
pub fn sample() -> Document {
    let mut hole = rect(0., 0., 90., 40.);
    hole.segments.extend(rect(30., 10., 30., 20.).segments);
    hole.rule = FillRule::EvenOdd;
    Document {
        title: "Native vector content".into(),
        blocks: vec![Block::Vector(Scene {
            width: 200.,
            height: 120.,
            nodes: vec![
                Node {
                    bounds: [0., 0., 80., 40.],
                    transform: [1., 0., 0., 1., 10., 10.],
                    opacity: 0.5,
                    kind: NodeKind::Group(vec![
                        shape(0., 0., 50., 40., [255, 0, 0, 255]),
                        shape(30., 0., 50., 40., [0, 0, 255, 255]),
                    ]),
                    ..Default::default()
                },
                Node {
                    bounds: [0., 0., 90., 40.],
                    transform: [1., 0., 0., 1., 100., 10.],
                    clip: Some(hole),
                    kind: NodeKind::Group(vec![shape(0., 0., 90., 40., [0, 160, 0, 255])]),
                    ..Default::default()
                },
                text("Editable label", 10., 80., "Arial"),
                Node {
                    bounds: [10., 90., 100., 20.],
                    kind: NodeKind::Path {
                        path: Path {
                            segments: vec![
                                PathSegment::MoveTo([10., 110.]),
                                PathSegment::CurveTo([30., 80., 80., 80., 110., 110.]),
                            ],
                            ..Default::default()
                        },
                        fill: None,
                        stroke: Some(Stroke {
                            color: [180, 20, 20, 128],
                            width: 2.,
                            dash: vec![4., 2.],
                            line_cap: LineCap::Round,
                            ..Default::default()
                        }),
                    },
                    ..Default::default()
                },
            ],
        })],
    }
}
pub fn options() -> PdfOptions {
    PdfOptions {
        page: PageBox {
            width: 260.,
            height: 200.,
            margin: 20.,
        },
        ..Default::default()
    }
}
fn walk(items: &[Paint]) -> Vec<&Paint> {
    let mut out = vec![];
    for item in items {
        out.push(item);
        if let Paint::Group { paints, .. } = item {
            out.extend(walk(paints));
        }
    }
    out
}
fn all(layout: &PdfDocument) -> Vec<&Paint> {
    layout.pages.iter().flat_map(|p| walk(&p.paints)).collect()
}
#[test]
fn semantic_scene_lowers_to_paths_groups_and_real_text_without_rasterization() {
    let options = options();
    let layout = layout_document(&sample(), &options).unwrap();
    assert!(layout.images.is_empty());
    let paints = all(&layout);
    assert_eq!(
        paints
            .iter()
            .filter(|p| matches!(p, Paint::Path { .. }))
            .count(),
        4
    );
    assert!(
        paints
            .iter()
            .any(|p| matches!(p,Paint::Group{opacity,..} if *opacity==0.5))
    );
    assert!(
        paints
            .iter()
            .any(|p| matches!(p,Paint::Group{clip:Some(path),..} if path.rule==FillRule::EvenOdd))
    );
    assert!(
        paints
            .iter()
            .any(|p| matches!(p,Paint::Text{text,..} if text=="Editable label"))
    );
    assert_eq!(layout.fonts.len(), 1);
    let bytes = serialize_pdf(&layout, &options.limits).unwrap();
    let raw = String::from_utf8_lossy(&bytes);
    assert!(raw.contains("/Subtype /Form"));
    assert!(raw.contains("/S /Transparency /I true"));
    assert!(raw.contains("/ToUnicode"));
    assert!(raw.contains("/FontFile2"));
    assert!(!raw.contains("/Subtype /Image"));
}
#[test]
fn supported_source_font_families_use_embedded_faces_and_widths() {
    let families = [
        ("Inter, Arial, sans-serif", "LiberationSans"),
        ("JetBrains Mono", "JetBrainsMono-Regular"),
        ("DejaVu Sans", "DejaVuSans"),
        ("Times,serif", "DejaVuSerif"),
    ];
    for (family, expected) in families {
        let doc = Document {
            blocks: vec![Block::Vector(Scene {
                width: 180.,
                height: 40.,
                nodes: vec![text("Label", 0., 20., family)],
            })],
            ..Default::default()
        };
        let layout = layout_document(&doc, &options()).unwrap();
        assert_eq!(layout.fonts[0].id, expected);
        let paints = all(&layout);
        let scale = paints
            .iter()
            .find_map(|p| match p {
                Paint::Group {
                    transform, paints, ..
                } if paints.iter().any(|p| matches!(p, Paint::Text { .. })) => Some(transform[0]),
                _ => None,
            })
            .unwrap();
        let font = terminal_png_rust::font::Font::new(&layout.fonts[0].bytes).unwrap();
        let measured = "Label"
            .chars()
            .map(|c| {
                f64::from(font.advance(font.glyph_index(c as u32)).unwrap())
                    / f64::from(font.units_per_em())
                    * 12.
            })
            .sum::<f64>();
        assert!((scale * measured - 35.).abs() < 1e-8);
    }
    let doc = Document {
        blocks: vec![Block::Vector(Scene {
            width: 100.,
            height: 40.,
            nodes: vec![text("Label", 0., 20., "Unprovided Custom Font")],
        })],
        ..Default::default()
    };
    assert!(
        write_pdf_with_options(&doc, &options())
            .unwrap_err()
            .contains("Unsupported PDF vector font")
    );
}
#[test]
fn vector_groups_participate_in_font_glyph_work_and_output_limits() {
    let doc = sample();
    for kind in ["fonts", "glyphs", "work", "output"] {
        let mut options = options();
        match kind {
            "fonts" => options.limits.fonts = 0,
            "glyphs" => options.limits.glyphs = 2,
            "work" => options.limits.layout_work = 3,
            _ => options.limits.output_bytes = 64,
        }
        assert!(
            write_pdf_with_options(&doc, &options)
                .unwrap_err()
                .starts_with("E_LIMIT:"),
            "{kind}"
        );
    }
    let mut layout = layout_document(&doc, &options()).unwrap();
    let Paint::Group { paints, .. } = &mut layout.pages[0].paints[0] else {
        panic!()
    };
    paints.push(Paint::Text {
        x: 0.,
        y: 0.,
        size: 12.,
        font: 200,
        text: "Bad resource".into(),
        style: Default::default(),
    });
    assert!(
        serialize_pdf(&layout, &options().limits)
            .unwrap_err()
            .contains("Unknown PDF font")
    );
}
#[test]
fn malformed_public_paths_groups_and_deep_trees_fail_before_writing() {
    let mut layout = layout_document(&sample(), &options()).unwrap();
    layout.pages[0].paints = vec![Paint::Path {
        x: 0.,
        y: 0.,
        path: Path {
            segments: vec![PathSegment::LineTo([2., 3.])],
            ..Default::default()
        },
        fill: Some([0, 0, 0, 255]),
        stroke: None,
    }];
    assert!(
        serialize_pdf(&layout, &options().limits)
            .unwrap_err()
            .contains("MoveTo")
    );
    for opacity in [-1., f64::NAN, 2.] {
        layout.pages[0].paints = vec![Paint::Group {
            x: 0.,
            y: 0.,
            bounds: [0., 0., 10., 10.],
            transform: [1., 0., 0., 1., 0., 0.],
            clip: None,
            opacity,
            paints: vec![],
        }];
        assert!(
            serialize_pdf(&layout, &options().limits)
                .unwrap_err()
                .contains("vector group")
        );
    }
    let mut group = vec![];
    for _ in 0..66 {
        group = vec![Paint::Group {
            x: 0.,
            y: 0.,
            bounds: [0., 0., 10., 10.],
            transform: [1., 0., 0., 1., 0., 0.],
            clip: None,
            opacity: 1.,
            paints: group,
        }];
    }
    layout.pages[0].paints = group;
    assert!(
        serialize_pdf(&layout, &options().limits)
            .unwrap_err()
            .contains("nesting")
    );
}
#[test]
fn vector_scene_scales_to_page_and_stays_with_its_heading() {
    let mut doc = sample();
    let Block::Vector(scene) = &mut doc.blocks[0] else {
        panic!()
    };
    scene.width = 1000.;
    scene.height = 500.;
    doc.blocks.insert(
        0,
        Block::Heading {
            level: 2,
            id: "scene".into(),
            inlines: vec![Inline::Text {
                text: "Diagram".into(),
                style: TextStyle::default(),
            }],
        },
    );
    doc.blocks.insert(
        0,
        Block::Paragraph(Paragraph {
            inlines: vec![Inline::Text {
                text: "Before".into(),
                style: Default::default(),
            }],
            ..Default::default()
        }),
    );
    let layout = layout_document(&doc, &options()).unwrap();
    let page = layout
        .pages
        .iter()
        .position(|p| p.paints.iter().any(|p| matches!(p, Paint::Group { .. })))
        .unwrap();
    assert_eq!(layout.anchors["scene"].0, page);
    for paint in &layout.pages[page].paints {
        if let Paint::Group {
            x,
            y,
            bounds,
            transform,
            ..
        } = paint
        {
            assert!(*x >= 20. && *y >= 20.);
            assert!(*x + bounds[2] * transform[0] <= 240.001);
            assert!(*y + bounds[3] * transform[3] <= 180.001);
        }
    }
}
#[test]
#[ignore = "requires independent pypdfium2"]
fn independent_pdfium_checks_clip_group_alpha_and_searchable_text() {
    use std::{
        io::Write,
        process::{Command, Stdio},
    };
    let bytes = write_pdf_with_options(&sample(), &options()).unwrap();
    let mut child = Command::new("python3")
        .args([
            "-c",
            r#"
import sys,pypdfium2 as pdfium
pdf=pdfium.PdfDocument(sys.stdin.buffer.read());page=pdf[0]
assert 'Editable label' in page.get_textpage().get_text_range()
im=page.render(scale=2).to_pil().convert('RGB')
def pixel(x,y):return im.getpixel((x*2,y*2))
def near(a,b):return all(abs(x-y)<3 for x,y in zip(a,b))
assert near(pixel(40,40),(255,127,127)),pixel(40,40)
assert near(pixel(70,40),(127,127,255)),pixel(70,40)
assert near(pixel(130,40),(0,160,0)),pixel(130,40)
assert near(pixel(160,50),(255,255,255)),pixel(160,50)
"#,
        ])
        .stdin(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(&bytes).unwrap();
    let result = child.wait_with_output().unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
}

#[test]
fn authored_raster_is_embedded_alongside_vector_geometry() {
    let image = document_ast_rust::Image {
        bytes: terminal_png_rust::png::encode(2, 1, &[255, 0, 0, 255, 0, 0, 255, 128]).unwrap(),
        mime: "image/png".into(),
        width: 2.,
        height: 1.,
        alt: "Source photo".into(),
        title: String::new(),
        link: None,
    };
    let doc = Document {
        blocks: vec![Block::Vector(Scene {
            width: 100.,
            height: 60.,
            nodes: vec![
                shape(0., 0., 100., 60., [240, 240, 240, 255]),
                Node {
                    bounds: [20., 10., 60., 30.],
                    kind: NodeKind::Raster(image),
                    ..Default::default()
                },
            ],
        })],
        ..Default::default()
    };
    let layout = layout_document(&doc, &options()).unwrap();
    assert_eq!(layout.images.len(), 1);
    assert_eq!(
        all(&layout)
            .iter()
            .filter(|p| matches!(p, Paint::Image { .. }))
            .count(),
        1
    );
    assert_eq!(
        all(&layout)
            .iter()
            .filter(|p| matches!(p, Paint::Path { .. }))
            .count(),
        1
    );
    let bytes = serialize_pdf(&layout, &options().limits).unwrap();
    assert!(String::from_utf8_lossy(&bytes).contains("/SMask"));
}
#[test]
fn vectors_inside_table_cells_stay_in_their_cell_and_preserve_text_resources() {
    use document_ast_rust::{TableCell, TableRow};
    let cell = |blocks| TableCell {
        blocks,
        header: false,
        align: Default::default(),
        colspan: 1,
        rowspan: 1,
    };
    let source = sample();
    let doc = Document {
        blocks: vec![Block::Table {
            width: None,
            column_widths: vec![],
            rows: vec![TableRow {
                header: false,
                cells: vec![
                    cell(source.blocks),
                    cell(vec![Block::Paragraph(Paragraph {
                        inlines: vec![Inline::Text {
                            text: "Neighbor".into(),
                            style: Default::default(),
                        }],
                        ..Default::default()
                    })]),
                ],
            }],
        }],
        ..Default::default()
    };
    let layout = layout_document(&doc, &options()).unwrap();
    let paints = all(&layout);
    assert!(
        paints
            .iter()
            .any(|p| matches!(p,Paint::Text{text,..}if text=="Editable label"))
    );
    assert!(
        paints
            .iter()
            .any(|p| matches!(p,Paint::Text{text,..}if text=="Neighbor"))
    );
    let scene = layout.pages[0]
        .paints
        .iter()
        .find_map(|p| match p {
            Paint::Group {
                x,
                bounds,
                transform,
                ..
            } => Some((x, bounds, transform)),
            _ => None,
        })
        .unwrap();
    assert!(*scene.0 >= 26.);
    assert!(*scene.0 + scene.1[2] * scene.2[0] <= 130.);
    assert!(
        !serialize_pdf(&layout, &options().limits)
            .unwrap()
            .is_empty()
    );
}
#[test]
fn affine_transform_and_dashed_curve_survive_the_public_display_tree() {
    let mut doc = sample();
    let Block::Vector(scene) = &mut doc.blocks[0] else {
        panic!()
    };
    scene.nodes[3].transform = [0., 1., -1., 0., 120., 0.];
    let layout = layout_document(&doc, &options()).unwrap();
    assert!(
        all(&layout)
            .iter()
            .any(|p| matches!(p,Paint::Group{transform,..}if *transform==[0.,1.,-1.,0.,120.,0.]))
    );
    assert!(all(&layout).iter().any(|p|matches!(p,Paint::Path{path,stroke:Some(stroke),..}if path.segments.iter().any(|s|matches!(s,PathSegment::CurveTo(_))) && stroke.dash==[4.,2.] && stroke.line_cap==LineCap::Round)));
    serialize_pdf(&layout, &options().limits).unwrap();
}

#[test]
fn transparency_resources_grow_linearly_instead_of_referencing_unrelated_groups() {
    let document = |count| Document {
        blocks: vec![Block::Vector(Scene {
            width: 100.,
            height: 80.,
            nodes: (0..count)
                .map(|_| Node {
                    opacity: 0.5,
                    ..shape(10., 10., 30., 20., [10, 20, 30, 255])
                })
                .collect(),
        })],
        ..Default::default()
    };
    let small = write_pdf_with_options(&document(80), &options()).unwrap();
    let large = write_pdf_with_options(&document(160), &options()).unwrap();
    assert!(
        large.len() < small.len() * 5 / 2,
        "resource growth {} -> {}",
        small.len(),
        large.len()
    );
}
#[test]
fn vector_text_decorations_remain_strokes_around_real_text() {
    let mut label = text("Styled", 10., 25., "DejaVu Sans");
    let NodeKind::Text(run) = &mut label.kind else {
        panic!()
    };
    run.underline = true;
    run.strike = true;
    run.bold = true;
    run.italic = true;
    run.color = [100, 20, 50, 128];
    let layout = layout_document(
        &Document {
            blocks: vec![Block::Vector(Scene {
                width: 120.,
                height: 50.,
                nodes: vec![label],
            })],
            ..Default::default()
        },
        &options(),
    )
    .unwrap();
    assert!(all(&layout).iter().any(
        |p| matches!(p,Paint::Text{text,style,..}if text=="Styled" && style.bold && style.italic)
    ));
    assert_eq!(
        all(&layout)
            .iter()
            .filter(|p| matches!(p, Paint::Stroke { .. }))
            .count(),
        2
    );
    assert!(
        all(&layout)
            .iter()
            .any(|p| matches!(p,Paint::Group{opacity,..}if (*opacity-128./255.).abs()<1e-9))
    );
    serialize_pdf(&layout, &options().limits).unwrap();
}
