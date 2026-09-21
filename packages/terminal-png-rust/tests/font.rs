use terminal_png_rust::font::Font;
const REGULAR: &[u8] = include_bytes!("../assets/jetbrains-mono-400-normal.ttf");
#[test]
fn true_type_metrics_cmap_outlines_and_composites() {
    let font = Font::new(REGULAR).unwrap();
    assert_eq!(font.units_per_em(), 1000);
    let a = font.glyph_index('A' as u32);
    assert_ne!(a, 0);
    assert_eq!(font.advance(a).unwrap(), 600);
    let outline = font.outline(a).unwrap();
    assert!(!outline.is_empty());
    assert!(
        outline
            .iter()
            .flatten()
            .all(|p| p.x.is_finite() && p.y.is_finite())
    );
    let composite = font.outline(font.glyph_index('é' as u32)).unwrap();
    assert!(composite.len() > font.outline(font.glyph_index('e' as u32)).unwrap().len());
    assert!(
        font.outline(font.glyph_index(' ' as u32))
            .unwrap()
            .is_empty()
    );
    assert_eq!(font.glyph_index(0x10ffff), 0);
}
#[test]
fn malformed_fonts_are_rejected_without_panics() {
    for len in 0..64 {
        assert!(Font::new(&REGULAR[..len]).is_err());
    }
    assert!(Font::new(&[0; 100]).is_err());
}
