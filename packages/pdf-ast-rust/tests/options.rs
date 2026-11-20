use document_ast_rust::{Block, Document, Inline, Paragraph, TextStyle};
use pdf_ast_rust::{
    PageBox, PdfMetadata, PdfOptions, SuppliedFont, layout_document, serialize_pdf,
    write_pdf_with_options,
};
fn document() -> Document {
    Document {
        title: "Document title".into(),
        blocks: vec![
            Block::Heading {
                level: 1,
                id: "heading".into(),
                inlines: vec![Inline::Text {
                    text: "Heading".into(),
                    style: TextStyle::default(),
                }],
            },
            Block::Paragraph(Paragraph {
                inlines: vec![Inline::Text {
                    text: "Zażółć gęślą jaźń. Body text.".into(),
                    style: TextStyle::default(),
                }],
                ..Default::default()
            }),
        ],
    }
}
#[test]
fn page_geometry_fonts_metadata_and_outline_survive_serialization() {
    let font = include_bytes!("../../terminal-png-rust/assets/jetbrains-mono-400-normal.ttf");
    let options = PdfOptions {
        page: PageBox {
            width: 220.,
            height: 300.,
            margin: 20.,
        },
        font_size: 18.,
        line_height: 1.7,
        fonts: vec![SuppliedFont {
            id: "custom".into(),
            bytes: font.to_vec(),
        }],
        metadata: PdfMetadata {
            title: Some("Café 東京".into()),
            author: Some("Zoë; René".into()),
            subject: Some("Reference comparison".into()),
            keywords: vec!["pdf".into(), "portable".into()],
        },
        ..Default::default()
    };
    let layout = layout_document(&document(), &options).unwrap();
    assert_eq!(
        (layout.pages[0].width, layout.pages[0].height),
        (220., 300.)
    );
    assert_eq!(layout.fonts.len(), 1);
    assert_eq!(layout.fonts[0].bytes, font);
    assert_eq!(layout.outlines.len(), 1);
    let bytes = serialize_pdf(&layout, &options.limits).unwrap();
    let raw = String::from_utf8_lossy(&bytes);
    assert!(raw.contains("/MediaBox [0 0 220 300]"));
    assert!(raw.contains("/Outlines"));
    assert!(raw.contains("/Author <FEFF005A006F00EB003B002000520065006E00E9>"));
}
#[test]
fn font_glyph_page_and_output_budgets_fail_before_publication() {
    for key in ["fonts", "glyphs", "pages", "output"] {
        let mut options = PdfOptions::default();
        match key {
            "fonts" => options.limits.fonts = 0,
            "glyphs" => options.limits.glyphs = 1,
            "pages" => options.limits.pages = 0,
            _ => options.limits.output_bytes = 100,
        };
        assert!(
            write_pdf_with_options(&document(), &options)
                .unwrap_err()
                .starts_with("E_LIMIT:"),
            "{key}"
        );
    }
}
#[test]
fn caller_can_edit_the_pdf_display_tree_without_reparsing_markdown() {
    let options = PdfOptions::default();
    let mut layout = layout_document(&document(), &options).unwrap();
    layout.pages[0].paints.push(pdf_ast_rust::Paint::Rect {
        x: 20.,
        y: 20.,
        width: 8.,
        height: 8.,
        color: [1., 0., 0.],
    });
    assert!(
        serialize_pdf(&layout, &options.limits)
            .unwrap()
            .starts_with(b"%PDF-1.7")
    );
}

#[test]
fn cooperative_rendering_yields_and_matches_the_synchronous_writer() {
    use std::{
        future::Future,
        pin::pin,
        task::{Context, Poll, Waker},
    };
    let options = PdfOptions::default();
    let input = Document {
        title: "Long body".into(),
        blocks: vec![Block::Paragraph(Paragraph {
            inlines: vec![Inline::Text {
                text: "Repeated searchable words. ".repeat(300),
                style: TextStyle::default(),
            }],
            ..Default::default()
        })],
    };
    let mut future = pin!(pdf_ast_rust::write_pdf_with_usage_async(&input, &options));
    let mut context = Context::from_waker(Waker::noop());
    let mut yields = 0;
    let result = loop {
        match future.as_mut().poll(&mut context) {
            Poll::Pending => {
                yields += 1;
                assert!(yields < 100000);
            }
            Poll::Ready(result) => break result.unwrap(),
        }
    };
    assert!(
        yields > 30,
        "large text must yield inside processing, not just at entry"
    );
    assert_eq!(
        result.bytes,
        write_pdf_with_options(&input, &options).unwrap()
    );
    assert_eq!(result.usage.output_bytes, result.bytes.len());
    assert!(result.usage.glyphs > 3000);
    assert!(result.usage.pages > 1);
}

#[test]
fn character_cids_have_the_same_meaning_across_font_faces() {
    let options = PdfOptions::default();
    let bytes = write_pdf_with_options(&document(), &options).unwrap();
    let raw = String::from_utf8_lossy(&bytes);
    let maps: Vec<_> = raw
        .split("begincmap\n")
        .skip(1)
        .map(|s| s.split("endcmap").next().unwrap())
        .collect();
    assert!(maps.len() >= 2, "regular and bold faces are embedded");
    for map in &maps[1..] {
        assert_eq!(map, &maps[0]);
    }
}

#[test]
fn semantic_notes_render_numbered_endnotes_without_a_format_specific_mapper() {
    let paragraph = |text: &str| {
        Block::Paragraph(Paragraph {
            inlines: vec![Inline::Text {
                text: text.into(),
                style: TextStyle::default(),
            }],
            ..Default::default()
        })
    };
    let input = Document {
        title: String::new(),
        blocks: vec![Block::Paragraph(Paragraph {
            inlines: vec![
                Inline::Text {
                    text: "Body".into(),
                    style: TextStyle::default(),
                },
                Inline::Note(vec![paragraph("Footnote content")]),
            ],
            ..Default::default()
        })],
    };
    let layout = layout_document(&input, &PdfOptions::default()).unwrap();
    let text = layout
        .pages
        .iter()
        .flat_map(|p| &p.paints)
        .filter_map(|p| {
            if let pdf_ast_rust::Paint::Text { text, .. } = p {
                Some(text.as_str())
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    assert!(text.contains("Body[1]"));
    assert!(text.contains("Notes"));
    assert!(text.contains("[1] Footnote content"));
}

#[test]
fn fallback_fonts_cover_characters_without_replacing_the_body_face() {
    use terminal_png_rust::font::Font;
    let body = Font::new(include_bytes!("../src/fonts/LiberationSans-Regular.ttf")).unwrap();
    let fallback = Font::new(include_bytes!("../src/fonts/DejaVuSans.ttf")).unwrap();
    let symbol = (0x2500..0x2bff)
        .find(|&c| body.glyph_index(c) == 0 && fallback.glyph_index(c) != 0)
        .and_then(char::from_u32)
        .unwrap();
    let input = Document {
        title: String::new(),
        blocks: vec![Block::Paragraph(Paragraph {
            inlines: vec![Inline::Text {
                text: format!("Body {symbol}"),
                style: TextStyle::default(),
            }],
            ..Default::default()
        })],
    };
    let options = PdfOptions::default();
    let layout = layout_document(&input, &options).unwrap();
    assert_eq!(layout.fonts.len(), 2);
    assert_eq!(layout.fonts[0].id, "LiberationSans");
    assert_eq!(layout.fonts[1].id, "DejaVuSans");
    serialize_pdf(&layout, &options.limits).unwrap();
}

#[test]
fn outlines_and_anchors_follow_headings_to_their_actual_page() {
    let mut input = document();
    input.blocks.insert(
        0,
        Block::Paragraph(Paragraph {
            inlines: vec![Inline::Text {
                text: "Wrapped body text before the heading. ".repeat(20),
                style: TextStyle::default(),
            }],
            ..Default::default()
        }),
    );
    let options = PdfOptions {
        page: PageBox {
            width: 260.,
            height: 250.,
            margin: 20.,
        },
        ..Default::default()
    };
    let layout = layout_document(&input, &options).unwrap();
    let outline = &layout.outlines[0];
    assert!(outline.page > 0);
    assert_eq!(layout.anchors["heading"], (outline.page, outline.y));
    assert!(layout.pages[outline.page].paints.iter().any(|p| matches!(p,
        pdf_ast_rust::Paint::Text {text,y,..} if text=="Heading" && *y>outline.y && *y<outline.y+30.
    )));
    for page in &layout.pages {
        for paint in &page.paints {
            if let pdf_ast_rust::Paint::Text { y, .. } = paint {
                assert!(*y <= page.height - options.page.margin);
            }
        }
    }
}

#[test]
fn direct_ast_edits_cannot_emit_missing_glyphs_or_invalid_links() {
    let options = PdfOptions::default();
    let layout = layout_document(&document(), &options).unwrap();
    let mut invalid = layout.clone();
    invalid.pages[0]
        .links
        .push(("https://example.com".into(), [0., 0., f64::NAN, 12.]));
    assert!(
        serialize_pdf(&invalid, &options.limits)
            .unwrap_err()
            .contains("link rectangle")
    );
    let mut invalid = layout.clone();
    if let pdf_ast_rust::Paint::Text { style, .. } = &mut invalid.pages[0].paints[0] {
        style.color = Some("zz0000".into());
    } else {
        panic!("first paint should be heading text");
    }
    assert!(
        serialize_pdf(&invalid, &options.limits)
            .unwrap_err()
            .contains("text colors")
    );
    let mut invalid = layout;
    invalid.pages[0].paints.push(pdf_ast_rust::Paint::Text {
        x: 20.,
        y: 20.,
        size: 12.,
        font: 0,
        // An admitted scalar with no glyph in the selected font.
        text: "\u{0378}".into(),
        style: TextStyle::default(),
    });
    assert!(
        serialize_pdf(&invalid, &options.limits)
            .unwrap_err()
            .contains("does not cover")
    );
}

#[test]
fn a_line_taller_than_the_printable_page_is_rejected() {
    let options = PdfOptions {
        page: PageBox {
            width: 300.,
            height: 80.,
            margin: 20.,
        },
        font_size: 50.,
        ..Default::default()
    };
    let input = Document {
        title: String::new(),
        blocks: vec![Block::Paragraph(Paragraph {
            inlines: vec![Inline::Text {
                text: "Tall".into(),
                style: TextStyle::default(),
            }],
            ..Default::default()
        })],
    };
    assert!(
        layout_document(&input, &options)
            .unwrap_err()
            .contains("printable page height")
    );
}

#[test]
fn image_limits_are_admitted_before_decode_and_match_reported_usage() {
    use document_ast_rust::{Image, cooperate::block_on};
    let image = Image {
        bytes: terminal_png_rust::png::encode(2, 2, &[255; 16]).unwrap(),
        mime: "image/png".into(),
        width: 2.,
        height: 2.,
        alt: String::new(),
        title: String::new(),
        link: None,
    };
    let input = Document {
        title: String::new(),
        blocks: vec![Block::Image(image.clone()), Block::Image(image)],
    };
    let mut options = PdfOptions::default();
    options.limits.image_pixels = 3;
    assert!(
        write_pdf_with_options(&input, &options)
            .unwrap_err()
            .contains("E_LIMIT: PDF imagePixels")
    );
    options.limits.image_pixels = 4;
    options.limits.decoded_image_bytes = 4 * 16 + 65535;
    assert!(
        write_pdf_with_options(&input, &options)
            .unwrap_err()
            .contains("E_LIMIT: PDF decodedImageBytes")
    );
    options.limits.decoded_image_bytes += 1;
    let result = block_on(pdf_ast_rust::write_pdf_with_usage_async(&input, &options)).unwrap();
    assert_eq!(
        result.usage.images, 1,
        "identical image assets are embedded once"
    );
    assert_eq!(result.usage.image_pixels, 4);
    assert_eq!(
        result.usage.decoded_image_bytes,
        options.limits.decoded_image_bytes
    );
}

#[test]
fn paragraph_can_span_pages_that_only_fit_one_line() {
    let options = PdfOptions {
        page: PageBox {
            width: 150.,
            height: 70.,
            margin: 20.,
        },
        ..Default::default()
    };
    let input = Document {
        title: String::new(),
        blocks: vec![Block::Paragraph(Paragraph {
            inlines: vec![Inline::Text {
                text: "First line\nSecond line\nThird line".into(),
                style: TextStyle::default(),
            }],
            ..Default::default()
        })],
    };
    let layout = layout_document(&input, &options).unwrap();
    assert_eq!(layout.pages.len(), 3);
}

#[test]
fn image_only_links_keep_their_placement_and_share_embedded_assets() {
    let bytes = terminal_png_rust::png::encode(2, 2, &[255; 16]).unwrap();
    let image = |link| document_ast_rust::Image {
        bytes: bytes.clone(),
        mime: "image/png".into(),
        width: 40.,
        height: 30.,
        alt: String::new(),
        title: String::new(),
        link: Some(link),
    };
    let mut input = document();
    input
        .blocks
        .push(Block::Image(image("https://example.com/image".into())));
    input.blocks.push(Block::Paragraph(Paragraph {
        inlines: vec![Inline::Image(image("#heading".into()))],
        ..Default::default()
    }));
    let options = PdfOptions::default();
    let layout = layout_document(&input, &options).unwrap();
    assert_eq!(layout.images.len(), 1);
    let links: Vec<_> = layout.pages.iter().flat_map(|p| &p.links).collect();
    assert_eq!(links.len(), 2);
    assert_eq!(links[0].0, "https://example.com/image");
    assert_eq!(links[1].0, "#heading");
    assert_eq!(&links[0].1[2..], &[30., 22.5]);
    let bytes = serialize_pdf(&layout, &options.limits).unwrap();
    let raw = String::from_utf8_lossy(&bytes);
    assert!(raw.contains("/URI (https://example.com/image)"));
    assert!(raw.contains("/Dest ["));
}

#[test]
fn image_rendering_yields_inside_the_codec_and_can_be_dropped() {
    use std::{
        future::Future,
        pin::pin,
        task::{Context, Poll, Waker},
    };
    let input = Document {
        title: String::new(),
        blocks: vec![Block::Image(document_ast_rust::Image {
            bytes: terminal_png_rust::png::encode(256, 256, &vec![255; 256 * 256 * 4]).unwrap(),
            mime: "image/png".into(),
            width: 256.,
            height: 256.,
            alt: String::new(),
            title: String::new(),
            link: None,
        })],
    };
    let options = PdfOptions::default();
    let mut cx = Context::from_waker(Waker::noop());
    {
        let mut cancelled = pin!(pdf_ast_rust::write_pdf_with_options_async(&input, &options));
        for _ in 0..64 {
            assert!(cancelled.as_mut().poll(&mut cx).is_pending());
        }
        // Dropping a pending conversion is cancellation; subsequent conversion
        // must not share partially populated resources with the abandoned task.
    }
    let mut future = pin!(pdf_ast_rust::write_pdf_with_options_async(&input, &options));
    let mut polls = 0;
    let bytes = loop {
        polls += 1;
        match future.as_mut().poll(&mut cx) {
            Poll::Pending => assert!(polls < 100000),
            Poll::Ready(result) => break result.unwrap(),
        }
    };
    assert!(polls > 100, "image processing must yield internally");
    assert_eq!(bytes, write_pdf_with_options(&input, &options).unwrap());
}

#[test]
fn anchor_only_paragraphs_preserve_destinations_without_adding_space() {
    let options = PdfOptions::default();
    let original = document();
    let expected = layout_document(&original, &options).unwrap();
    let mut input = original;
    input.blocks.insert(
        0,
        Block::Paragraph(Paragraph {
            id: "wrapper".into(),
            inlines: vec![Inline::Anchor("table".into())],
            ..Default::default()
        }),
    );
    let actual = layout_document(&input, &options).unwrap();
    assert_eq!(actual.anchors["wrapper"], (0, options.page.margin));
    assert_eq!(actual.anchors["table"], (0, options.page.margin));
    assert_eq!(actual.anchors["heading"], expected.anchors["heading"]);
    assert_eq!(actual.pages[0].paints.len(), expected.pages[0].paints.len());
}

#[test]
fn malformed_glyph_locations_and_nonadvancing_fonts_are_rejected() {
    let original = include_bytes!("../../terminal-png-rust/assets/jetbrains-mono-400-normal.ttf");
    let table = |data: &[u8], tag: &[u8]| {
        let count = u16::from_be_bytes(data[4..6].try_into().unwrap()) as usize;
        let at = (0..count)
            .map(|i| 12 + i * 16)
            .find(|&at| &data[at..at + 4] == tag)
            .unwrap();
        let offset = u32::from_be_bytes(data[at + 8..at + 12].try_into().unwrap()) as usize;
        let length = u32::from_be_bytes(data[at + 12..at + 16].try_into().unwrap()) as usize;
        offset..offset + length
    };
    for kind in ["loca", "hmtx"] {
        let mut bytes = original.to_vec();
        let range = table(&bytes, kind.as_bytes());
        if kind == "loca" {
            bytes[range.start..range.start + 4].fill(255);
        } else {
            bytes[range].fill(0);
        }
        let options = PdfOptions {
            fonts: vec![SuppliedFont {
                id: "invalid".into(),
                bytes,
            }],
            ..Default::default()
        };
        let error = write_pdf_with_options(&document(), &options).unwrap_err();
        assert!(
            error.contains(if kind == "loca" {
                "glyph location"
            } else {
                "Nonadvancing"
            }),
            "{error}"
        );
    }
}

#[test]
fn ordered_list_markers_are_not_wrapped_or_overlapped_by_item_text() {
    let input = Document {
        title: String::new(),
        blocks: vec![Block::List {
            start: Some(123456789),
            style: Default::default(),
            delimiter: Default::default(),
            items: vec![vec![Block::Paragraph(Paragraph {
                inlines: vec![Inline::Text {
                    text: "ok".into(),
                    style: TextStyle::default(),
                }],
                ..Default::default()
            })]],
        }],
    };
    let layout = layout_document(&input, &PdfOptions::default()).unwrap();
    let texts: Vec<_> = layout.pages[0]
        .paints
        .iter()
        .filter_map(|p| {
            if let pdf_ast_rust::Paint::Text { x, text, .. } = p {
                Some((*x, text.as_str()))
            } else {
                None
            }
        })
        .collect();
    assert_eq!(
        texts.iter().map(|(_, t)| *t).collect::<Vec<_>>(),
        ["123456789.", "ok"]
    );
    assert!(
        texts[1].0 > texts[0].0 + 60.,
        "complete marker needs its own measured space: {texts:?}"
    );
}

#[test]
fn caption_keeps_with_table_but_unrelated_prose_retains_normal_flow() {
    let paragraph = |text: &str, keep_with_next| {
        Block::Paragraph(Paragraph {
            inlines: vec![Inline::Text {
                text: text.into(),
                style: TextStyle::default(),
            }],
            keep_with_next,
            ..Default::default()
        })
    };
    let options = PdfOptions {
        page: PageBox {
            width: 240.,
            height: 200.,
            margin: 20.,
        },
        ..Default::default()
    };
    for keep_with_next in [false, true] {
        let input = Document {
            title: String::new(),
            blocks: vec![
                paragraph("One\nTwo\nThree\nFour", false),
                paragraph("Caption", keep_with_next),
                Block::Table {
                    width: None,
                    column_widths: vec![],
                    rows: vec![document_ast_rust::TableRow {
                        header: false,
                        cells: vec![document_ast_rust::TableCell {
                            header: false,
                            blocks: vec![paragraph("First\nSecond\nThird", false)],
                            align: Default::default(),
                            colspan: 1,
                            rowspan: 1,
                        }],
                    }],
                },
            ],
        };
        let layout = layout_document(&input, &options).unwrap();
        let text_page = |needle| {
            layout
                .pages
                .iter()
                .position(|page| {
                    page.paints.iter().any(
                        |paint| matches!(paint,pdf_ast_rust::Paint::Text{text,..}if text==needle),
                    )
                })
                .unwrap()
        };
        assert_eq!(text_page("First"), 1);
        assert_eq!(text_page("Caption"), usize::from(keep_with_next));
    }
}

#[test]
fn absolute_link_schemes_are_case_insensitive_and_unsafe_schemes_fail_explicitly() {
    for target in [
        "MAILTO:FOO@BAR.BAZ",
        "HTTPS://EXAMPLE.COM/path",
        "javascript:alert(1)",
    ] {
        let input = Document {
            title: String::new(),
            blocks: vec![Block::Paragraph(Paragraph {
                inlines: vec![Inline::Text {
                    text: "Link".into(),
                    style: TextStyle {
                        link: Some(target.into()),
                        ..Default::default()
                    },
                }],
                ..Default::default()
            })],
        };
        let result = write_pdf_with_options(&input, &PdfOptions::default());
        if target.starts_with("MAILTO") || target.starts_with("HTTPS") {
            let bytes = result.unwrap();
            assert!(String::from_utf8_lossy(&bytes).contains(&format!("/URI ({target})")));
        } else {
            assert!(result.unwrap_err().contains("unsupported PDF link"));
        }
    }
}

#[test]
fn callout_labels_use_admitted_text_colors() {
    let input = Document {
        title: String::new(),
        blocks: vec![Block::Quote {
            kind: Some("Note".into()),
            blocks: document().blocks,
        }],
    };
    let bytes = write_pdf_with_options(&input, &PdfOptions::default()).unwrap();
    assert!(bytes.starts_with(b"%PDF-1.7"));
}

#[test]
fn measuring_caption_groups_does_not_duplicate_notes() {
    let note = |text: &str| {
        Inline::Note(vec![Block::Paragraph(Paragraph {
            inlines: vec![Inline::Text {
                text: text.into(),
                style: TextStyle::default(),
            }],
            ..Default::default()
        })])
    };
    let input = Document {
        title: String::new(),
        blocks: vec![
            Block::Paragraph(Paragraph {
                keep_with_next: true,
                inlines: vec![note("Caption note")],
                ..Default::default()
            }),
            Block::Table {
                width: None,
                column_widths: vec![],
                rows: vec![document_ast_rust::TableRow {
                    header: false,
                    cells: vec![document_ast_rust::TableCell {
                        header: false,
                        blocks: vec![Block::Paragraph(Paragraph {
                            inlines: vec![note("Cell note")],
                            ..Default::default()
                        })],
                        align: Default::default(),
                        colspan: 1,
                        rowspan: 1,
                    }],
                }],
            },
        ],
    };
    let layout = layout_document(&input, &PdfOptions::default()).unwrap();
    let text = layout
        .pages
        .iter()
        .flat_map(|p| &p.paints)
        .filter_map(|paint| {
            if let pdf_ast_rust::Paint::Text { text, .. } = paint {
                Some(text.as_str())
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    assert_eq!(text.matches("Caption note").count(), 1);
    assert_eq!(text.matches("Cell note").count(), 1);
    assert!(text.contains("[1] Caption note"));
    assert!(text.contains("[2] Cell note"));
}

fn nested_table_document(rows: usize) -> Document {
    use document_ast_rust::{Align, TableCell, TableRow};
    let cell = |text: String, align| TableCell {
        header: false,
        blocks: vec![Block::Paragraph(Paragraph {
            inlines: vec![Inline::Text {
                text,
                style: TextStyle::default(),
            }],
            ..Default::default()
        })],
        align,
        colspan: 1,
        rowspan: 1,
    };
    let mut inner = vec![TableRow {
        header: true,
        cells: vec![
            cell("Left".into(), Align::Left),
            cell("Right".into(), Align::Right),
        ],
    }];
    for row in 0..rows {
        inner.push(TableRow {
            header: false,
            cells: vec![
                cell(format!("A{row}"), Align::Left),
                cell(format!("B{row}"), Align::Right),
            ],
        });
    }
    Document {
        title: String::new(),
        blocks: vec![Block::Table {
            width: None,
            column_widths: vec![],
            rows: vec![TableRow {
                header: false,
                cells: vec![
                    TableCell {
                        header: false,
                        blocks: vec![Block::Table {
                            rows: inner,
                            width: None,
                            column_widths: vec![],
                        }],
                        align: Align::Left,
                        colspan: 1,
                        rowspan: 1,
                    },
                    cell("Side".into(), Align::Left),
                ],
            }],
        }],
    }
}

#[test]
fn nested_tables_preserve_columns_headers_alignment_and_borders() {
    let layout = layout_document(&nested_table_document(1), &PdfOptions::default()).unwrap();
    let location = |needle: &str| {
        layout.pages[0]
            .paints
            .iter()
            .find_map(|paint| {
                if let pdf_ast_rust::Paint::Text {
                    text, x, y, font, ..
                } = paint
                {
                    if text == needle {
                        Some((*x, *y, *font))
                    } else {
                        None
                    }
                } else {
                    None
                }
            })
            .unwrap()
    };
    let (a_x, a_y, _) = location("A0");
    let (b_x, b_y, _) = location("B0");
    let (left_x, left_y, left_font) = location("Left");
    let (right_x, right_y, right_font) = location("Right");
    assert_eq!(a_y, b_y);
    assert_eq!(left_y, right_y);
    assert!(a_y > left_y);
    assert!(
        b_x > a_x + 100.,
        "nested cells must retain separate columns"
    );
    assert_eq!(left_x, a_x);
    assert!(
        b_x > right_x,
        "right edges align despite different text lengths"
    );
    assert_eq!(layout.fonts[left_font].id, "LiberationSans-Bold");
    assert_eq!(layout.fonts[right_font].id, "LiberationSans-Bold");
    assert_eq!(
        layout.pages[0]
            .paints
            .iter()
            .filter(|p| matches!(p, pdf_ast_rust::Paint::Stroke { .. }))
            .count(),
        12,
        "outer and all four nested cell borders survive"
    );
}

#[test]
fn nested_table_rows_paginate_and_repeat_headers_without_losing_cells() {
    let options = PdfOptions {
        page: PageBox {
            width: 300.,
            height: 180.,
            margin: 20.,
        },
        ..Default::default()
    };
    let layout = layout_document(&nested_table_document(12), &options).unwrap();
    assert!(layout.pages.len() > 2);
    let all: Vec<_> = layout
        .pages
        .iter()
        .flat_map(|p| &p.paints)
        .filter_map(|paint| {
            if let pdf_ast_rust::Paint::Text { text, .. } = paint {
                Some(text.as_str())
            } else {
                None
            }
        })
        .collect();
    for row in 0..12 {
        for column in ["A", "B"] {
            let text = format!("{column}{row}");
            assert_eq!(all.iter().filter(|&&s| s == text).count(), 1, "{text}");
        }
    }
    for page in &layout.pages {
        let texts: Vec<_> = page
            .paints
            .iter()
            .filter_map(|paint| {
                if let pdf_ast_rust::Paint::Text { text, y, .. } = paint {
                    assert!(*y < page.height - options.page.margin);
                    Some(text.as_str())
                } else {
                    None
                }
            })
            .collect();
        assert!(
            texts.contains(&"Left") && texts.contains(&"Right"),
            "nested header repeats on continuation pages: {texts:?}"
        );
        for paint in &page.paints {
            if let pdf_ast_rust::Paint::Rect { y, height, .. } = paint {
                assert!(*y + *height <= page.height - options.page.margin + 0.001);
            }
        }
    }
}

#[test]
fn nested_rowspans_keep_their_columns_and_stay_on_the_same_page() {
    let mut input = nested_table_document(3);
    let Block::Table { rows: outer, .. } = &mut input.blocks[0] else {
        panic!()
    };
    let Block::Table { rows: inner, .. } = &mut outer[0].cells[0].blocks[0] else {
        panic!()
    };
    inner[1].cells[0].rowspan = 2;
    inner[2].cells.remove(0);
    let options = PdfOptions {
        page: PageBox {
            width: 300.,
            height: 140.,
            margin: 20.,
        },
        ..Default::default()
    };
    let layout = layout_document(&input, &options).unwrap();
    let location = |needle: &str| {
        layout
            .pages
            .iter()
            .enumerate()
            .find_map(|(page, p)| {
                p.paints.iter().find_map(|paint| {
                    if let pdf_ast_rust::Paint::Text { text, x, y, .. } = paint {
                        (text == needle).then_some((page, *x, *y))
                    } else {
                        None
                    }
                })
            })
            .unwrap()
    };
    let a = location("A0");
    let b = location("B0");
    let next = location("B1");
    assert_eq!(a.0, b.0);
    assert_eq!(a.0, next.0);
    assert!(b.1 > a.1 + 20.);
    assert_eq!(b.1, next.1);
    assert!(next.2 > b.2);
    assert!(location("A2").0 > a.0);
}

fn text_block(text: &str) -> Block {
    Block::Paragraph(Paragraph {
        inlines: vec![Inline::Text {
            text: text.into(),
            style: TextStyle::default(),
        }],
        ..Default::default()
    })
}
fn table_cell(blocks: Vec<Block>) -> document_ast_rust::TableCell {
    document_ast_rust::TableCell {
        header: false,
        blocks,
        align: Default::default(),
        colspan: 1,
        rowspan: 1,
    }
}
fn spanned_header_table(prefix: &str, body: Vec<document_ast_rust::TableRow>) -> Block {
    let mut left = table_cell(vec![text_block(&format!("{prefix}-L"))]);
    left.rowspan = 2;
    let mut rows = vec![
        document_ast_rust::TableRow {
            header: true,
            cells: vec![left, table_cell(vec![text_block(&format!("{prefix}-R"))])],
        },
        document_ast_rust::TableRow {
            header: true,
            cells: vec![table_cell(vec![text_block(&format!("{prefix}-S"))])],
        },
    ];
    rows.extend(body);
    Block::Table {
        rows,
        width: None,
        column_widths: vec![],
    }
}
#[test]
fn deep_nested_headers_stay_with_body_and_repeat_at_every_ancestor_level() {
    let inner = spanned_header_table(
        "INNER",
        (0..3)
            .map(|row| document_ast_rust::TableRow {
                header: false,
                cells: ["L", "R"]
                    .iter()
                    .map(|column| {
                        table_cell(vec![
                            text_block(&format!("ITEM{row}{column}")),
                            text_block(&format!("END{row}{column}")),
                        ])
                    })
                    .collect(),
            })
            .collect(),
    );
    let middle = spanned_header_table(
        "MIDDLE",
        vec![document_ast_rust::TableRow {
            header: false,
            cells: vec![
                table_cell(vec![text_block("BEFORE"), inner, text_block("AFTER")]),
                table_cell(vec![text_block("SIDEBODY")]),
            ],
        }],
    );
    let input = Document {
        title: String::new(),
        blocks: vec![Block::Table {
            rows: vec![
                document_ast_rust::TableRow {
                    header: true,
                    cells: vec![table_cell(vec![text_block("OUTER")])],
                },
                document_ast_rust::TableRow {
                    header: false,
                    cells: vec![table_cell(vec![middle])],
                },
            ],
            width: None,
            column_widths: vec![],
        }],
    };
    let options = PdfOptions {
        page: PageBox {
            width: 595.28,
            height: 360.,
            margin: 30.,
        },
        ..Default::default()
    };
    let layout = layout_document(&input, &options).unwrap();
    assert!(layout.pages.len() > 1);
    let mut all = Vec::new();
    for page in &layout.pages {
        let text: Vec<_> = page
            .paints
            .iter()
            .filter_map(|p| {
                if let pdf_ast_rust::Paint::Text { text, y, .. } = p {
                    assert!(*y <= page.height - options.page.margin);
                    Some(text.as_str())
                } else {
                    None
                }
            })
            .collect();
        assert!(
            text.iter()
                .any(|s| s.starts_with("ITEM") || ["BEFORE", "AFTER", "SIDEBODY"].contains(s)),
            "header-only page: {text:?}"
        );
        for header in ["OUTER", "MIDDLE-L", "MIDDLE-R", "MIDDLE-S"] {
            assert!(text.contains(&header), "missing {header}: {text:?}");
        }
        if text.iter().any(|s| s.starts_with("ITEM")) {
            for header in ["INNER-L", "INNER-R", "INNER-S"] {
                assert!(text.contains(&header), "missing {header}: {text:?}");
            }
        }
        all.extend(text);
    }
    for row in 0..3 {
        for column in ["L", "R"] {
            for prefix in ["ITEM", "END"] {
                let label = format!("{prefix}{row}{column}");
                assert_eq!(all.iter().filter(|&&s| s == label).count(), 1, "{label}");
            }
        }
    }
}
#[test]
fn ordinary_nested_cell_paragraphs_split_across_pages_without_losing_words() {
    let words = (0..150).map(|i| format!("word{i:03}")).collect::<Vec<_>>();
    let mut block = text_block(&format!("BEGIN {} END", words.join(" ")));
    for _ in 0..2 {
        block = Block::Table {
            rows: vec![document_ast_rust::TableRow {
                header: false,
                cells: vec![table_cell(vec![block])],
            }],
            width: None,
            column_widths: vec![],
        };
    }
    let input = Document {
        title: String::new(),
        blocks: vec![block],
    };
    let options = PdfOptions {
        page: PageBox {
            width: 595.28,
            height: 200.,
            margin: 30.,
        },
        ..Default::default()
    };
    let layout = layout_document(&input, &options).unwrap();
    assert!(layout.pages.len() > 1);
    let text = layout
        .pages
        .iter()
        .flat_map(|p| &p.paints)
        .filter_map(|p| {
            if let pdf_ast_rust::Paint::Text { text, .. } = p {
                Some(text.as_str())
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    let extracted: Vec<_> = text.split_whitespace().collect();
    let expected = std::iter::once("BEGIN")
        .chain(words.iter().map(String::as_str))
        .chain(std::iter::once("END"))
        .collect::<Vec<_>>();
    assert_eq!(extracted, expected);
}

#[test]
fn caption_keeps_with_the_first_fragment_of_a_row_taller_than_a_page() {
    let options = PdfOptions {
        page: PageBox {
            width: 240.,
            height: 200.,
            margin: 20.,
        },
        ..Default::default()
    };
    let mut caption = match text_block("Caption") {
        Block::Paragraph(p) => p,
        _ => unreachable!(),
    };
    caption.keep_with_next = true;
    let mut input = Document {
        title: String::new(),
        blocks: vec![
            text_block("One\nTwo\nThree\nFour\nFive"),
            Block::Paragraph(caption),
            Block::Table {
                rows: vec![document_ast_rust::TableRow {
                    header: false,
                    cells: vec![table_cell(vec![text_block(
                        &(0..20)
                            .map(|i| format!("Row{i:03}"))
                            .collect::<Vec<_>>()
                            .join("\n"),
                    )])],
                }],
                width: None,
                column_widths: vec![],
            },
        ],
    };
    let layout = layout_document(&input, &options).unwrap();
    let page_of = |needle| {
        layout
            .pages
            .iter()
            .position(|page| {
                page.paints
                    .iter()
                    .any(|paint| matches!(paint,pdf_ast_rust::Paint::Text{text,..}if text==needle))
            })
            .unwrap()
    };
    assert_eq!(page_of("Caption"), page_of("Row000"));
    assert!(page_of("Caption") > page_of("One"));
    if let Block::Paragraph(p) = &mut input.blocks[1] {
        p.keep_with_next = false;
    }
    let ordinary = layout_document(&input, &options).unwrap();
    assert!(
        ordinary.pages[0]
            .paints
            .iter()
            .any(|paint| matches!(paint,pdf_ast_rust::Paint::Text{text,..}if text=="Caption"))
    );
    assert!(
        !ordinary.pages[0]
            .paints
            .iter()
            .any(|paint| matches!(paint,pdf_ast_rust::Paint::Text{text,..}if text=="Row000"))
    );
}

#[test]
fn nested_header_preflight_matches_row_fragmentation_near_page_bottom() {
    use document_ast_rust::TableRow;
    for line_height in [1.2, 1.65] {
        for paragraphs in [6, 7, 8] {
            for columns in [1, 3] {
                let mut inner_rows = vec![TableRow {
                    header: true,
                    cells: ["LEFT", "MIDDLE", "RIGHT"]
                        .iter()
                        .take(columns)
                        .map(|s| table_cell(vec![text_block(s)]))
                        .collect(),
                }];
                for row in 0..6 {
                    inner_rows.push(TableRow {
                        header: false,
                        cells: (0..columns)
                            .map(|column| {
                                table_cell(vec![
                                    text_block(&format!("BODY{row}{column}")),
                                    text_block(&format!("END{row}{column}")),
                                ])
                            })
                            .collect(),
                    });
                }
                let inner = Block::Table {
                    rows: inner_rows,
                    width: None,
                    column_widths: vec![],
                };
                let mut blocks = (0..paragraphs)
                    .map(|i| {
                        text_block(&format!(
                            "Introductory paragraph {i}. Content before the nested table."
                        ))
                    })
                    .collect::<Vec<_>>();
                blocks.push(Block::Table {
                    rows: vec![
                        TableRow {
                            header: true,
                            cells: vec![table_cell(vec![text_block("OUTER")])],
                        },
                        TableRow {
                            header: false,
                            cells: vec![table_cell(vec![inner])],
                        },
                    ],
                    width: None,
                    column_widths: vec![],
                });
                let options = PdfOptions {
                    page: PageBox {
                        width: 595.28,
                        height: 360.,
                        margin: 30.,
                    },
                    line_height,
                    ..Default::default()
                };
                let layout = layout_document(
                    &Document {
                        title: String::new(),
                        blocks,
                    },
                    &options,
                )
                .unwrap();
                for (page_index, page) in layout.pages.iter().enumerate() {
                    let text = page
                        .paints
                        .iter()
                        .filter_map(|paint| {
                            if let pdf_ast_rust::Paint::Text { text, .. } = paint {
                                Some(text.as_str())
                            } else {
                                None
                            }
                        })
                        .collect::<Vec<_>>();
                    if text.contains(&"OUTER") {
                        assert!(
                            text.iter().any(|s| s.starts_with("BODY")),
                            "header-only page {page_index}, {paragraphs} paragraphs, line-height {line_height}: {text:?}"
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn relative_uri_references_survive_pdf_export_without_an_invented_base() {
    for target in [
        "README.md",
        "../notes/related.md",
        "./my notes.md",
        "/docs/readme.md",
        "//example.com/docs",
        "?view=print",
        "README.md#section",
        "?next=https://example.com",
        "notes/part:two.md",
        "résumé.md",
        "notes%20and%20drafts.md",
    ] {
        let input = Document {
            title: String::new(),
            blocks: vec![Block::Paragraph(Paragraph {
                inlines: vec![Inline::Text {
                    text: "Related note".into(),
                    style: TextStyle {
                        link: Some(target.into()),
                        ..Default::default()
                    },
                }],
                ..Default::default()
            })],
        };
        let bytes = write_pdf_with_options(&input, &PdfOptions::default()).unwrap();
        let raw = String::from_utf8_lossy(&bytes);
        assert!(
            raw.contains(&format!("/URI ({target})")),
            "relative URI was not preserved: {target}"
        );
        assert!(
            !raw.contains("/Base "),
            "the caller's document location must remain authoritative"
        );
    }
}

#[test]
fn uri_admission_rejects_dangerous_schemes_and_raw_control_characters() {
    for target in [
        "javascript:alert(1)",
        "JaVaScRiPt:alert(1)",
        "file:///etc/passwd",
        "data:text/html,hello",
        "vbscript:hello",
        " javascript:alert(1)",
        "java\tscript:alert(1)",
        "1:invalid",
        "README.md\n",
        "README.md\0",
        "#heading\r",
        "notes/\u{7f}readme.md",
    ] {
        let mut input = document();
        input.blocks.push(Block::Paragraph(Paragraph {
            inlines: vec![Inline::Text {
                text: "Unsafe".into(),
                style: TextStyle {
                    link: Some(target.into()),
                    ..Default::default()
                },
            }],
            ..Default::default()
        }));
        assert!(
            write_pdf_with_options(&input, &PdfOptions::default())
                .unwrap_err()
                .contains("PDF link"),
            "unsafe URI accepted: {target:?}"
        );
    }
}

fn bullet_item(blocks: Vec<Block>) -> Block {
    Block::List {
        start: None,
        style: Default::default(),
        delimiter: Default::default(),
        items: vec![blocks],
    }
}
fn one_cell_table(blocks: Vec<Block>) -> Block {
    Block::Table {
        rows: vec![document_ast_rust::TableRow {
            header: false,
            cells: vec![table_cell(blocks)],
        }],
        width: None,
        column_widths: vec![],
    }
}
#[test]
fn table_first_cell_list_items_keep_nested_rows_splittable() {
    let words = (0..150).map(|i| format!("word{i:03}")).collect::<Vec<_>>();
    let input = Document {
        title: String::new(),
        blocks: vec![one_cell_table(vec![bullet_item(vec![one_cell_table(
            vec![text_block(&words.join(" "))],
        )])])],
    };
    let options = PdfOptions {
        page: PageBox {
            width: 300.,
            height: 200.,
            margin: 20.,
        },
        ..Default::default()
    };
    let layout = layout_document(&input, &options).unwrap();
    assert!(layout.pages.len() > 1);
    let text = layout
        .pages
        .iter()
        .flat_map(|page| &page.paints)
        .filter_map(|paint| {
            if let pdf_ast_rust::Paint::Text { text, .. } = paint {
                Some(text.as_str())
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    assert_eq!(text.matches('•').count(), 1);
    assert_eq!(
        text.split_whitespace()
            .filter(|s| s.starts_with("word"))
            .collect::<Vec<_>>(),
        words.iter().map(String::as_str).collect::<Vec<_>>()
    );
}
#[test]
fn table_first_cell_list_markers_align_with_the_first_text_line() {
    let input = Document {
        title: String::new(),
        blocks: vec![one_cell_table(vec![bullet_item(vec![one_cell_table(
            vec![text_block("First\nSecond\nThird")],
        )])])],
    };
    let layout = layout_document(&input, &PdfOptions::default()).unwrap();
    let baseline = |needle: &str| {
        layout.pages[0]
            .paints
            .iter()
            .find_map(|paint| {
                if let pdf_ast_rust::Paint::Text { text, y, .. } = paint {
                    (text.trim() == needle).then_some(*y)
                } else {
                    None
                }
            })
            .unwrap()
    };
    assert_eq!(baseline("•"), baseline("First"));
}
#[test]
fn list_markers_follow_leading_headings_and_tables_across_page_breaks() {
    let heading = Block::Heading {
        level: 1,
        id: "heading".into(),
        inlines: vec![Inline::Text {
            text: "Heading first".into(),
            style: TextStyle::default(),
        }],
    };
    let table = one_cell_table(vec![text_block("First\nSecond\nThird\nFourth\nFifth")]);
    let options = PdfOptions {
        page: PageBox {
            width: 300.,
            height: 200.,
            margin: 20.,
        },
        ..Default::default()
    };
    for (block, label) in [(heading, "Heading first"), (table, "First")] {
        let input = Document {
            title: String::new(),
            blocks: vec![
                text_block("One"),
                text_block("Two"),
                text_block("Three"),
                text_block("Four"),
                text_block("Five"),
                bullet_item(vec![block]),
            ],
        };
        let layout = layout_document(&input, &options).unwrap();
        let location = |needle: &str| {
            layout
                .pages
                .iter()
                .enumerate()
                .find_map(|(index, page)| {
                    page.paints.iter().find_map(|paint| {
                        if let pdf_ast_rust::Paint::Text { text, y, .. } = paint {
                            (text.trim() == needle).then_some((index, *y))
                        } else {
                            None
                        }
                    })
                })
                .unwrap()
        };
        assert_eq!(
            location("•"),
            location(label),
            "marker must travel with and align to {label}"
        );
        assert!(location(label).0 > 0);
    }
}

#[test]
fn list_table_continuations_keep_indent_and_repeat_headers_without_markers() {
    let mut source = nested_table_document(12);
    let Block::Table { rows, .. } = &mut source.blocks[0] else {
        panic!()
    };
    let inner = rows[0].cells[0].blocks.remove(0);
    let input = Document {
        title: String::new(),
        blocks: vec![one_cell_table(vec![bullet_item(vec![inner])])],
    };
    let options = PdfOptions {
        page: PageBox {
            width: 300.,
            height: 180.,
            margin: 20.,
        },
        ..Default::default()
    };
    let layout = layout_document(&input, &options).unwrap();
    assert!(layout.pages.len() > 2);
    let mut first_x = None;
    let mut markers = 0;
    for page in &layout.pages {
        let mut header = None;
        for paint in &page.paints {
            if let pdf_ast_rust::Paint::Text { text, x, .. } = paint {
                if text.trim() == "•" {
                    markers += 1;
                }
                if text == "Left" {
                    header = Some(*x);
                }
            }
        }
        let x = header.expect("nested header repeats");
        assert_eq!(
            *first_x.get_or_insert(x),
            x,
            "list indent survives continuation"
        );
    }
    assert_eq!(markers, 1);
}

#[test]
fn list_markers_keep_the_text_baseline_when_an_item_starts_with_script() {
    for sup in [false, true] {
        for heading in [false, true] {
            let inlines = vec![
                Inline::Text {
                    text: "script".into(),
                    style: TextStyle {
                        sup,
                        sub: !sup,
                        ..Default::default()
                    },
                },
                Inline::Text {
                    text: " baseline".into(),
                    style: TextStyle::default(),
                },
            ];
            let block = if heading {
                Block::Heading {
                    level: 1,
                    id: String::new(),
                    inlines,
                }
            } else {
                Block::Paragraph(Paragraph {
                    inlines,
                    ..Default::default()
                })
            };
            let input = Document {
                title: String::new(),
                blocks: vec![bullet_item(vec![block])],
            };
            let layout = layout_document(&input, &PdfOptions::default()).unwrap();
            let baseline = |label: &str| {
                layout.pages[0]
                    .paints
                    .iter()
                    .find_map(|paint| {
                        if let pdf_ast_rust::Paint::Text { text, y, .. } = paint {
                            (text.trim() == label).then_some(*y)
                        } else {
                            None
                        }
                    })
                    .unwrap()
            };
            assert!(
                (baseline("•") - baseline("baseline")).abs() < 0.001,
                "marker follows the paragraph baseline, not the script offset: sup={sup}, heading={heading}"
            );
        }
    }
}

#[test]
fn cell_paragraph_and_heading_ids_create_destinations_and_links() {
    let mut paragraph = match text_block("Paragraph target") {
        Block::Paragraph(p) => p,
        _ => unreachable!(),
    };
    paragraph.id = "paragraph-target".into();
    let heading = Block::Heading {
        level: 2,
        id: "heading-target".into(),
        inlines: vec![Inline::Text {
            text: "Heading target".into(),
            style: TextStyle::default(),
        }],
    };
    let links = Block::Paragraph(Paragraph {
        inlines: ["paragraph-target", "heading-target"]
            .iter()
            .map(|id| Inline::Text {
                text: format!("Jump {id} "),
                style: TextStyle {
                    link: Some(format!("#{id}")),
                    ..Default::default()
                },
            })
            .collect(),
        ..Default::default()
    });
    let input = Document {
        title: String::new(),
        blocks: vec![
            links,
            one_cell_table(vec![Block::Paragraph(paragraph), heading]),
        ],
    };
    let options = PdfOptions::default();
    let layout = layout_document(&input, &options).unwrap();
    for (id, label) in [
        ("paragraph-target", "Paragraph target"),
        ("heading-target", "Heading target"),
    ] {
        let (page, y) = layout
            .anchors
            .get(id)
            .copied()
            .expect("cell ID becomes an actual destination");
        let painted = layout.pages[page]
            .paints
            .iter()
            .find_map(|paint| {
                if let pdf_ast_rust::Paint::Text { text, y, size, .. } = paint {
                    (text == label).then_some(*y - *size)
                } else {
                    None
                }
            })
            .unwrap();
        assert_eq!(y, painted, "destination follows the painted cell content");
    }
    let bytes = serialize_pdf(&layout, &options.limits).unwrap();
    assert_eq!(
        String::from_utf8_lossy(&bytes).matches("/Dest [").count(),
        2
    );
}
#[test]
fn nested_repeated_header_ids_stay_at_the_first_actual_fragment() {
    let mut input = nested_table_document(12);
    let Block::Table { rows: outer, .. } = &mut input.blocks[0] else {
        panic!()
    };
    let Block::Table { rows: inner, .. } = &mut outer[0].cells[0].blocks[0] else {
        panic!()
    };
    let Block::Paragraph(p) = &mut inner[0].cells[0].blocks[0] else {
        panic!()
    };
    p.id = "nested-header".into();
    let link = Block::Paragraph(Paragraph {
        inlines: vec![Inline::Text {
            text: "Jump".into(),
            style: TextStyle {
                link: Some("#nested-header".into()),
                ..Default::default()
            },
        }],
        ..Default::default()
    });
    input.blocks.splice(
        0..0,
        [
            link,
            text_block("One"),
            text_block("Two"),
            text_block("Three"),
            text_block("Four"),
        ],
    );
    let options = PdfOptions {
        page: PageBox {
            width: 300.,
            height: 180.,
            margin: 20.,
        },
        ..Default::default()
    };
    let layout = layout_document(&input, &options).unwrap();
    let locations = layout
        .pages
        .iter()
        .enumerate()
        .flat_map(|(page, p)| {
            p.paints.iter().filter_map(move |paint| {
                if let pdf_ast_rust::Paint::Text { text, y, size, .. } = paint {
                    (text == "Left").then_some((page, *y - *size))
                } else {
                    None
                }
            })
        })
        .collect::<Vec<_>>();
    assert!(locations.len() > 1);
    assert!(locations[0].0 > 0);
    assert_eq!(layout.anchors.get("nested-header"), Some(&locations[0]));
    let bytes = serialize_pdf(&layout, &options.limits).unwrap();
    assert_eq!(
        String::from_utf8_lossy(&bytes).matches("/Dest [").count(),
        1
    );
}
#[test]
fn anchor_only_paragraphs_follow_heading_and_code_page_breaks() {
    let heading = Block::Heading {
        level: 1,
        id: "heading".into(),
        inlines: vec![Inline::Text {
            text: "Heading target".into(),
            style: TextStyle::default(),
        }],
    };
    let code = Block::Code {
        language: String::new(),
        text: "First code line\nSecond code line\nThird code line".into(),
    };
    let options = PdfOptions {
        page: PageBox {
            width: 300.,
            height: 200.,
            margin: 20.,
        },
        ..Default::default()
    };
    for (target, label, count) in [(heading, "Heading target", 5), (code, "First code line", 5)] {
        let mut blocks = (0..count)
            .map(|i| text_block(&format!("Before {i}")))
            .collect::<Vec<_>>();
        blocks.push(Block::Paragraph(Paragraph {
            inlines: vec![Inline::Anchor("target".into())],
            ..Default::default()
        }));
        blocks.push(target);
        let layout = layout_document(
            &Document {
                title: String::new(),
                blocks,
            },
            &options,
        )
        .unwrap();
        let actual = layout
            .pages
            .iter()
            .enumerate()
            .find_map(|(page, p)| {
                p.paints.iter().find_map(|paint| {
                    if let pdf_ast_rust::Paint::Text { text, y, size, .. } = paint {
                        (text == label).then_some((page, *y - *size))
                    } else {
                        None
                    }
                })
            })
            .unwrap();
        let destination = layout.anchors["target"];
        assert_eq!(
            destination.0, actual.0,
            "anchor must follow {label} to its painted page"
        );
        assert!(
            (destination.1 - actual.1).abs() < 2.,
            "anchor must stay near the first painted line"
        );
    }
}

#[test]
fn deferred_anchors_follow_real_list_content_and_resolve_at_document_end() {
    let heading = Block::Heading {
        level: 1,
        id: "heading".into(),
        inlines: vec![Inline::Text {
            text: "Heading target".into(),
            style: TextStyle::default(),
        }],
    };
    let mut blocks = (0..5)
        .map(|i| text_block(&format!("Before {i}")))
        .collect::<Vec<_>>();
    blocks.push(Block::Paragraph(Paragraph {
        inlines: vec![Inline::Anchor("wrapper".into())],
        ..Default::default()
    }));
    blocks.push(bullet_item(vec![heading]));
    blocks.push(Block::Paragraph(Paragraph {
        inlines: vec![Inline::Anchor("terminal".into())],
        ..Default::default()
    }));
    let options = PdfOptions {
        page: PageBox {
            width: 300.,
            height: 200.,
            margin: 20.,
        },
        ..Default::default()
    };
    let layout = layout_document(
        &Document {
            title: String::new(),
            blocks,
        },
        &options,
    )
    .unwrap();
    assert!(layout.anchors["heading"].0 > 0);
    assert_eq!(
        layout.anchors["wrapper"], layout.anchors["heading"],
        "provisional marker painting must not consume the wrapper destination"
    );
    let terminal = layout.anchors["terminal"];
    assert_eq!(terminal.0, layout.pages.len() - 1);
    assert!(terminal.1 > layout.anchors["heading"].1);
}

#[test]
fn trailing_empty_group_and_paragraph_ids_resolve_after_a_table() {
    let mut blocks = vec![one_cell_table(vec![text_block("Final table content")])];
    blocks.push(Block::Quote {
        kind: None,
        blocks: Vec::new(),
    });
    document_ast_rust::anchor_blocks(&mut blocks, 1, "empty-group".into());
    blocks.push(Block::Paragraph(Paragraph {
        id: "terminal".into(),
        ..Default::default()
    }));
    let options = PdfOptions::default();
    let layout = layout_document(
        &Document {
            title: String::new(),
            blocks,
        },
        &options,
    )
    .unwrap();
    assert_eq!(layout.pages.len(), 1);
    assert_eq!(layout.anchors["empty-group"], layout.anchors["terminal"]);
    let (page, y) = layout.anchors["terminal"];
    assert_eq!(page, 0);
    let last_text_y = layout.pages[page]
        .paints
        .iter()
        .filter_map(|paint| match paint {
            pdf_ast_rust::Paint::Text { y, .. } => Some(*y),
            _ => None,
        })
        .fold(0., f64::max);
    assert!(
        y > last_text_y,
        "trailing destinations must follow the table"
    );
}

#[test]
fn cell_wrapper_anchors_do_not_add_space_before_code_rules_or_nested_tables() {
    for block in [
        Block::Code {
            language: String::new(),
            text: "Cell code".into(),
        },
        Block::Rule,
        one_cell_table(vec![text_block("Nested cell")]),
    ] {
        let source = |blocks| Document {
            title: String::new(),
            blocks: vec![one_cell_table(blocks)],
        };
        let options = PdfOptions::default();
        let plain = layout_document(&source(vec![block.clone()]), &options).unwrap();
        let blocks = vec![
            Block::Paragraph(Paragraph {
                inlines: vec![Inline::Anchor("wrapper".into())],
                ..Default::default()
            }),
            block,
            Block::Paragraph(Paragraph {
                id: "terminal".into(),
                ..Default::default()
            }),
        ];
        let anchored = layout_document(&source(blocks), &options).unwrap();
        assert_eq!(
            format!("{:?}", anchored.pages),
            format!("{:?}", plain.pages),
            "a structural cell identifier must not alter painted content or geometry"
        );
        assert_eq!(anchored.anchors["wrapper"].0, 0);
        assert!(anchored.anchors["terminal"].1 > anchored.anchors["wrapper"].1);
    }
}

#[test]
fn anchor_before_empty_list_item_resolves_at_its_visible_marker() {
    let layout = layout_document(
        &Document {
            title: String::new(),
            blocks: vec![
                Block::Paragraph(Paragraph {
                    inlines: vec![Inline::Anchor("empty-list".into())],
                    ..Default::default()
                }),
                bullet_item(Vec::new()),
                text_block("After"),
            ],
        },
        &PdfOptions::default(),
    )
    .unwrap();
    let marker_top = layout.pages[0]
        .paints
        .iter()
        .find_map(|paint| match paint {
            pdf_ast_rust::Paint::Text { text, y, size, .. } if text.trim() == "•" => {
                Some(y - size)
            }
            _ => None,
        })
        .unwrap();
    assert_eq!(layout.anchors["empty-list"], (0, marker_top));
}

#[test]
fn anchor_only_cell_wrapper_survives_nested_table_fragmentation_without_spacing() {
    let nested = one_cell_table(vec![text_block(
        &(0..80).map(|n| format!("Nested {n}\n")).collect::<String>(),
    )]);
    let source = |blocks| Document {
        title: String::new(),
        blocks: vec![text_block("Before"), one_cell_table(blocks)],
    };
    let options = PdfOptions {
        page: PageBox {
            width: 300.,
            height: 180.,
            margin: 20.,
        },
        ..Default::default()
    };
    let plain = layout_document(&source(vec![nested.clone()]), &options).unwrap();
    let anchored = layout_document(
        &source(vec![
            Block::Paragraph(Paragraph {
                id: "nested-wrapper".into(),
                ..Default::default()
            }),
            nested,
        ]),
        &options,
    )
    .unwrap();
    assert!(anchored.pages.len() > 2);
    assert_eq!(
        format!("{:?}", anchored.pages),
        format!("{:?}", plain.pages)
    );
    let first_text = anchored
        .pages
        .iter()
        .enumerate()
        .find_map(|(page, p)| {
            p.paints.iter().find_map(|paint| match paint {
                pdf_ast_rust::Paint::Text { text, y, size, .. } if text == "Nested 0" => {
                    Some((page, y - size))
                }
                _ => None,
            })
        })
        .unwrap();
    let target = anchored.anchors["nested-wrapper"];
    assert_eq!(target.0, first_text.0);
    assert!((first_text.1 - target.1 - 6.).abs() < 0.001);
}

fn text_location(layout: &pdf_ast_rust::PdfDocument, needle: &str) -> (usize, f64, f64) {
    layout
        .pages
        .iter()
        .enumerate()
        .find_map(|(page, p)| {
            p.paints.iter().find_map(|paint| match paint {
                pdf_ast_rust::Paint::Text { text, x, y, .. } if text == needle => {
                    Some((page, *x, *y))
                }
                _ => None,
            })
        })
        .unwrap_or_else(|| panic!("missing text: {needle}"))
}

#[test]
fn cell_rules_paint_between_paragraphs_at_each_nesting_depth() {
    for depth in 1..=3 {
        let mut block = Block::Quote {
            kind: None,
            blocks: vec![
                text_block("Before rule"),
                Block::Paragraph(Paragraph {
                    id: "rule".into(),
                    ..Default::default()
                }),
                Block::Rule,
                text_block("After rule"),
            ],
        };
        for _ in 0..depth {
            block = one_cell_table(vec![block]);
        }
        let options = PdfOptions::default();
        let layout = layout_document(
            &Document {
                title: String::new(),
                blocks: vec![block],
            },
            &options,
        )
        .unwrap();
        let rules = layout.pages[0]
            .paints
            .iter()
            .filter_map(|paint| match paint {
                pdf_ast_rust::Paint::Stroke {
                    x,
                    y,
                    width,
                    weight,
                    color,
                } if *weight == 0.7 && *color == [0.76, 0.78, 0.81] => Some((*x, *y, *width)),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(
            rules.len(),
            1,
            "a horizontal rule must produce one actual stroke"
        );
        let before = text_location(&layout, "Before rule");
        let after = text_location(&layout, "After rule");
        assert_eq!(rules[0].0, before.1);
        assert!(rules[0].1 > before.2 && rules[0].1 < after.2 - 10.);
        assert!(
            (rules[0].2
                - (options.page.width - 2. * options.page.margin - 12. * depth as f64 - 18.))
                .abs()
                < 0.001
        );
        assert_eq!(layout.anchors["rule"].0, 0);
        assert!(
            (rules[0].1 - layout.anchors["rule"].1 - 5. * options.line_height / 2.).abs() < 0.001
        );
    }
}

#[test]
fn cell_quotes_indent_text_markers_and_nested_tables_without_clipping() {
    let quote = |blocks| Block::Quote { kind: None, blocks };
    let layout = layout_document(
        &Document {
            title: String::new(),
            blocks: vec![one_cell_table(vec![
                text_block("Plain"),
                quote(vec![
                    text_block("Quoted"),
                    bullet_item(vec![text_block("Quoted list")]),
                    quote(vec![text_block("Twice")]),
                    one_cell_table(vec![text_block("Nested table")]),
                ]),
                bullet_item(vec![quote(vec![text_block("List quote")])]),
            ])],
        },
        &PdfOptions::default(),
    )
    .unwrap();
    let plain = text_location(&layout, "Plain").1;
    assert_eq!(text_location(&layout, "Quoted").1, plain + 13.);
    assert_eq!(text_location(&layout, "Twice").1, plain + 26.);
    assert_eq!(text_location(&layout, "Nested table").1, plain + 19.);
    let markers = layout.pages[0]
        .paints
        .iter()
        .filter_map(|paint| match paint {
            pdf_ast_rust::Paint::Text { text, x, y, .. } if text.trim() == "•" => Some((*x, *y)),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(markers.len(), 2);
    assert_eq!(markers[0].0, plain + 13.);
    assert_eq!(markers[0].1, text_location(&layout, "Quoted list").2);
    assert_eq!(markers[1].0, plain);
    assert_eq!(markers[1].1, text_location(&layout, "List quote").2);
}

#[test]
fn headings_stay_with_table_headers_and_the_first_body_row() {
    let heading = Block::Heading {
        level: 2,
        id: "table-heading".into(),
        inlines: vec![Inline::Text {
            text: "Tables".into(),
            style: TextStyle::default(),
        }],
    };
    let rows = vec![
        document_ast_rust::TableRow {
            header: true,
            cells: vec![table_cell(vec![text_block("Header\nSecond header line")])],
        },
        document_ast_rust::TableRow {
            header: false,
            cells: vec![table_cell(vec![text_block(
                "First body row\nSecond body line",
            )])],
        },
    ];
    let options = PdfOptions {
        page: PageBox {
            width: 300.,
            height: 250.,
            margin: 20.,
        },
        ..Default::default()
    };
    let layout = layout_document(
        &Document {
            title: String::new(),
            blocks: vec![
                text_block("One"),
                text_block("Two"),
                text_block("Three"),
                text_block("Four"),
                heading,
                Block::Table {
                    rows,
                    width: None,
                    column_widths: vec![],
                },
            ],
        },
        &options,
    )
    .unwrap();
    assert_eq!(
        text_location(&layout, "Tables").0,
        text_location(&layout, "Header").0
    );
    assert_eq!(
        text_location(&layout, "Tables").0,
        text_location(&layout, "First body row").0
    );
}

#[test]
fn wrapped_headings_keep_their_last_line_with_the_first_paragraph_lines() {
    let options = PdfOptions {
        page: PageBox {
            width: 220.,
            height: 220.,
            margin: 20.,
        },
        ..Default::default()
    };
    let layout = layout_document(&Document { title: String::new(), blocks: vec![
        text_block("One"), text_block("Two"), text_block("Three"),
        Block::Heading { level: 2, id: "wrapped".into(), inlines: vec![Inline::Text { text: "A heading with several words that wraps".into(), style: TextStyle::default() }] },
        text_block("Following paragraph starts here and continues for many many words repeated to cover the page and the next page as well. ".repeat(10).as_str()),
    ] }, &options).unwrap();
    let heading_page = layout.anchors["wrapped"].0;
    let first_body_page = layout.pages.iter().position(|p| p.paints.iter().any(|paint| matches!(paint, pdf_ast_rust::Paint::Text { text, .. } if text.starts_with("Following")))).unwrap();
    assert_eq!(heading_page, first_body_page);
    assert!(
        layout.pages.len() > 2,
        "the whole long paragraph must remain splittable"
    );
}

#[test]
fn heading_keeps_with_a_following_image_when_both_fit_a_page() {
    let options = PdfOptions {
        page: PageBox {
            width: 300.,
            height: 260.,
            margin: 20.,
        },
        ..Default::default()
    };
    let layout = layout_document(
        &Document {
            title: String::new(),
            blocks: vec![
                text_block("One"),
                text_block("Two"),
                text_block("Three"),
                Block::Heading {
                    level: 2,
                    id: "image-heading".into(),
                    inlines: vec![Inline::Text {
                        text: "Image".into(),
                        style: TextStyle::default(),
                    }],
                },
                Block::Image(document_ast_rust::Image {
                    bytes: terminal_png_rust::png::encode(2, 2, &[255; 16]).unwrap(),
                    mime: "image/png".into(),
                    width: 120.,
                    height: 180.,
                    alt: String::new(),
                    title: String::new(),
                    link: None,
                }),
            ],
        },
        &options,
    )
    .unwrap();
    let image_page = layout
        .pages
        .iter()
        .position(|p| {
            p.paints
                .iter()
                .any(|paint| matches!(paint, pdf_ast_rust::Paint::Image { .. }))
        })
        .unwrap();
    assert_eq!(layout.anchors["image-heading"].0, image_page);
}

#[test]
fn headings_keep_with_first_content_inside_long_quotes_and_lists() {
    let paragraph = text_block(&(0..60).map(|n| format!("Body {n}\n")).collect::<String>());
    for following in [
        Block::Quote {
            kind: None,
            blocks: vec![paragraph.clone()],
        },
        bullet_item(vec![paragraph]),
    ] {
        let mut blocks = (0..6)
            .map(|n| text_block(&format!("Before {n}")))
            .collect::<Vec<_>>();
        blocks.push(Block::Heading {
            level: 2,
            id: "heading".into(),
            inlines: vec![Inline::Text {
                text: "Heading".into(),
                style: TextStyle::default(),
            }],
        });
        blocks.push(following);
        let layout = layout_document(
            &Document {
                title: String::new(),
                blocks,
            },
            &PdfOptions {
                page: PageBox {
                    width: 300.,
                    height: 250.,
                    margin: 20.,
                },
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(
            layout.anchors["heading"].0,
            text_location(&layout, "Body 0").0
        );
        assert!(layout.pages.len() > 2);
    }
}

#[test]
fn quoted_nested_table_rules_and_markers_survive_fragmentation_and_repeated_headers() {
    let mut body = (0..18)
        .map(|n| text_block(&format!("Row {n}")))
        .collect::<Vec<_>>();
    body.insert(
        9,
        Block::Paragraph(Paragraph {
            id: "body-rule".into(),
            ..Default::default()
        }),
    );
    body.insert(10, Block::Rule);
    let table = Block::Table {
        width: None,
        column_widths: vec![],
        rows: vec![
            document_ast_rust::TableRow {
                header: true,
                cells: vec![table_cell(vec![text_block("Header"), Block::Rule])],
            },
            document_ast_rust::TableRow {
                header: false,
                cells: vec![table_cell(body)],
            },
        ],
    };
    let options = PdfOptions {
        page: PageBox {
            width: 300.,
            height: 180.,
            margin: 20.,
        },
        ..Default::default()
    };
    let layout = layout_document(
        &Document {
            title: String::new(),
            blocks: vec![one_cell_table(vec![Block::Quote {
                kind: None,
                blocks: vec![bullet_item(vec![table])],
            }])],
        },
        &options,
    )
    .unwrap();
    assert!(layout.pages.len() > 2);
    let mut rule_count = 0;
    let mut marker_count = 0;
    let mut header_x = None;
    let (anchor_page, anchor_y) = layout.anchors["body-rule"];
    let mut anchored_rule = false;
    for (page_index, page) in layout.pages.iter().enumerate() {
        let mut page_header = false;
        for paint in &page.paints {
            match paint {
                pdf_ast_rust::Paint::Text { text, x, .. } if text == "Header" => {
                    assert_eq!(*header_x.get_or_insert(*x), *x);
                    page_header = true;
                }
                pdf_ast_rust::Paint::Text { text, x, .. } if text.trim() == "•" => {
                    marker_count += 1;
                    assert_eq!(*x, options.page.margin + 6. + 13.);
                }
                pdf_ast_rust::Paint::Stroke {
                    x,
                    y,
                    width,
                    weight,
                    ..
                } if *weight == 0.7 => {
                    rule_count += 1;
                    assert!(*x >= options.page.margin + 25.);
                    assert!(*x + *width <= options.page.width - options.page.margin - 17. + 0.001);
                    assert!(
                        *y >= options.page.margin
                            && *y <= options.page.height - options.page.margin
                    );
                    if page_index == anchor_page
                        && (*y - anchor_y - 5. * options.line_height / 2.).abs() < 0.001
                    {
                        anchored_rule = true;
                    }
                }
                _ => {}
            }
        }
        assert!(
            page_header,
            "header and its rule must repeat on each continuation page"
        );
    }
    assert_eq!(rule_count, layout.pages.len() + 1);
    assert_eq!(marker_count, 1);
    assert!(anchored_rule);
    for n in 0..18 {
        text_location(&layout, &format!("Row {n}"));
    }
}

#[test]
fn nested_cell_quotes_wrap_inside_their_reduced_width() {
    let words = (0..120).map(|n| format!("word{n}")).collect::<Vec<_>>();
    let options = PdfOptions {
        page: PageBox {
            width: 240.,
            height: 200.,
            margin: 20.,
        },
        ..Default::default()
    };
    let layout = layout_document(
        &Document {
            title: String::new(),
            blocks: vec![one_cell_table(vec![Block::Quote {
                kind: None,
                blocks: vec![Block::Quote {
                    kind: None,
                    blocks: vec![text_block(&words.join(" "))],
                }],
            }])],
        },
        &options,
    )
    .unwrap();
    assert!(layout.pages.len() > 2);
    let mut rendered = Vec::new();
    for page in &layout.pages {
        for paint in &page.paints {
            if let pdf_ast_rust::Paint::Text {
                text,
                x,
                y,
                size,
                font,
                ..
            } = paint
            {
                let face = terminal_png_rust::font::Font::new(&layout.fonts[*font].bytes).unwrap();
                let width = text
                    .chars()
                    .map(|c| {
                        face.advance(face.glyph_index(c as u32)).unwrap() as f64 * size
                            / face.units_per_em() as f64
                    })
                    .sum::<f64>();
                assert!((*x - (options.page.margin + 6. + 26.)).abs() < 0.001);
                assert!(*x + width <= options.page.width - options.page.margin - 16. + 0.001);
                assert!(*y <= options.page.height - options.page.margin - 6. + 0.001);
                rendered.extend(text.split_whitespace().map(str::to_owned));
            }
        }
    }
    assert_eq!(rendered, words);
}

#[test]
fn heading_keeps_with_first_fragment_of_a_table_taller_than_a_page() {
    let options = PdfOptions {
        page: PageBox {
            width: 240.,
            height: 200.,
            margin: 20.,
        },
        ..Default::default()
    };
    let table = one_cell_table(vec![text_block(
        &(0..40).map(|n| format!("Body {n}\n")).collect::<String>(),
    )]);
    let layout = layout_document(
        &Document {
            title: String::new(),
            blocks: vec![
                text_block("One"),
                text_block("Two"),
                text_block("Three"),
                text_block("Four"),
                Block::Heading {
                    level: 2,
                    id: "heading".into(),
                    inlines: vec![Inline::Text {
                        text: "Table".into(),
                        style: TextStyle::default(),
                    }],
                },
                table,
            ],
        },
        &options,
    )
    .unwrap();
    assert_eq!(
        layout.anchors["heading"].0,
        text_location(&layout, "Body 0").0
    );
    assert!(layout.pages.len() > 3);
    text_location(&layout, "Body 39");
}

#[test]
fn heading_measurement_includes_heading_spacing_inside_quotes_and_lists() {
    let heading = |id: &str| Block::Heading {
        level: 2,
        id: id.into(),
        inlines: vec![Inline::Text {
            text: id.into(),
            style: TextStyle::default(),
        }],
    };
    for list in [false, true] {
        let inner = vec![heading("Inner"), one_cell_table(vec![text_block("Body")])];
        let wrapper = if list {
            bullet_item(inner)
        } else {
            Block::Quote {
                kind: None,
                blocks: inner,
            }
        };
        let layout = layout_document(
            &Document {
                title: String::new(),
                blocks: vec![
                    text_block("One"),
                    text_block("Two"),
                    text_block("Three"),
                    text_block("Four"),
                    heading("Outer"),
                    wrapper,
                ],
            },
            &PdfOptions {
                page: PageBox {
                    width: 300.,
                    height: 250.,
                    margin: 20.,
                },
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(
            text_location(&layout, "Outer").0,
            text_location(&layout, "Body").0
        );
    }
}

#[test]
fn quote_insets_are_respected_by_cell_alignment_and_table_continuations() {
    use document_ast_rust::Align;
    for (align, shift) in [(Align::Left, 13.), (Align::Center, 4.), (Align::Right, -5.)] {
        let source = |quote| {
            let mut cell = table_cell(vec![if quote {
                Block::Quote {
                    kind: None,
                    blocks: vec![text_block("Text")],
                }
            } else {
                text_block("Text")
            }]);
            cell.align = align;
            Document {
                title: String::new(),
                blocks: vec![Block::Table {
                    width: None,
                    column_widths: vec![],
                    rows: vec![document_ast_rust::TableRow {
                        header: false,
                        cells: vec![cell],
                    }],
                }],
            }
        };
        let plain = layout_document(&source(false), &PdfOptions::default()).unwrap();
        let quoted = layout_document(&source(true), &PdfOptions::default()).unwrap();
        assert!(
            (text_location(&quoted, "Text").1 - text_location(&plain, "Text").1 - shift).abs()
                < 0.001
        );
        let table = Block::Table {
            width: None,
            column_widths: vec![],
            rows: vec![
                document_ast_rust::TableRow {
                    header: true,
                    cells: vec![table_cell(vec![text_block("Header")])],
                },
                document_ast_rust::TableRow {
                    header: false,
                    cells: vec![table_cell(vec![text_block(
                        &(0..30).map(|n| format!("Body {n}\n")).collect::<String>(),
                    )])],
                },
            ],
        };
        let mut cell = table_cell(vec![Block::Quote {
            kind: None,
            blocks: vec![table],
        }]);
        cell.align = align;
        let layout = layout_document(
            &Document {
                title: String::new(),
                blocks: vec![Block::Table {
                    width: None,
                    column_widths: vec![],
                    rows: vec![document_ast_rust::TableRow {
                        header: false,
                        cells: vec![cell],
                    }],
                }],
            },
            &PdfOptions {
                page: PageBox {
                    width: 300.,
                    height: 180.,
                    margin: 20.,
                },
                ..Default::default()
            },
        )
        .unwrap();
        assert!(layout.pages.len() > 2);
        for page in &layout.pages {
            let x = page
                .paints
                .iter()
                .find_map(|paint| match paint {
                    pdf_ast_rust::Paint::Text { text, x, .. } if text == "Header" => Some(*x),
                    _ => None,
                })
                .unwrap();
            assert!(
                (x - 45.).abs() < 0.001,
                "quote margins must survive splitting and repeated headers"
            );
        }
    }
}

#[test]
fn oversized_heading_chains_still_keep_the_last_heading_with_body_content() {
    let mut blocks = (0..4)
        .map(|n| Block::Heading {
            level: 2,
            id: format!("heading{n}"),
            inlines: vec![Inline::Text {
                text: format!("Heading {n}"),
                style: TextStyle::default(),
            }],
        })
        .collect::<Vec<_>>();
    blocks.push(text_block("Body"));
    let layout = layout_document(
        &Document {
            title: String::new(),
            blocks,
        },
        &PdfOptions {
            page: PageBox {
                width: 300.,
                height: 200.,
                margin: 20.,
            },
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        layout.anchors["heading3"].0,
        text_location(&layout, "Body").0
    );
}

#[test]
fn heading_image_groups_drop_the_heading_gap_when_moving_to_a_fresh_page() {
    for (count, image_height) in [(1, 168.), (4, 96.)] {
        let mut blocks = vec![text_block("Before")];
        blocks.extend((0..count).map(|n| Block::Heading {
            level: 2,
            id: format!("heading{n}"),
            inlines: vec![Inline::Text {
                text: format!("Heading {n}"),
                style: TextStyle::default(),
            }],
        }));
        blocks.push(Block::Image(document_ast_rust::Image {
            bytes: terminal_png_rust::png::encode(2, 2, &[255; 16]).unwrap(),
            mime: "image/png".into(),
            width: 120.,
            height: image_height,
            alt: String::new(),
            title: String::new(),
            link: None,
        }));
        let layout = layout_document(
            &Document {
                title: String::new(),
                blocks,
            },
            &PdfOptions {
                page: PageBox {
                    width: 300.,
                    height: 200.,
                    margin: 20.,
                },
                ..Default::default()
            },
        )
        .unwrap();
        let image_page = layout
            .pages
            .iter()
            .position(|p| {
                p.paints
                    .iter()
                    .any(|paint| matches!(paint, pdf_ast_rust::Paint::Image { .. }))
            })
            .unwrap();
        assert!(image_page > 0);
        assert_eq!(
            layout.anchors[&format!("heading{}", count - 1)].0,
            image_page
        );
    }
}

#[test]
fn oversized_heading_chain_lookahead_stops_after_one_page_of_work() {
    use std::{
        future::Future,
        pin::pin,
        task::{Context, Poll, Waker},
    };
    let work = |count| {
        let mut blocks = (0..count)
            .map(|_| Block::Heading {
                level: 2,
                id: String::new(),
                inlines: vec![Inline::Text {
                    text: "Heading".into(),
                    style: TextStyle::default(),
                }],
            })
            .collect::<Vec<_>>();
        blocks.push(text_block("Body"));
        let source = Document {
            title: String::new(),
            blocks,
        };
        let options = PdfOptions {
            page: PageBox {
                width: 300.,
                height: 200.,
                margin: 20.,
            },
            ..Default::default()
        };
        let mut future = pin!(pdf_ast_rust::layout_document_async(&source, &options));
        let mut context = Context::from_waker(Waker::noop());
        let mut yields = 0;
        loop {
            match future.as_mut().poll(&mut context) {
                Poll::Pending => yields += 1,
                Poll::Ready(result) => {
                    result.unwrap();
                    break;
                }
            }
        }
        yields
    };
    let small = work(48);
    let large = work(96);
    assert!(
        large < small * 3,
        "doubling a heading chain should not quadruple measurement work: {small} -> {large}"
    );
}
