//! ACP event text policies; host retains writer and structured-object observations.
pub struct Event {
    pub style: &'static str,
    pub text: Vec<u16>,
}
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
fn join(parts: &[&[u16]]) -> Vec<u16> {
    parts.concat()
}
fn kind_color(kind: &[u16]) -> &'static str {
    if kind.iter().copied().eq("exec".encode_utf16()) {
        "yellow"
    } else if kind.iter().copied().eq("edit".encode_utf16()) {
        "magenta"
    } else if kind.iter().copied().eq("read".encode_utf16()) {
        "cyan"
    } else if kind.iter().copied().eq("search".encode_utf16()) {
        "blue"
    } else {
        "dim"
    }
}
pub fn render(
    event: &str,
    markdown: bool,
    first: &[u16],
    second: &[u16],
    cached: &[u16],
    cost: &[u16],
) -> Event {
    let (style, text) = match event {
        "tool_start" => {
            if markdown {
                ("", join(&[&u("- *→ "), first, &u(": "), second, &u("*")]))
            } else {
                (
                    kind_color(first),
                    join(&[&u("  → "), first, &u(": "), second]),
                )
            }
        }
        "tool_complete" => {
            if markdown {
                ("", join(&[&u("- *✓ "), first, &u("*")]))
            } else {
                (kind_color(first), join(&[&u("  ✓ "), first]))
            }
        }
        "reasoning" => {
            let short = if first.len() <= 80 {
                first.to_vec()
            } else {
                join(&[&first[..77], &u("...")])
            };
            if markdown {
                ("", join(&[&u("- *thinking:* "), &short]))
            } else {
                ("dim", join(&[&u("  · "), &short]))
            }
        }
        "usage" => {
            if markdown {
                (
                    "",
                    join(&[
                        &u("- **tokens:** "),
                        first,
                        &u(" in → "),
                        second,
                        &u(" out"),
                        cost,
                    ]),
                )
            } else {
                (
                    "dim",
                    join(&[
                        &u("· tokens: "),
                        first,
                        &u(" in"),
                        cached,
                        &u(" → "),
                        second,
                        &u(" out"),
                        cost,
                    ]),
                )
            }
        }
        "error" => {
            if markdown {
                ("", join(&[&u("- **error:** "), first]))
            } else {
                ("red", join(&[&u("✗ "), first]))
            }
        }
        "permission_rejected" => {
            if markdown {
                ("", join(&[&u("- **permission rejected:** "), first]))
            } else {
                ("yellow", join(&[&u("  ✗ permission rejected: "), first]))
            }
        }
        _ => ("", Vec::new()),
    };
    Event { style, text }
}
