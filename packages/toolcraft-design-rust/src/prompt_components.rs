//! Interactive prompt presentation and event policy; Node retains object lifetimes.
use crate::feedback::Host;

pub fn glyphs(unicode: bool) -> [&'static str; 14] {
    if unicode {
        [
            "◆", "■", "▲", "◇", "┌", "│", "└", "●", "○", "[ ]", "[x]", "[ ]", "•", "...",
        ]
    } else {
        [
            "*", "x", "x", "o", "T", "|", "-", ">", " ", "[ ]", "[x]", "[ ]", "*", "...",
        ]
    }
}

fn predicate<H: Host>(host: &mut H, name: &str, args: Vec<H::Value>) -> Result<bool, H::Error> {
    let value = host.call(name, args)?;
    host.is_true(value)
}

fn unicode<H: Host>(host: &mut H) -> Result<bool, H::Error> {
    if !predicate(host, "windows", vec![])? {
        let key = host.literal("TERM")?;
        let term = host.call("env", vec![key])?;
        return Ok(!host.is_kind(term, "linux")?);
    }
    for key in ["CI", "WT_SESSION", "TERMINUS_SUBLIME"] {
        let key = host.literal(key)?;
        let value = host.call("env", vec![key])?;
        if predicate(host, "truthy", vec![value])? {
            return Ok(true);
        }
    }
    for (key, expected) in [
        ("ConEmuTask", "{cmd::Cmder}"),
        ("TERM_PROGRAM", "Terminus-Sublime"),
        ("TERM_PROGRAM", "vscode"),
        ("TERM", "xterm-256color"),
        ("TERM", "alacritty"),
        ("TERMINAL_EMULATOR", "JetBrains-JediTerm"),
    ] {
        let key = host.literal(key)?;
        let value = host.call("env", vec![key])?;
        if host.is_kind(value, expected)? {
            return Ok(true);
        }
    }
    Ok(false)
}

fn color_glyph<H: Host>(
    host: &mut H,
    color: &'static str,
    glyph: &'static str,
) -> Result<H::Value, H::Error> {
    let color = host.literal(color)?;
    let glyph = host.literal(glyph)?;
    host.call("colorGlyph", vec![color, glyph])
}

fn append<H: Host>(host: &mut H, left: H::Value, right: H::Value) -> Result<H::Value, H::Error> {
    host.call("append", vec![left, right])
}

fn suffix<H: Host>(host: &mut H, left: H::Value, text: &'static str) -> Result<H::Value, H::Error> {
    let text = host.literal(text)?;
    append(host, left, text)
}

fn choice<H: Host>(host: &mut H, active: bool, label: &'static str) -> Result<H::Value, H::Error> {
    let marker = color_glyph(
        host,
        if active { "green" } else { "dim" },
        if active {
            "radioActive"
        } else {
            "radioInactive"
        },
    )?;
    let text = suffix(host, marker, " ")?;
    let color = host.literal(if active { "bold" } else { "dim" })?;
    let label = host.literal(label)?;
    let label = host.call("color", vec![color, label])?;
    append(host, text, label)
}

fn confirm_frame<H: Host>(
    host: &mut H,
    prompt: H::Value,
    opts: H::Value,
) -> Result<H::Value, H::Error> {
    let state = host.get(prompt, "state")?;
    let submit = host.is_kind(state, "submit")?;
    let cancel = if submit {
        false
    } else {
        let state = host.get(prompt, "state")?;
        host.is_kind(state, "cancel")?
    };
    let start = color_glyph(host, "gray", "barStart")?;
    let mut text = suffix(host, start, " ")?;
    let state = host.get(prompt, "state")?;
    let marker = host.call("symbol", vec![state])?;
    text = append(host, text, marker)?;
    text = suffix(host, text, " ")?;
    let message = host.get(opts, "message")?;
    text = append(host, text, message)?;
    text = suffix(host, text, "\n")?;
    let bar = if submit || cancel {
        color_glyph(host, "gray", "bar")?
    } else {
        let state = host.get(prompt, "state")?;
        host.call("symbolBar", vec![state])?
    };
    text = append(host, text, bar)?;
    text = suffix(host, text, "  ")?;
    let label = if submit || cancel {
        host.call(
            if cancel {
                "cancelledLabel"
            } else {
                "submittedLabel"
            },
            vec![prompt],
        )?
    } else {
        let value = host.get(prompt, "value")?;
        let active = predicate(host, "truthy", vec![value])?;
        let yes = choice(host, active, "Yes")?;
        let active = !predicate(host, "truthy", vec![value])?;
        let no = choice(host, active, "No")?;
        let yes = suffix(host, yes, " ")?;
        let color = host.literal("dim")?;
        let slash = host.literal("/")?;
        let slash = host.call("color", vec![color, slash])?;
        let choices = append(host, yes, slash)?;
        let choices = suffix(host, choices, " ")?;
        append(host, choices, no)?
    };
    text = append(host, text, label)?;
    text = suffix(host, text, "\n")?;
    let end = color_glyph(
        host,
        if submit {
            "green"
        } else if cancel {
            "red"
        } else {
            "cyan"
        },
        "barEnd",
    )?;
    append(host, text, end)
}

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("unicode", []) => {
            let enabled = unicode(host)?;
            host.call(if enabled { "true" } else { "false" }, vec![])
        }
        ("symbol" | "symbolBar", [state]) => {
            let (color, glyph) = if host.is_kind(*state, "cancel")? {
                ("red", "stepCancel")
            } else if host.is_kind(*state, "error")? {
                ("yellow", "stepError")
            } else if host.is_kind(*state, "submit")? {
                ("green", "stepSubmit")
            } else {
                ("cyan", "stepActive")
            };
            color_glyph(
                host,
                color,
                if operation == "symbolBar" {
                    "bar"
                } else {
                    glyph
                },
            )
        }
        ("confirm", [prompt, value]) => {
            host.call("setValue", vec![*prompt, *value])?;
            host.call("submitState", vec![*prompt])?;
            host.call("finalize", vec![*prompt])?;
            host.call("render", vec![*prompt])?;
            host.call("close", vec![*prompt])?;
            host.call("undefined", vec![])
        }
        ("confirmCursor", [prompt, action]) => {
            if host.is_kind(*action, "up")?
                || host.is_kind(*action, "down")?
                || host.is_kind(*action, "left")?
                || host.is_kind(*action, "right")?
            {
                host.call("toggle", vec![*prompt])?;
            }
            host.call("undefined", vec![])
        }
        ("confirmNonTty", [prompt, fallback]) => {
            let key = host.literal("POE_NO_PROMPT")?;
            let env = host.call("env", vec![key])?;
            host.call(
                if host.is_kind(env, "1")? {
                    "resolveConfirm"
                } else {
                    "nonTty"
                },
                vec![*prompt, *fallback],
            )
        }
        ("confirmFrame", [prompt, opts]) => confirm_frame(host, *prompt, *opts),
        _ => host.call("invalidOperation", vec![]),
    }
}
