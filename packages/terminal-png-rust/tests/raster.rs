use terminal_png_rust::{ansi::parse, raster::render, svg};
#[test]
fn basic_svg_shapes_fill_at_four_times_zoom() {
    let image =
        render("<svg width='4' height='3'><rect width='4' height='3' fill='#ff0000'/></svg>")
            .unwrap();
    assert_eq!((image.width, image.height), (16, 12));
    assert!(image.rgba.chunks(4).all(|p| p == [255, 0, 0, 255]));
    let circle =
        render("<svg width='8' height='8'><circle cx='4' cy='4' r='2' fill='#00ff00'/></svg>")
            .unwrap();
    assert_eq!(
        &circle.rgba[(16 * 32 + 16) * 4..(16 * 32 + 16) * 4 + 4],
        &[0, 255, 0, 255]
    );
    assert_eq!(&circle.rgba[..4], &[0, 0, 0, 0]);
}
#[test]
fn terminal_svg_uses_real_font_outlines_and_bounded_allocation() {
    let svg = svg::render(
        &parse(&"Hello │ é".encode_utf16().collect::<Vec<_>>()),
        svg::Options::default(),
    );
    let image = render(&svg).unwrap();
    assert!(image.rgba.chunks(4).any(|v| v[..3] == [196, 196, 196]));
    assert!(image.width > 200 && image.height > 100);
    assert!(render("<svg width='99999999' height='99999999'/>").is_err());
    assert!(render("<svg width='NaN' height='8'/>").is_err());
}
#[test]
fn fractional_rectangles_preserve_pixel_coverage() {
    let image=render("<svg width='4' height='4'><rect x='0' y='0.01' width='1' height='1' fill='#ff0000'/></svg>").unwrap();
    assert_eq!(image.rgba[3], 255);
    assert_eq!(image.rgba[(16 + 1) * 4 + 3], 255);
}
