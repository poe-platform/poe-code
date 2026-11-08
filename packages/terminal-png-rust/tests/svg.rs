use terminal_png_rust::{
    ansi::{Color, Run, Style},
    svg::{Options, render},
};
fn run(text: &str, style: Style) -> Run {
    Run {
        text: text.encode_utf16().collect(),
        style,
    }
}
#[test]
fn layout_graphemes_and_tabs() {
    let svg = render(
        &[run("👩‍💻│", Style::default())],
        Options {
            padding: Some(0.0),
            window: false,
        },
    );
    assert!(svg.contains("width=\"25.24\""));
    assert!(svg.contains("x=\"16.83\">│</tspan>"));
    assert!(
        render(
            &[run("A\tB", Style::default())],
            Options {
                padding: Some(0.0),
                window: false
            }
        )
        .contains("width=\"75.71\"")
    );
}
#[test]
fn escaping_conceal_backgrounds_and_font() {
    let style = Style {
        fg: Some(Color::Ansi4(1)),
        bg: Some(Color::Ansi8(42)),
        bold: true,
        underline: true,
        strikethrough: true,
        ..Style::default()
    };
    let svg = render(&[run("<&>", style)], Options::default());
    assert!(svg.contains("&lt;&amp;&gt;"));
    assert!(svg.contains("font-weight=\"bold\""));
    assert!(svg.contains("text-decoration=\"underline line-through\""));
    assert!(svg.contains("fill=\"#D74E6F\""));
    assert!(svg.contains("data:font/woff2;base64,"));
    let svg = render(
        &[run(
            "secret",
            Style {
                conceal: true,
                ..Style::default()
            },
        )],
        Options::default(),
    );
    assert!(!svg.contains("secret"));
}
