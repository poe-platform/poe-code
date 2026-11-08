//! Theme palette styles independent of terminal support and host state.
use mcp_protocol_rust::json::Value;
fn s(v: &str) -> Value {
    Value::String(v.encode_utf16().collect())
}
fn object(fields: Vec<(&str, Value)>) -> Value {
    Value::Object(
        fields
            .into_iter()
            .map(|(k, v)| (k.encode_utf16().collect(), v))
            .collect(),
    )
}
pub fn palette(name: &str, primary: &[u16], light: bool) -> Result<Value, String> {
    let purple = name == "purple";
    let hex = |value: &[u16], background| crate::color::hex(value, background);
    let named = |value: &str| crate::color::style(value).unwrap();
    let fixed = |value: &str, background| {
        hex(&value.encode_utf16().collect::<Vec<_>>(), background).unwrap()
    };
    let bold = named("bold");
    let active = if !light && purple {
        named("magenta")
    } else {
        hex(primary, false)?
    };
    let bright = if !light && purple {
        named("magentaBright")
    } else {
        active.clone()
    };
    let prompt = if purple {
        if light {
            fixed("#006699", false)
        } else {
            named("cyan")
        }
    } else {
        active.clone()
    };
    let number = if purple {
        if light {
            fixed("#0077cc", false)
        } else {
            named("cyanBright")
        }
    } else {
        active.clone()
    };
    let muted = if light {
        fixed("#666666", false)
    } else {
        named("dim")
    };
    let success = if light {
        fixed("#008800", false)
    } else {
        named("green")
    };
    let warning = if light {
        fixed("#cc6600", false)
    } else {
        named("yellow")
    };
    let error = if light {
        fixed("#cc0000", false)
    } else {
        named("red")
    };
    let intro = if !light && purple {
        named("bgMagenta")
    } else {
        hex(primary, true)?
    };
    let badge = if light {
        [fixed("#cc6600", true), named("white")].concat()
    } else {
        [named("bgYellow"), named("black")].concat()
    };
    let accent = if light {
        [prompt.clone(), bold.clone()].concat()
    } else {
        prompt.clone()
    };
    let styles = object(vec![
        (
            "accent",
            object(vec![
                (
                    "fg",
                    if purple {
                        s(if light { "#006699" } else { "cyan" })
                    } else {
                        Value::String(primary.to_vec())
                    },
                ),
                ("bold", Value::Bool(true)),
            ]),
        ),
        (
            "muted",
            if light {
                object(vec![("fg", s("#666666"))])
            } else {
                object(vec![("dim", Value::Bool(true))])
            },
        ),
        (
            "success",
            object(vec![("fg", s(if light { "#008800" } else { "green" }))]),
        ),
        (
            "warning",
            object(vec![("fg", s(if light { "#cc6600" } else { "yellow" }))]),
        ),
        (
            "error",
            object(vec![("fg", s(if light { "#cc0000" } else { "red" }))]),
        ),
        (
            "info",
            object(vec![(
                "fg",
                if !light && purple {
                    s("magenta")
                } else {
                    Value::String(primary.to_vec())
                },
            )]),
        ),
    ]);
    let opens = object(vec![
        ("header", Value::String([bright, bold.clone()].concat())),
        ("divider", Value::String(muted.clone())),
        ("prompt", Value::String(accent.clone())),
        (
            "number",
            Value::String(if light {
                [number, bold].concat()
            } else {
                number
            }),
        ),
        ("intro", Value::String([intro, named("white")].concat())),
        ("resolvedSymbol", Value::String(active.clone())),
        ("errorSymbol", Value::String(error.clone())),
        ("accent", Value::String(accent)),
        ("muted", Value::String(muted)),
        ("success", Value::String(success)),
        ("warning", Value::String(warning)),
        ("error", Value::String(error)),
        ("info", Value::String(active)),
        ("badge", Value::String(badge)),
    ]);
    Ok(object(vec![("opens", opens), ("styles", styles)]))
}
