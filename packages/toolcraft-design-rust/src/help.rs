//! Help layout policy. The host retains ICU segmentation and observable JS values.
use crate::table::Host;

fn predicate<H: Host>(host: &mut H, name: &str, args: Vec<H::Value>) -> Result<bool, H::Error> {
    let value = host.call(name, args)?;
    host.is_true(value)
}

pub fn point_width(point: f64) -> f64 {
    let width = crate::table::point_width(point);
    if width == 0.0 && point >= 0xa0 as f64 {
        1.0
    } else {
        width
    }
}

pub fn emoji_point(point: f64) -> bool {
    point == 0x200d as f64 || (0xfe00 as f64..=0xfe0f as f64).contains(&point)
}

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
    plain: bool,
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("whitespace", [character]) => {
            let yes = [" ", "\n", "\t", "\r"]
                .into_iter()
                .try_fold(false, |yes, kind| {
                    if yes {
                        Ok(true)
                    } else {
                        host.is_kind(*character, kind)
                    }
                })?;
            host.call(if yes { "true" } else { "false" }, vec![])
        }
        ("control", [value, start]) => {
            let character = host.call("at", vec![*value, *start])?;
            if !host.is_kind(character, "\u{1b}")? {
                return host.call("undefined", vec![]);
            }
            let next = host.call("increment", vec![*start])?;
            let kind = host.call("at", vec![*value, next])?;
            let csi = host.is_kind(kind, "[")?;
            let osc = !plain && host.is_kind(kind, "]")?;
            if !csi && !osc {
                return Ok(next);
            }
            let mut index = host.call("increment", vec![next])?;
            loop {
                let length = host.get(*value, "length")?;
                if !predicate(host, "lt", vec![index, length])? {
                    break;
                }
                if csi {
                    let code = host.call("charCode", vec![*value, index])?;
                    index = host.call("increment", vec![index])?;
                    if predicate(host, "controlFinal", vec![code])? {
                        return Ok(index);
                    }
                } else {
                    let character = host.call("at", vec![*value, index])?;
                    if host.is_kind(character, "\u{7}")? {
                        return host.call("increment", vec![index]);
                    }
                    let character = host.call("at", vec![*value, index])?;
                    if host.is_kind(character, "\u{1b}")? {
                        let next = host.call("increment", vec![index])?;
                        let character = host.call("at", vec![*value, next])?;
                        if host.is_kind(character, "\\")? {
                            return host.call("increment", vec![next]);
                        }
                    }
                    index = host.call("increment", vec![index])?;
                }
            }
            host.get(*value, "length")
        }
        ("strip", [value]) => {
            let mut output = host.call("empty", vec![])?;
            let mut index = host.call("zero", vec![])?;
            loop {
                let length = host.get(*value, "length")?;
                if !predicate(host, "lt", vec![index, length])? {
                    break;
                }
                let control = run(host, "control", &[*value, index], true)?;
                if !host.is_undefined(control)? {
                    index = control;
                    continue;
                }
                let character = host.call("at", vec![*value, index])?;
                output = host.call("add", vec![output, character])?;
                index = host.call("increment", vec![index])?;
            }
            Ok(output)
        }
        ("ascii", [value]) => {
            let stripped = run(host, "strip", &[*value], true)?;
            let mut output = host.call("empty", vec![])?;
            let mut index = host.call("zero", vec![])?;
            loop {
                let length = host.get(stripped, "length")?;
                if !predicate(host, "lt", vec![index, length])? {
                    break;
                }
                let code = host.call("charCode", vec![stripped, index])?;
                let character = if predicate(host, "asciiCode", vec![code])? {
                    host.call("at", vec![stripped, index])?
                } else {
                    host.call("question", vec![])?
                };
                output = host.call("add", vec![output, character])?;
                index = host.call("increment", vec![index])?;
            }
            Ok(output)
        }
        ("clusterWidth", [cluster]) => {
            let points = host.call("points", vec![*cluster])?;
            let emoji = predicate(host, "emoji", vec![points])?;
            host.call(if emoji { "two" } else { "sumPoints" }, vec![points])
        }
        ("width", [value]) => {
            if plain {
                return host.get(*value, "length");
            }
            let mut width = host.call("zero", vec![])?;
            let mut index = host.call("zero", vec![])?;
            loop {
                let length = host.get(*value, "length")?;
                if !predicate(host, "lt", vec![index, length])? {
                    break;
                }
                let control = run(host, "control", &[*value, index], false)?;
                if !host.is_undefined(control)? {
                    index = control;
                    continue;
                }
                let cluster = host.call("cluster", vec![*value, index])?;
                let size = run(host, "clusterWidth", &[cluster], false)?;
                width = host.call("add", vec![width, size])?;
                let advance = host.call("advance", vec![cluster])?;
                index = host.call("add", vec![index, advance])?;
            }
            Ok(width)
        }
        ("leading", [value]) => {
            let mut index = host.call("zero", vec![])?;
            loop {
                let length = host.get(*value, "length")?;
                if !predicate(host, "lt", vec![index, length])? {
                    break;
                }
                let character = host.call("at", vec![*value, index])?;
                let whitespace = run(host, "whitespace", &[character], plain)?;
                if !host.is_true(whitespace)? {
                    break;
                }
                index = host.call("increment", vec![index])?;
            }
            host.call("partition", vec![*value, index])
        }
        ("prefix", [value, width]) => {
            if plain {
                return host.call("partition", vec![*value, *width]);
            }
            let mut visible = host.call("zero", vec![])?;
            let mut index = host.call("zero", vec![])?;
            loop {
                let length = host.get(*value, "length")?;
                if !predicate(host, "lt", vec![index, length])? {
                    break;
                }
                let control = run(host, "control", &[*value, index], false)?;
                if !host.is_undefined(control)? {
                    index = control;
                    continue;
                }
                let cluster = host.call("prefixCluster", vec![*value, index])?;
                let size = run(host, "clusterWidth", &[cluster], false)?;
                let next = host.call("add", vec![visible, size])?;
                if predicate(host, "positive", vec![visible])?
                    && predicate(host, "gt", vec![next, *width])?
                {
                    break;
                }
                visible = host.call("add", vec![visible, size])?;
                let advance = host.call("advance", vec![cluster])?;
                index = host.call("add", vec![index, advance])?;
            }
            host.call("partition", vec![*value, index])
        }
        ("wrap", [value, width, continuation]) => {
            let leading = run(host, "leading", &[*value], plain)?;
            let prefix = host.get(leading, "prefix")?;
            let rest = host.get(leading, "rest")?;
            let size = run(host, "width", &[prefix], plain)?;
            let first_width = host.call("contentWidth", vec![*width, size])?;
            let words = host.call("words", vec![rest])?;
            if predicate(host, "emptyArray", vec![words])? {
                return host.call("single", vec![prefix]);
            }
            host.call("foldWords", vec![words, prefix, first_width, *continuation])
        }
        ("word", [state, word, prefix, first_width, continuation, lines]) => {
            let mut line = host.get(*state, "line")?;
            let first = host.get(*state, "first")?;
            let limit = if host.is_true(first)? {
                *first_width
            } else {
                *continuation
            };
            if predicate(host, "truthy", vec![line])? {
                let line_width = run(host, "width", &[line], plain)?;
                let word_width = run(host, "width", &[*word], plain)?;
                let joined_width = host.call("joinedWidth", vec![line_width, word_width])?;
                if predicate(host, "le", vec![joined_width, limit])? {
                    return host.call("appendWord", vec![*state, *word]);
                }
            }
            if predicate(host, "truthy", vec![line])? {
                let rendered = host.call("prefixLine", vec![first, *prefix, line])?;
                host.call("push", vec![*lines, rendered])?;
                host.call("continueLine", vec![*state])?;
                line = host.call("empty", vec![])?;
                host.call("setLine", vec![*state, line])?;
            }
            let mut remaining = *word;
            loop {
                let size = run(host, "width", &[remaining], plain)?;
                let first = host.get(*state, "first")?;
                let limit = if host.is_true(first)? {
                    *first_width
                } else {
                    *continuation
                };
                if !predicate(host, "gt", vec![size, limit])? {
                    break;
                }
                let chunk = run(host, "prefix", &[remaining, limit], plain)?;
                let part = host.get(chunk, "prefix")?;
                let rendered = host.call("prefixLine", vec![first, *prefix, part])?;
                host.call("push", vec![*lines, rendered])?;
                host.call("continueLine", vec![*state])?;
                remaining = host.get(chunk, "rest")?;
            }
            host.call("setLine", vec![*state, remaining])
        }
        ("columns", [options]) => {
            let rows = host.call("rows", vec![*options])?;
            if predicate(host, "emptyArray", vec![rows])? {
                return host.call("empty", vec![]);
            }
            let config = host.call("config", vec![*options])?;
            let mut values = Vec::new();
            for key in [
                "totalWidth",
                "minLeftWidth",
                "maxLeftWidth",
                "gap",
                "indent",
            ] {
                values.push(host.get(config, key)?);
            }
            if !plain {
                for (value, key) in values.iter().zip([
                    "invalidTotalWidth",
                    "invalidMinLeftWidth",
                    "invalidMaxLeftWidth",
                    "invalidGap",
                    "invalidIndent",
                ]) {
                    if !predicate(host, "validLayout", vec![*value])? {
                        return host.call(key, vec![]);
                    }
                }
            }
            let [total, min, max, gap, indent] = values.as_slice() else {
                unreachable!()
            };
            let content = host.call("maxLeft", vec![rows])?;
            let width = host.call("add", vec![content, *gap])?;
            let left = host.call("clamp", vec![width, *min, *max])?;
            let available = host.call("subtract", vec![*total, left])?;
            let right = host.call("contentWidth", vec![available, *indent])?;
            let wrap = host.call("contentWidth", vec![*total, *indent])?;
            let first = host.call("spaces", vec![*indent])?;
            let combined = host.call("add", vec![*indent, left])?;
            let continuation = host.call("spaces", vec![combined])?;
            host.call(
                "renderRows",
                vec![
                    rows,
                    left,
                    right,
                    wrap,
                    first,
                    continuation,
                    *total,
                    *indent,
                ],
            )
        }
        (
            "row",
            [
                row,
                left_width,
                right_width,
                wrap_width,
                first,
                continuation,
                total,
                indent,
            ],
        ) => {
            let left = host.get(*row, "left")?;
            let leading = run(host, "leading", &[left], plain)?;
            let prefix = host.get(leading, "prefix")?;
            let width = run(host, "width", &[prefix], plain)?;
            let hang = host.call("hang", vec![*indent, width])?;
            let left = host.get(*row, "left")?;
            let hang_width = run(host, "width", &[hang], plain)?;
            let next_width = host.call("contentWidth", vec![*total, hang_width])?;
            let left_lines = run(host, "wrap", &[left, *wrap_width, next_width], plain)?;
            let right = host.get(*row, "right")?;
            if predicate(host, "emptyArray", vec![right])? {
                return host.call("leftLines", vec![left_lines, *first, hang]);
            }
            let right = host.get(*row, "right")?;
            let right_lines = run(host, "wrap", &[right, *right_width, *right_width], plain)?;
            let left = host.get(*row, "left")?;
            let width = run(host, "width", &[left], plain)?;
            if predicate(host, "lt", vec![width, *left_width])?
                && predicate(host, "singleLine", vec![left_lines])?
            {
                return host.call(
                    "inlineLines",
                    vec![left_lines, *left_width, right_lines, *first, *continuation],
                );
            }
            host.call(
                "stackLines",
                vec![left_lines, right_lines, *first, hang, *continuation],
            )
        }
        ("token", [token]) => {
            let role = host.get(*token, "role")?;
            for (kind, operation) in [
                ("command", "commandToken"),
                ("argument", "argumentToken"),
                ("option", "optionToken"),
                ("dim", "dimToken"),
                ("literal", "literalToken"),
            ] {
                if host.is_kind(role, kind)? {
                    return host.call(operation, vec![*token]);
                }
            }
            host.call("undefined", vec![])
        }
        ("argument", [content, format]) => {
            if host.is_kind(*format, "markdown")?
                && predicate(host, "angleStart", vec![*content])?
                && predicate(host, "angleEnd", vec![*content])?
            {
                return host.call("argumentInterior", vec![*content]);
            }
            if host.is_kind(*format, "json")? {
                return Ok(*content);
            }
            host.call("argument", vec![*content])
        }
        ("dim", [content, format]) => {
            if host.is_kind(*format, "json")? || host.is_kind(*format, "markdown")? {
                Ok(*content)
            } else {
                host.call("dim", vec![*content])
            }
        }
        ("commandRow", [command]) => {
            let depth = host.call("depthPrefix", vec![*command])?;
            let depth = if plain {
                host.call("template", vec![depth])?
            } else {
                depth
            };
            let tokens = host.get(*command, "nameTokens")?;
            let use_tokens = if host.is_undefined(tokens)? {
                false
            } else {
                let tokens = host.get(*command, "nameTokens")?;
                predicate(host, "positiveLength", vec![tokens])?
            };
            let name = host.call(
                if use_tokens {
                    "commandTokens"
                } else {
                    "commandName"
                },
                vec![*command],
            )?;
            host.call("commandRow", vec![*command, depth, name])
        }
        ("optionRow", [option]) => {
            let tokens = host.get(*option, "flagTokens")?;
            let use_tokens = if host.is_undefined(tokens)? {
                false
            } else {
                let tokens = host.get(*option, "flagTokens")?;
                predicate(host, "positiveLength", vec![tokens])?
            };
            let left = host.call(
                if use_tokens {
                    "optionTokens"
                } else {
                    "optionFlags"
                },
                vec![*option],
            )?;
            host.call("optionRow", vec![*option, left])
        }
        ("usage", [command, args]) => {
            let suffix = if predicate(host, "truthy", vec![*args])? {
                host.call("usageArgs", vec![*args])?
            } else {
                host.call("empty", vec![])?
            };
            host.call("usage", vec![*command, suffix])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
