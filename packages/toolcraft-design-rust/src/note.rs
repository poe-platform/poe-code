//! Note layout and format policy; host operations retain JS values and effects.
use crate::feedback::Host;

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("note", [message, title, write]) => {
            let format = host.call("format", vec![])?;
            let stripped_message = host.call("strip", vec![*message])?;
            let normalized_title = host.call("title", vec![*title])?;
            let stripped_title = host.call("strip", vec![normalized_title])?;
            let stripped_title = host.call("inline", vec![stripped_title])?;
            let output = if host.is_kind(format, "markdown")? {
                let lines = host.call("split", vec![stripped_message])?;
                let truthy = host.call("truthy", vec![stripped_title])?;
                let heading = if host.is_true(truthy)? {
                    host.call("heading", vec![stripped_title])?
                } else {
                    host.literal("")?
                };
                let body = host.call("quote", vec![lines])?;
                host.call("markdown", vec![heading, body])?
            } else if host.is_kind(format, "json")? {
                host.call("json", vec![stripped_title, stripped_message])?
            } else {
                let body = run(host, "terminal", &[*message, *title])?;
                host.call("newline", vec![body])?
            };
            host.call("write", vec![*write, output])?;
            host.call("undefined", vec![])
        }
        ("terminal", [message, title]) => {
            let content = host.call("content", vec![*message])?;
            let normalized_title = host.call("title", vec![*title])?;
            let visible_title = host.call("strip", vec![normalized_title])?;
            let title_width = host.get(visible_title, "length")?;
            let widths = host.call("widths", vec![content])?;
            let width = host.call("width", vec![title_width, widths])?;
            let diamond = host.literal("◇")?;
            let diamond = host.call("green", vec![diamond])?;
            let normalized_title = host.call("title", vec![*title])?;
            let reset_title = host.call("reset", vec![normalized_title])?;
            let title_width = host.get(visible_title, "length")?;
            let line_width = host.call("lineWidth", vec![width, title_width])?;
            let rule = host.call("rule", vec![line_width])?;
            let corner = host.literal("╮")?;
            let rule = host.call("pair", vec![rule, corner])?;
            let rule = host.call("gray", vec![rule])?;
            let heading = host.call("terminalHeading", vec![diamond, reset_title, rule])?;
            let lines = host.call("rows", vec![content, width])?;
            let two = host.number(2.)?;
            let rule_width = host.call("add", vec![width, two])?;
            let rule = host.call("rule", vec![rule_width])?;
            let bottom = host.call("bottom", vec![rule])?;
            let bottom = host.call("gray", vec![bottom])?;
            let guide = host.literal("│")?;
            let guide = host.call("gray", vec![guide])?;
            host.call("terminal", vec![guide, heading, lines, bottom])
        }
        ("row", [line, width]) => {
            let plain = host.call("strip", vec![*line])?;
            let length = host.get(plain, "length")?;
            let padding = host.call("subtract", vec![*width, length])?;
            let padding = host.call("spaces", vec![padding])?;
            let guide = host.literal("│")?;
            let first = host.call("gray", vec![guide])?;
            let prefix = host.call("rowPrefix", vec![first, *line, padding])?;
            let last = host.call("gray", vec![guide])?;
            host.call("pair", vec![prefix, last])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
