use toolcraft_design_rust::color::{apply, hex, markdown_code, markdown_link, rgb};
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
#[test]
fn nested_resets_restore_outer_styles_and_preserve_utf16() {
    assert_eq!(
        apply(&[0xd800, 27, 91, 48, 109, 120], &u("\x1b[31m")),
        [u("\x1b[31m"), vec![0xd800], u("\x1b[0m\x1b[31mx\x1b[0m")].concat()
    );
}
#[test]
fn rgb_clamps_and_hex_rejects_before_style_creation() {
    assert_eq!(
        rgb([f64::NAN, f64::INFINITY, -1.0], false),
        u("\x1b[38;2;0;255;0m")
    );
    assert_eq!(hex(&u("#abc"), true).unwrap(), u("\x1b[48;2;170;187;204m"));
    assert!(hex(&u("#abz"), false).is_err());
}
#[test]
fn markdown_delimiters_and_links_escape_without_losing_surrogates() {
    assert_eq!(markdown_code(&u("`a``\r\nb`")), u("``` `a`` b` ```"));
    assert_eq!(
        markdown_link(&u("a[b](c)\\")),
        u("[a\\[b\\](c)\\\\](a[b]\\(c\\)\\\\)")
    );
}
