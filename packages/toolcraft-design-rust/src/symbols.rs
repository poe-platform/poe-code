//! Public design symbols and numeric tokens, independent of host theme state.
pub fn symbol(name: &str, format: &str) -> (&'static str, &'static str) {
    if let Some(corner) = match name {
        "cornerTopRight" => Some("╮"),
        "cornerBottomRight" => Some("╯"),
        _ => None,
    } {
        return ("text", corner);
    }
    let (json, markdown, terminal) = match name {
        "info" => ("info", "(i)", "●"),
        "success" => ("success", "[ok]", "◆"),
        "resolved" => ("resolved", ">", "resolvedSymbol"),
        "errorResolved" => ("error", "[!]", "errorSymbol"),
        "bar" => ("", "|", "│"),
        "warning" => ("warning", "[!]", "▲"),
        "active" => ("active", "[x]", "◆"),
        "inactive" => ("inactive", "[ ]", "○"),
        _ => ("", "", ""),
    };
    match format {
        "json" => ("text", json),
        "markdown" => ("text", markdown),
        _ => (
            match name {
                "info" | "success" => "magenta",
                "resolved" | "errorResolved" => "theme",
                _ => "text",
            },
            terminal,
        ),
    }
}

pub fn prompt_symbols() -> &'static [(&'static str, &'static str)] {
    &[
        ("initial", "◆"),
        ("active", "◆"),
        ("inactive", "○"),
        ("success", "◇"),
    ]
}

pub fn tokens(name: &str) -> &'static [(&'static str, u32)] {
    match name {
        "spacing" => &[("sm", 1), ("md", 2), ("lg", 4), ("xl", 8)],
        "widths" => &[("header", 60), ("helpColumn", 24), ("maxLine", 80)],
        _ => &[],
    }
}
