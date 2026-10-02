//! fast-string-width policy. ECMAScript regex and string operations stay with
//! the host so its Unicode tables, coercions and UTF-16 semantics remain exact.
use crate::table::Host;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum NumericResult {
    Number(f64),
    Boolean(bool),
}

/// Only primitive numbers enter this kernel. Other ECMAScript values retain
/// their host coercions, including repeated coercion and arbitrary throws.
pub fn numeric_operation(operation: &str, args: &[f64]) -> Option<NumericResult> {
    use NumericResult::{Boolean, Number};
    Some(match (operation, args) {
        ("zero", []) => Number(0.0),
        ("one", []) => Number(1.0),
        ("two", []) => Number(2.0),
        ("add", [a, b]) => Number(a + b),
        ("subtract", [a, b]) => Number(a - b),
        ("multiply", [a, b]) => Number(a * b),
        ("increment", [a]) => Number(a + 1.0),
        ("decrement", [a]) => Number(a - 1.0),
        ("lt", [a, b]) => Boolean(a < b),
        ("le", [a, b]) => Boolean(a <= b),
        ("gt", [a, b]) => Boolean(a > b),
        ("ge", [a, b]) => Boolean(a >= b),
        ("same", [a, b]) => Boolean(a == b),
        ("isZero", [a]) => Boolean(*a == 0.0),
        ("isFalse", [_]) => Boolean(false),
        ("endCode", [a]) => Boolean(*a == 39.0),
        ("truthy", [a]) => Boolean(*a != 0.0 && !a.is_nan()),
        ("overLimit", [a, b, limit]) => Boolean(a + b > *limit),
        ("overInfinity", [a, b]) => Boolean(a + b > f64::INFINITY),
        _ => return None,
    })
}

pub fn point_kind(x: f64) -> &'static str {
    if x == 0x3000 as f64
        || (0xff01 as f64..=0xff60 as f64).contains(&x)
        || (0xffe0 as f64..=0xffe6 as f64).contains(&x)
    {
        return "full";
    }
    if x == 0x231b as f64
        || x == 0x2329 as f64
        || [
            (0x2ff0, 0x2fff),
            (0x3001, 0x303e),
            (0x3099, 0x30ff),
            (0x3105, 0x312f),
            (0x3131, 0x318e),
            (0x3190, 0x31e3),
            (0x31ef, 0x321e),
            (0x3220, 0x3247),
            (0x3250, 0x4dbf),
            (0xfe10, 0xfe19),
            (0xfe30, 0xfe52),
            (0xfe54, 0xfe66),
            (0xfe68, 0xfe6b),
            (0x1f200, 0x1f202),
            (0x1f210, 0x1f23b),
            (0x1f240, 0x1f248),
            (0x20000, 0x2fffd),
            (0x30000, 0x3fffd),
        ]
        .into_iter()
        .any(|(a, b)| (a as f64..=b as f64).contains(&x))
    {
        "wide"
    } else {
        "regular"
    }
}

fn predicate<H: Host>(host: &mut H, op: &str, args: Vec<H::Value>) -> Result<bool, H::Error> {
    let value = host.call(op, args)?;
    host.is_true(value)
}

pub fn run<H: Host>(host: &mut H, op: &str, args: &[H::Value]) -> Result<H::Value, H::Error> {
    match (op, args) {
        ("character", [state, character, regular, wide, limit]) => {
            let kind = host.call("pointKind", vec![*character])?;
            let extra = if host.is_kind(kind, "full")? {
                host.call("two", vec![])?
            } else if host.is_kind(kind, "wide")? {
                *wide
            } else {
                *regular
            };
            let width = host.get(*state, "width")?;
            // The untruncated API still performs both comparisons. Their
            // coercions are observable when a caller supplies a width object.
            if predicate(host, "overLimit", vec![width, extra, *limit])? {
                host.call("truncateCharacter", vec![*state])?;
            }
            host.call("overInfinity", vec![width, extra])?;
            host.call("advanceCharacter", vec![*state, *character, extra])
        }
        ("width", [input, options]) => {
            let control = host.call("controlOption", vec![*options])?;
            let tab = host.call("tabOption", vec![*options])?;
            let emoji = host.call("emojiOption", vec![*options])?;
            let regular = host.call("regularOption", vec![*options])?;
            let wide = host.call("wideOption", vec![*options])?;
            let zero = host.call("zero", vec![])?;
            let mut previous = zero;
            let mut index = zero;
            let length = host.get(*input, "length")?;
            let limit = host.call("unlimited", vec![])?;
            let state = host.call("state", vec![length])?;
            let mut start = zero;
            let mut end = zero;
            let mut width = zero;
            'scan: loop {
                if predicate(host, "gt", vec![end, start])?
                    || (predicate(host, "ge", vec![index, length])?
                        && predicate(host, "gt", vec![index, previous])?)
                {
                    let text = host.call("slice", vec![*input, start, end])?;
                    let text = if predicate(host, "truthy", vec![text])? {
                        text
                    } else {
                        host.call("slice", vec![*input, previous, index])?
                    };
                    width = host.call(
                        "unmatched",
                        vec![text, width, regular, wide, limit, state, start, previous],
                    )?;
                    start = zero;
                    end = zero;
                }
                if predicate(host, "ge", vec![index, length])? {
                    return Ok(width);
                }
                for (block, block_width) in [
                    ("latin", regular),
                    ("ansi", zero),
                    ("control", control),
                    ("tab", tab),
                    ("emoji", emoji),
                    ("cjkt", wide),
                ] {
                    let block = host.call(block, vec![])?;
                    if predicate(host, "matches", vec![block, *input, index])? {
                        let extra_length = if host.is_kind(block, "cjkt")? {
                            let last = host.call("lastIndex", vec![block])?;
                            let text = host.call("slice", vec![*input, index, last])?;
                            host.call("pointLength", vec![text])?
                        } else if host.is_kind(block, "emoji")? {
                            host.call("one", vec![])?
                        } else {
                            let last = host.call("lastIndex", vec![block])?;
                            host.call("subtract", vec![last, index])?
                        };
                        let extra = host.call("multiply", vec![extra_length, block_width])?;
                        if predicate(host, "overLimit", vec![width, extra, limit])? {
                            host.call(
                                "truncateBlock",
                                vec![state, index, limit, width, block_width],
                            )?;
                        }
                        host.call("overInfinity", vec![width, extra])?;
                        width = host.call("add", vec![width, extra])?;
                        start = previous;
                        end = index;
                        index = host.call("lastIndex", vec![block])?;
                        previous = index;
                        continue 'scan;
                    }
                }
                index = host.call("increment", vec![index])?;
            }
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
