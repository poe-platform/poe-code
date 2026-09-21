//! Deterministic terminal SVG layout, colors and font embedding.
use crate::{
    ansi::{Color, Run},
    grapheme::segments,
};
use std::sync::OnceLock;
pub const REGULAR_BASE64: &str = include_str!("../assets/jetbrains-mono-400-normal.base64");
const FACES: [(&str, u16, &str); 4] = [
    (REGULAR_BASE64, 400, "normal"),
    (
        include_str!("../assets/jetbrains-mono-700-normal.base64"),
        700,
        "normal",
    ),
    (
        include_str!("../assets/jetbrains-mono-400-italic.base64"),
        400,
        "italic",
    ),
    (
        include_str!("../assets/jetbrains-mono-700-italic.base64"),
        700,
        "italic",
    ),
];
pub fn font_face_css() -> &'static str {
    static CSS: OnceLock<String> = OnceLock::new();
    CSS.get_or_init(||FACES.iter().map(|(base64,weight,style)|format!("@font-face {{\n  font-family: 'JetBrains Mono';\n  font-style: {style};\n  font-weight: {weight};\n  src: url('data:font/woff2;base64,{base64}') format('woff2');\n}}")).collect::<Vec<_>>().join("\n"))
}
const ANSI16: [&str; 16] = [
    "#282a2e", "#D74E6F", "#31BB71", "#D3E561", "#8056FF", "#ED61D7", "#04D7D7", "#C5C8C6",
    "#4B4B4B", "#FE5F86", "#00D787", "#EBFF71", "#8F69FF", "#FF7AEA", "#00FEFE", "#FFFFFF",
];
const BACKGROUND: &str = "#171717";
const FOREGROUND: &str = "#c4c4c4";
pub const CHARACTER_WIDTH: f64 = 8.412666666666667;
#[derive(Clone, Copy)]
pub struct Options {
    pub padding: Option<f64>,
    pub window: bool,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            padding: None,
            window: true,
        }
    }
}
fn cp(text: &[u16]) -> u32 {
    if let Some(&first) = text.first() {
        if (0xd800..=0xdbff).contains(&first)
            && text.get(1).is_some_and(|n| (0xdc00..=0xdfff).contains(n))
        {
            0x10000 + (u32::from(first) - 0xd800) * 1024 + (u32::from(text[1]) - 0xdc00)
        } else {
            u32::from(first)
        }
    } else {
        0
    }
}
fn zero(cp: u32) -> bool {
    matches!(cp,0x0300..=0x036f|0x1ab0..=0x1aff|0x1dc0..=0x1dff|0x20d0..=0x20ff|0xfe20..=0xfe2f)
}
fn wide(cp: u32) -> bool {
    matches!(cp,0x1100..=0x115f|0x2329..=0x232a|0x2e80..=0x303e|0x3041..=0x33bf|0x3400..=0x4dbf|0x4e00..=0xa4cf|0xa960..=0xa97f|0xac00..=0xd7af|0xf900..=0xfaff|0xfe10..=0xfe19|0xfe30..=0xfe6f|0xff00..=0xff60|0xffe0..=0xffe6|0x1b000..=0x1b0ff|0x1f004|0x1f0cf|0x1f200..=0x1fffd|0x20000..=0x2fffd|0x30000..=0x3fffd)
}
fn segment_width(text: &[u16], column: usize) -> usize {
    if text == [9] {
        return 8 - column % 8;
    }
    let first = cp(text);
    if zero(first) {
        0
    } else if wide(first)
        || text.len() == 4
            && (0x1f1e6..=0x1f1ff).contains(&first)
            && (0x1f1e6..=0x1f1ff).contains(&cp(&text[2..]))
    {
        2
    } else {
        1
    }
}
pub fn display_width(text: &[u16], start: usize) -> usize {
    let mut column = start;
    for segment in segments(text) {
        column += segment_width(segment, column);
    }
    column - start
}
fn color(color: &Color) -> String {
    match *color {
        Color::Ansi4(i) => ANSI16
            .get(usize::from(i))
            .unwrap_or(&FOREGROUND)
            .to_string(),
        Color::Ansi8(i) if i < 16 => ANSI16[usize::from(i)].to_string(),
        Color::Ansi8(i) if i < 232 => {
            let i = i - 16;
            let levels = [0, 95, 135, 175, 215, 255];
            format!(
                "#{:02x}{:02x}{:02x}",
                levels[usize::from(i / 36)],
                levels[usize::from(i / 6 % 6)],
                levels[usize::from(i % 6)]
            )
        }
        Color::Ansi8(i) => {
            let shades = [
                8, 18, 28, 38, 48, 58, 68, 78, 88, 96, 102, 118, 128, 138, 148, 158, 168, 178, 188,
                198, 208, 218, 228, 238,
            ];
            let n = shades[usize::from(i - 232)];
            format!("#{n:02x}{n:02x}{n:02x}")
        }
        Color::Rgb(r, g, b) => format!("rgb({r},{g},{b})"),
    }
}
fn foreground(run: &Run) -> String {
    if run.style.inverse {
        run.style
            .bg
            .as_ref()
            .map_or_else(|| BACKGROUND.into(), color)
    } else {
        run.style
            .fg
            .as_ref()
            .map_or_else(|| FOREGROUND.into(), color)
    }
}
fn background(run: &Run) -> String {
    if run.style.inverse {
        run.style
            .fg
            .as_ref()
            .map_or_else(|| FOREGROUND.into(), color)
    } else {
        run.style
            .bg
            .as_ref()
            .map_or_else(|| BACKGROUND.into(), color)
    }
}
fn escape(text: &[u16]) -> String {
    String::from_utf16_lossy(text)
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}
fn span(run: &Run, text: &[u16], x: f64) -> String {
    let mut attrs = vec!["xml:space=\"preserve\"".to_string()];
    let fg = foreground(run);
    if fg != FOREGROUND {
        attrs.push(format!("fill=\"{fg}\""));
    }
    if run.style.bold {
        attrs.push("font-weight=\"bold\"".into());
    }
    if run.style.italic {
        attrs.push("font-style=\"italic\"".into());
    }
    let mut decor = vec![];
    if run.style.underline {
        decor.push("underline");
    }
    if run.style.strikethrough {
        decor.push("line-through");
    }
    if !decor.is_empty() {
        attrs.push(format!("text-decoration=\"{}\"", decor.join(" ")));
    }
    if run.style.dim {
        attrs.push("opacity=\"0.7\"".into());
    }
    let points = segments(text)
        .iter()
        .enumerate()
        .map(|(i, _)| format!("{:.2}", x + i as f64 * CHARACTER_WIDTH))
        .collect::<Vec<_>>()
        .join(" ");
    attrs.push(format!("x=\"{points}\""));
    format!(
        "<tspan {}>{}</tspan>",
        attrs.join(" "),
        if run.style.conceal {
            " ".repeat(display_width(text, 0))
        } else {
            escape(text)
        }
    )
}
pub fn render(runs: &[Run], options: Options) -> String {
    let (top, right, bottom, left) = options
        .padding
        .map_or((20.0, 40.0, 20.0, 20.0), |n| (n, n, n, n));
    let title = if options.window { 15.0 } else { 0.0 };
    let line_height = 14.0 * 1.2;
    let text_y = title + top + line_height;
    let mut lines = vec![vec![]];
    for run in runs {
        if run.text == [10] {
            lines.push(vec![]);
        } else {
            lines.last_mut().unwrap().push(run);
        }
    }
    let max = lines
        .iter()
        .map(|line| {
            let joined = line
                .iter()
                .flat_map(|r| r.text.iter().copied())
                .collect::<Vec<_>>();
            display_width(&joined, 0)
        })
        .max()
        .unwrap_or(0);
    let width = left + max as f64 * CHARACTER_WIDTH + right;
    let height = title + top + lines.len() as f64 * line_height + bottom + 11.6;
    let mut text = String::new();
    for (index, line) in lines.into_iter().enumerate() {
        let y = text_y + index as f64 * line_height;
        if line.is_empty() {
            text.push_str(&format!(
                "<text x=\"{left:.2}\" y=\"{y:.2}\" xml:space=\"preserve\"/>"
            ));
            continue;
        }
        let mut column = 0;
        for run in &line {
            let cells = display_width(&run.text, column);
            let bg = background(run);
            if bg != BACKGROUND && cells > 0 {
                text.push_str(&format!("<rect x=\"{:.2}\" y=\"{:.2}\" width=\"{:.2}\" height=\"{line_height:.2}\" fill=\"{bg}\" />",left+column as f64*CHARACTER_WIDTH,y-line_height,cells as f64*CHARACTER_WIDTH));
            }
            column += cells;
        }
        text.push_str(&format!(
            "<text x=\"{left:.2}\" y=\"{y:.2}\" xml:space=\"preserve\">"
        ));
        column = 0;
        for run in line {
            let mut pending = vec![];
            let mut start = column;
            for segment in segments(&run.text) {
                let width = segment_width(segment, column);
                let scalars = char::decode_utf16(segment.iter().copied()).count();
                if width != 1 || scalars != 1 {
                    if !pending.is_empty() {
                        text.push_str(&span(run, &pending, left + start as f64 * CHARACTER_WIDTH));
                        pending.clear();
                    }
                    if segment != [9] && width > 0 {
                        text.push_str(&span(run, segment, left + column as f64 * CHARACTER_WIDTH));
                    }
                    column += width;
                    start = column;
                } else {
                    pending.extend(segment);
                    column += 1;
                }
            }
            if !pending.is_empty() {
                text.push_str(&span(run, &pending, left + start as f64 * CHARACTER_WIDTH));
            }
        }
        text.push_str("</text>");
    }
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{width:.2}\" height=\"{height:.2}\" viewBox=\"0 0 {width:.2} {height:.2}\"><defs><style><![CDATA[{}]]></style></defs><rect x=\"0\" y=\"0\" width=\"{width:.2}\" height=\"{height:.2}\" fill=\"{BACKGROUND}\" />{}<g font-family=\"JetBrains Mono\" font-size=\"14.00px\" fill=\"{FOREGROUND}\">{text}</g></svg>",
        font_face_css(),
        if options.window {
            "<circle cx=\"13.5\" cy=\"12\" r=\"5.5\" fill=\"#FF5A54\" /><circle cx=\"32.5\" cy=\"12\" r=\"5.5\" fill=\"#E6BF29\" /><circle cx=\"51.5\" cy=\"12\" r=\"5.5\" fill=\"#52C12B\" />"
        } else {
            ""
        }
    )
}
