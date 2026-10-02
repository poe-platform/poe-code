//! Terminal width and explorer cell layout, retaining ECMAScript host effects.
use crate::table;

pub trait Host: table::Host {
    fn number(&mut self, value: f64) -> Result<Self::Value, Self::Error>;
}
fn predicate<H: Host>(host: &mut H, name: &str, args: Vec<H::Value>) -> Result<bool, H::Error> {
    let value = host.call(name, args)?;
    host.is_true(value)
}
fn ranges<H: Host>(host: &mut H, point: H::Value, ranges: &[(u32, u32)]) -> Result<bool, H::Error> {
    for &(low, high) in ranges {
        let a = host.number(f64::from(low))?;
        if low == high {
            if predicate(host, "same", vec![point, a])? {
                return Ok(true);
            }
        } else if predicate(host, "ge", vec![point, a])? {
            let b = host.number(f64::from(high))?;
            if predicate(host, "le", vec![point, b])? {
                return Ok(true);
            }
        }
    }
    Ok(false)
}
fn tab_spaces<H: Host>(host: &mut H, column: H::Value) -> Result<H::Value, H::Error> {
    let eight = host.number(8.)?;
    let remainder = host.call("remainder", vec![column, eight])?;
    host.call("subtract", vec![eight, remainder])
}
pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("grapheme", [segment]) => {
            let point = host.call("point", vec![*segment])?;
            if host.is_undefined(point)?
                || ranges(
                    host,
                    point,
                    &[
                        (0x0300, 0x036f),
                        (0x1ab0, 0x1aff),
                        (0x1dc0, 0x1dff),
                        (0x20d0, 0x20ff),
                        (0xfe20, 0xfe2f),
                    ],
                )?
            {
                return host.number(0.);
            }
            let wide = ranges(
                host,
                point,
                &[
                    (0x1100, 0x115f),
                    (0x2329, 0x2329),
                    (0x232a, 0x232a),
                    (0x2e80, 0x303e),
                    (0x3041, 0x33bf),
                    (0x3400, 0x4dbf),
                    (0x4e00, 0xa4cf),
                    (0xa960, 0xa97f),
                    (0xac00, 0xd7af),
                    (0xf900, 0xfaff),
                    (0xfe10, 0xfe19),
                    (0xfe30, 0xfe6f),
                    (0xff00, 0xff60),
                    (0xffe0, 0xffe6),
                    (0x1b000, 0x1b0ff),
                    (0x1f004, 0x1f004),
                    (0x1f0cf, 0x1f0cf),
                    (0x1f200, 0x1fffd),
                    (0x20000, 0x2fffd),
                    (0x30000, 0x3fffd),
                ],
            )?;
            if wide {
                return host.number(2.);
            }
            let points = host.call("flagPoints", vec![*segment])?;
            let length = host.get(points, "length")?;
            let two = host.number(2.)?;
            if (predicate(host, "same", vec![length, two])?
                && predicate(host, "flagEvery", vec![points])?)
                || predicate(host, "variation", vec![*segment])?
            {
                Ok(two)
            } else {
                host.number(1.)
            }
        }
        ("regional", [point]) => {
            let yes = !host.is_undefined(*point)? && ranges(host, *point, &[(0x1f1e6, 0x1f1ff)])?;
            host.call(if yes { "true" } else { "false" }, vec![])
        }
        ("display", [text, start]) => {
            let column = host.call("measure", vec![*text, *start])?;
            host.call("subtract", vec![column, *start])
        }
        ("displayStep", [column, segment]) => {
            let amount = if host.is_kind(*segment, "\t")? {
                tab_spaces(host, *column)?
            } else {
                run(host, "grapheme", &[*segment])?
            };
            host.call("add", vec![*column, amount])
        }
        ("expand", [text, start]) => {
            if !predicate(host, "containsTab", vec![*text])? {
                return Ok(*text);
            }
            host.call("expandSegments", vec![*text, *start])
        }
        ("expandStep", [state, segment]) => {
            if host.is_kind(*segment, "\t")? {
                let column = host.get(*state, "column")?;
                let spaces = tab_spaces(host, column)?;
                host.call("appendSpaces", vec![*state, spaces])?;
                host.call("advanceColumn", vec![*state, spaces])
            } else {
                host.call("append", vec![*state, *segment])?;
                let column = host.get(*state, "column")?;
                let width = run(host, "grapheme", &[*segment])?;
                let column = host.call("add", vec![column, width])?;
                host.call("setColumn", vec![*state, column])
            }
        }
        ("truncate", [text, width]) => {
            let zero = host.number(0.)?;
            if predicate(host, "le", vec![*width, zero])? {
                return host.call("empty", vec![]);
            }
            let used = run(host, "display", &[*text, zero])?;
            if predicate(host, "le", vec![used, *width])? {
                return Ok(*text);
            }
            let target = host.call("truncateTarget", vec![*width])?;
            let result = host.call("truncateSegments", vec![*text, target])?;
            host.call("ellipsis", vec![result])
        }
        ("truncateStep", [state, segment, target]) => {
            let amount = run(host, "grapheme", &[*segment])?;
            let used = host.get(*state, "used")?;
            let next = host.call("add", vec![used, amount])?;
            if predicate(host, "gt", vec![next, *target])? {
                return host.call("false", vec![]);
            }
            host.call("append", vec![*state, *segment])?;
            host.call("advanceUsed", vec![*state, amount])?;
            host.call("true", vec![])
        }
        ("take", [text, width, start]) => {
            let zero = host.number(0.)?;
            if predicate(host, "le", vec![*width, zero])? {
                return host.call("empty", vec![]);
            }
            host.call("takeSegments", vec![*text, *width, *start])
        }
        ("takeStep", [state, segment, width]) => {
            let column = host.get(*state, "column")?;
            let amount = run(host, "display", &[*segment, column])?;
            let used = host.get(*state, "used")?;
            let next = host.call("add", vec![used, amount])?;
            if predicate(host, "gt", vec![next, *width])? {
                return host.call("false", vec![]);
            }
            host.call("append", vec![*state, *segment])?;
            host.call("advanceUsed", vec![*state, amount])?;
            host.call("advanceColumn", vec![*state, amount])?;
            host.call("true", vec![])
        }
        ("fit", [text, width, start]) => {
            let zero = host.number(0.)?;
            if predicate(host, "le", vec![*width, zero])? {
                return host.call("empty", vec![]);
            }
            let used = run(host, "display", &[*text, *start])?;
            if predicate(host, "le", vec![used, *width])? {
                return Ok(*text);
            }
            let ellipsis = host.call("ellipsisText", vec![])?;
            let amount = run(host, "display", &[ellipsis, *start])?;
            if predicate(host, "gt", vec![amount, *width])? {
                return run(host, "take", &[*text, *width, *start]);
            }
            let target = host.call("subtract", vec![*width, amount])?;
            let prefix = run(host, "take", &[*text, target, *start])?;
            host.call("ellipsis", vec![prefix])
        }
        ("center", [text, width, start]) => {
            let fitted = run(host, "fit", &[*text, *width, *start])?;
            let used = run(host, "display", &[fitted, *start])?;
            let padding = host.call("centerPadding", vec![*width, used])?;
            host.call("center", vec![padding, fitted])
        }
        ("pad", [text, width, fill, start]) => {
            let mut output = run(host, "take", &[*text, *width, *start])?;
            let mut used = run(host, "display", &[output, *start])?;
            let mut column = host.call("add", vec![*start, used])?;
            let zero = host.number(0.)?;
            while predicate(host, "lt", vec![used, *width])? {
                let amount = run(host, "display", &[*fill, column])?;
                let length = host.get(*fill, "length")?;
                let spaces = if predicate(host, "same", vec![length, zero])?
                    || predicate(host, "le", vec![amount, zero])?
                {
                    true
                } else {
                    let next = host.call("add", vec![used, amount])?;
                    predicate(host, "gt", vec![next, *width])?
                };
                let amount = if spaces {
                    let amount = host.call("subtract", vec![*width, used])?;
                    let fill = host.call("spaces", vec![amount])?;
                    output = host.call("add", vec![output, fill])?;
                    amount
                } else {
                    output = host.call("add", vec![output, *fill])?;
                    amount
                };
                used = host.call("add", vec![used, amount])?;
                column = host.call("add", vec![column, amount])?;
            }
            Ok(output)
        }
        ("split", [text, start]) => host.call("splitSegments", vec![*text, *start]),
        ("splitStep", [state, segment]) => {
            let column = host.get(*state, "column")?;
            let width = run(host, "display", &[*segment, column])?;
            host.call("pushCell", vec![*state, *segment, width])?;
            host.call("advanceOffset", vec![*state, *segment])?;
            host.call("advanceColumn", vec![*state, width])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
