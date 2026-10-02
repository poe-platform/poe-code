//! Public Markdown theme fixture content and validation sequence.
use crate::feedback::Host;

const DARK: &str = "# Dark Theme\n\n**Bold** and *italic* with `code` and a [link](https://example.com)\n\n> [!NOTE]\n> This is a note\n\n| Col1 | Col2 |\n|------|------|\n| a | b |";
const LIGHT: &str = "# Light Theme\n\n**Bold** and *italic* with `code` and a [link](https://example.com)\n\n> [!WARNING]\n> This is a warning\n\n- Item 1\n- [x] Done\n- [ ] Todo";

pub fn run<H: Host>(host: &mut H) -> Result<H::Value, H::Error> {
    host.call("forceColor", vec![])?;
    let dark = host.literal("dark")?;
    host.call("theme", vec![dark])?;
    host.call("deleteTheme", vec![])?;
    host.call("reset", vec![])?;
    let source = host.literal(DARK)?;
    let dark = host.call("render", vec![source])?;
    host.call("stdout", vec![dark])?;

    let light = host.literal("light")?;
    host.call("theme", vec![light])?;
    host.call("reset", vec![])?;
    let source = host.literal(LIGHT)?;
    let light = host.call("render", vec![source])?;
    host.call("stdout", vec![light])?;

    for (output, message) in [
        (dark, "DARK_THEME_NO_ANSI\n"),
        (light, "LIGHT_THEME_NO_ANSI\n"),
    ] {
        let colored = host.call("hasAnsi", vec![output])?;
        if !host.is_true(colored)? {
            let message = host.literal(message)?;
            host.call("stderr", vec![message])?;
            let code = host.number(1.)?;
            host.call("exit", vec![code])?;
        }
    }
    let same = host.call("same", vec![dark, light])?;
    if host.is_true(same)? {
        let message = host.literal("THEMES_NOT_DISTINCT\n")?;
        host.call("stderr", vec![message])?;
        let code = host.number(1.)?;
        host.call("exit", vec![code])?;
    }
    let message = host.literal("THEMES_VALIDATED\n")?;
    host.call("stdout", vec![message])?;
    host.call("undefined", vec![])
}
