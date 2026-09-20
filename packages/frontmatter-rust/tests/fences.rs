use frontmatter_rust::{Inspection, inspect, line_position, line_starts, normalize_line_endings};
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
#[test]
fn yaml_eof_diagnostics_point_at_previous_source_line_without_collapsing_crlf() {
    use frontmatter_rust::diagnostic_offset;
    assert_eq!(diagnostic_offset(&u("title: ok\nitems: [broken\n"), 25), 10);
    assert_eq!(
        diagnostic_offset(&u("title: ok\r\nitems: [broken\r\n"), 27),
        11
    );
    assert_eq!(diagnostic_offset(&u("first\rsecond\r"), 13), 6);
    assert_eq!(diagnostic_offset(&u("title: ok\n"), 3), 3);
    assert_eq!(diagnostic_offset(&u("no break"), 10), 10);
}
#[test]
fn fences_preserve_bom_utf16_offsets_body_and_every_line_ending() {
    for ending in ["\n", "\r\n", "\r"] {
        let source = u(&format!(
            "\u{feff}--- \t{ending}title: 😀{ending}--- \t{ending}Body{ending}Text"
        ));
        let Inspection::Frontmatter {
            raw_start,
            raw_end,
            body_start,
        } = inspect(&source)
        else {
            panic!()
        };
        assert_eq!(
            &source[raw_start..raw_end],
            u(&format!("title: 😀{ending}"))
        );
        assert_eq!(&source[body_start..], u(&format!("Body{ending}Text")));
        assert_eq!(line_position(&line_starts(&source), body_start), (4, 1));
    }
}
#[test]
fn absent_opening_and_missing_closing_fences_keep_distinct_outcomes() {
    for source in [
        "---",
        "----\ntitle: example\n---",
        " \n---\na: b\n---",
        "---#comment\na: b\n---",
    ] {
        assert_eq!(inspect(&u(source)), Inspection::Body);
    }
    assert_eq!(
        inspect(&u("---\nhello")),
        Inspection::Missing {
            raw_start: 4,
            raw_end: 9
        }
    );
    assert_eq!(
        inspect(&u("---\n---")),
        Inspection::Frontmatter {
            raw_start: 4,
            raw_end: 4,
            body_start: 7
        }
    );
}
#[test]
fn source_line_positions_and_yaml_normalization_match_js_units() {
    assert_eq!(line_starts(&u("😀\r\na\rb\n")), [0, 4, 6, 8]);
    assert_eq!(line_position(&[0, 4, 6, 8], 3), (1, 4));
    assert_eq!(line_position(&[], 2), (0, 2));
    assert_eq!(normalize_line_endings(&u("a\rb\r\nc\n")), u("a\nb\r\nc\n"));
    assert_eq!(
        inspect(&[45, 45, 45, 10, 0xd800, 10, 45, 45, 45]),
        Inspection::Frontmatter {
            raw_start: 4,
            raw_end: 6,
            body_start: 9
        }
    );
}
