//! Table layout and text policies with host-owned arrays, strings and themes.
pub trait Host {
    type Value: Copy;
    type Error;
    fn call(&mut self, name: &str, args: Vec<Self::Value>) -> Result<Self::Value, Self::Error>;
    fn get(&mut self, value: Self::Value, key: &str) -> Result<Self::Value, Self::Error>;
    fn is_undefined(&self, value: Self::Value) -> Result<bool, Self::Error>;
    fn is_true(&self, value: Self::Value) -> Result<bool, Self::Error>;
    fn is_kind(&self, value: Self::Value, kind: &str) -> Result<bool, Self::Error>;
}

fn predicate<H: Host>(host: &mut H, name: &str, args: Vec<H::Value>) -> Result<bool, H::Error> {
    let value = host.call(name, args)?;
    host.is_true(value)
}

pub fn point_width(point: f64) -> f64 {
    if point == 0.0 || point < 0x20 as f64 || (0x7f as f64..0xa0 as f64).contains(&point) {
        return 0.0;
    }
    if point == 0x200d as f64
        || (0xfe00 as f64..=0xfe0f as f64).contains(&point)
        || [
            (0x0300, 0x036f),
            (0x1ab0, 0x1aff),
            (0x1dc0, 0x1dff),
            (0x20d0, 0x20ff),
            (0xfe20, 0xfe2f),
        ]
        .into_iter()
        .any(|(a, b)| (a as f64..=b as f64).contains(&point))
    {
        return 0.0;
    }
    if point == 0x2329 as f64
        || point == 0x232a as f64
        || [
            (0x1100, 0x115f),
            (0x2e80, 0xa4cf),
            (0xac00, 0xd7a3),
            (0xf900, 0xfaff),
            (0xfe10, 0xfe19),
            (0xfe30, 0xfe6f),
            (0xff00, 0xff60),
            (0xffe0, 0xffe6),
            (0x2600, 0x27bf),
            (0x1f300, 0x1faff),
            (0x20000, 0x3fffd),
        ]
        .into_iter()
        .any(|(a, b)| (a as f64..=b as f64).contains(&point) && point != 0x303f as f64)
    {
        2.0
    } else {
        1.0
    }
}

pub fn emoji_point(point: f64) -> bool {
    point == 0x200d as f64
        || [
            (0xfe00, 0xfe0f),
            (0x1f1e6, 0x1f1ff),
            (0x1f300, 0x1faff),
            (0x2600, 0x27bf),
        ]
        .into_iter()
        .any(|(a, b)| (a as f64..=b as f64).contains(&point))
}

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("render", [options, format]) => {
            if host.is_kind(*format, "markdown")? {
                return host.call("markdown", vec![*options]);
            }
            if host.is_kind(*format, "json")? {
                return host.call("json", vec![*options]);
            }
            host.call("terminal", vec![*options])
        }
        ("terminal", [options, theme, columns, rows]) => {
            let variant = host.get(*options, "variant")?;
            if host.is_kind(variant, "detail")? {
                run(host, "detail", &[*options, *theme, *columns, *rows])
            } else {
                host.call("table", vec![*options, *theme, *columns, *rows])
            }
        }
        ("loggerWidth", [columns]) => {
            if host.is_undefined(*columns)? {
                Ok(*columns)
            } else {
                host.call("loggerWidth", vec![*columns])
            }
        }
        ("detail", [options, theme, columns, rows]) => {
            let label = host.get(*columns, "0")?;
            let value = host.get(*columns, "1")?;
            if !predicate(host, "truthy", vec![label])? || !predicate(host, "truthy", vec![value])?
            {
                return host.call("empty", vec![]);
            }
            let width = host.get(label, "width")?;
            let label_width = host.call("labelWidth", vec![width])?;
            let max = host.get(*options, "maxWidth")?;
            let value_width = host.call("valueWidth", vec![max, label_width])?;
            let continuation = host.call("continuation", vec![label_width])?;
            host.call(
                "detailRows",
                vec![
                    *rows,
                    label,
                    label_width,
                    value,
                    value_width,
                    continuation,
                    *theme,
                ],
            )
        }
        ("alignment", [column]) => {
            let alignment = host.get(*column, "alignment")?;
            if host.is_kind(alignment, "right")? || host.is_kind(alignment, "center")? {
                Ok(alignment)
            } else {
                host.call("left", vec![])
            }
        }
        ("column", [column]) => {
            let name = host.get(*column, "name")?;
            let title = host.get(*column, "title")?;
            let alignment = run(host, "alignment", &[*column])?;
            let max = host.get(*column, "maxLen")?;
            if !predicate(host, "finite", vec![max])? {
                return host.call("invalidWidth", vec![]);
            }
            let max = host.get(*column, "maxLen")?;
            if predicate(host, "nonpositive", vec![max])? {
                return host.call("invalidWidth", vec![]);
            }
            let min = host.get(*column, "minLen")?;
            let min = host.call("minWidth", vec![min])?;
            let max = host.get(*column, "maxLen")?;
            let width = host.call("max", vec![min, max])?;
            host.call("column", vec![name, title, alignment, width])
        }
        ("cell", [row, name]) => {
            if predicate(host, "own", vec![*row, *name])? {
                host.call("cellValue", vec![*row, *name])
            } else {
                host.call("empty", vec![])
            }
        }
        ("separators", [options]) => {
            let single = host.get(*options, "rowSeparator")?;
            if host.is_true(single)? {
                return Ok(single);
            }
            let plural = host.get(*options, "rowSeparators")?;
            host.call(
                if host.is_true(plural)? {
                    "true"
                } else {
                    "false"
                },
                vec![],
            )
        }
        ("budget", [columns, max]) => {
            if host.is_undefined(*max)? {
                return Ok(*columns);
            }
            let count = host.get(*columns, "length")?;
            let available = host.call("available", vec![*max, count])?;
            let total = host.call("totalWidth", vec![*columns])?;
            if predicate(host, "le", vec![total, available])? {
                return Ok(*columns);
            }
            let mut cap = host.call("minCellWidth", vec![])?;
            loop {
                let next = host.call("increment", vec![cap])?;
                let width = host.call("contentWidth", vec![*columns, next])?;
                if !predicate(host, "le", vec![width, available])? {
                    break;
                }
                cap = host.call("increment", vec![cap])?;
            }
            let budgeted = host.call("capColumns", vec![*columns, cap])?;
            let content = host.call("contentWidth", vec![*columns, cap])?;
            let mut slack = host.call("subtract", vec![available, content])?;
            while predicate(host, "positive", vec![slack])? {
                let growable = host.call("growable", vec![budgeted, *columns])?;
                if predicate(host, "emptyArray", vec![growable])? {
                    break;
                }
                slack = host.call("grow", vec![growable, slack])?;
            }
            Ok(budgeted)
        }
        ("ansi", [value, start]) => {
            let mut index = host.call("plusTwo", vec![*start])?;
            loop {
                let length = host.get(*value, "length")?;
                if !predicate(host, "lt", vec![index, length])? {
                    break;
                }
                let point = host.call("at", vec![*value, index])?;
                if host.is_kind(point, "m")? {
                    break;
                }
                index = host.call("increment", vec![index])?;
            }
            let length = host.get(*value, "length")?;
            if predicate(host, "lt", vec![index, length])? {
                index = host.call("increment", vec![index])?;
            }
            let sequence = host.call("slice", vec![*value, *start, index])?;
            host.call("ansiRecord", vec![sequence, index])
        }
        ("clusterWidth", [cluster]) => {
            let points = host.call("points", vec![*cluster])?;
            let length = host.get(points, "length")?;
            if predicate(host, "multiple", vec![length])? && predicate(host, "emoji", vec![points])?
            {
                host.call("two", vec![])
            } else {
                host.call("sumPoints", vec![points])
            }
        }
        ("width", [value]) => {
            let mut width = host.call("zero", vec![])?;
            let mut index = host.call("zero", vec![])?;
            loop {
                let length = host.get(*value, "length")?;
                if !predicate(host, "lt", vec![index, length])? {
                    break;
                }
                if predicate(host, "isAnsi", vec![*value, index])? {
                    let ansi = run(host, "ansi", &[*value, index])?;
                    index = host.get(ansi, "nextIndex")?;
                    continue;
                }
                let cluster = host.call("cluster", vec![*value, index])?;
                let size = run(host, "clusterWidth", &[cluster])?;
                width = host.call("add", vec![width, size])?;
                let length = host.get(cluster, "length")?;
                index = host.call("add", vec![index, length])?;
            }
            Ok(width)
        }
        ("truncate", [value, width]) => {
            let actual = run(host, "width", &[*value])?;
            if predicate(host, "le", vec![actual, *width])? {
                return Ok(*value);
            }
            if predicate(host, "nonpositive", vec![*width])? {
                return host.call("empty", vec![]);
            }
            let ellipsis = host.call("ellipsis", vec![])?;
            let target = if predicate(host, "atMostOne", vec![*width])? {
                host.call("zero", vec![])?
            } else {
                let size = run(host, "width", &[ellipsis])?;
                host.call("subtract", vec![*width, size])?
            };
            let mut output = host.call("empty", vec![])?;
            let mut current = host.call("zero", vec![])?;
            let mut index = host.call("zero", vec![])?;
            let mut saw_ansi = false;
            loop {
                let length = host.get(*value, "length")?;
                if !predicate(host, "lt", vec![index, length])? {
                    break;
                }
                if predicate(host, "isAnsi", vec![*value, index])? {
                    let ansi = run(host, "ansi", &[*value, index])?;
                    saw_ansi = true;
                    let sequence = host.get(ansi, "sequence")?;
                    output = host.call("add", vec![output, sequence])?;
                    index = host.get(ansi, "nextIndex")?;
                    continue;
                }
                let cluster = host.call("cluster", vec![*value, index])?;
                let size = run(host, "clusterWidth", &[cluster])?;
                let next = host.call("add", vec![current, size])?;
                if predicate(host, "gt", vec![next, target])? {
                    break;
                }
                output = host.call("add", vec![output, cluster])?;
                current = host.call("add", vec![current, size])?;
                let length = host.get(cluster, "length")?;
                index = host.call("add", vec![index, length])?;
            }
            let reset = host.call(if saw_ansi { "reset" } else { "empty" }, vec![])?;
            host.call("truncated", vec![output, ellipsis, reset])
        }
        ("pad", [value, width, alignment]) => {
            let visible = run(host, "width", &[*value])?;
            let padding = host.call("padding", vec![*width, visible])?;
            host.call(
                if host.is_kind(*alignment, "right")? {
                    "padRight"
                } else if host.is_kind(*alignment, "center")? {
                    "padCenter"
                } else {
                    "padLeft"
                },
                vec![*value, padding],
            )
        }
        ("wrapWord", [raw, width]) => {
            let words = host.call("array", vec![])?;
            let mut word = *raw;
            loop {
                let size = run(host, "width", &[word])?;
                if !predicate(host, "gt", vec![size, *width])? {
                    break;
                }
                let mut chunk = host.call("empty", vec![])?;
                let mut index = host.call("zero", vec![])?;
                loop {
                    let length = host.get(word, "length")?;
                    if !predicate(host, "lt", vec![index, length])? {
                        break;
                    }
                    if predicate(host, "isAnsi", vec![word, index])? {
                        let ansi = run(host, "ansi", &[word, index])?;
                        let sequence = host.get(ansi, "sequence")?;
                        chunk = host.call("add", vec![chunk, sequence])?;
                        index = host.get(ansi, "nextIndex")?;
                        continue;
                    }
                    let cluster = host.call("cluster", vec![word, index])?;
                    let next = host.call("templatePair", vec![chunk, cluster])?;
                    let size = run(host, "width", &[next])?;
                    if predicate(host, "gt", vec![size, *width])? {
                        break;
                    }
                    chunk = host.call("add", vec![chunk, cluster])?;
                    let length = host.get(cluster, "length")?;
                    index = host.call("add", vec![index, length])?;
                }
                host.call("push", vec![words, chunk])?;
                let length = host.get(chunk, "length")?;
                word = host.call("suffix", vec![word, length])?;
            }
            host.call("push", vec![words, word])?;
            Ok(words)
        }
        ("foldWord", [state, word, width, lines]) => {
            let line = host.get(*state, "line")?;
            let length = host.get(line, "length")?;
            if predicate(host, "isZero", vec![length])? {
                return host.call("setLine", vec![*state, *word]);
            }
            let joined = host.call("joinWords", vec![line, *word])?;
            let size = run(host, "width", &[joined])?;
            if predicate(host, "le", vec![size, *width])? {
                host.call("setLine", vec![*state, joined])
            } else {
                host.call("push", vec![*lines, line])?;
                host.call("setLine", vec![*state, *word])
            }
        }
        (
            "detailRow",
            [
                row,
                label_column,
                label_width,
                value_column,
                value_width,
                continuation,
                theme,
            ],
        ) => {
            let name = host.get(*label_column, "name")?;
            let cell = run(host, "cell", &[*row, name])?;
            let label = run(host, "truncate", &[cell, *label_width])?;
            let name = host.get(*value_column, "name")?;
            let cell = run(host, "cell", &[*row, name])?;
            let values = host.call("wrap", vec![cell, *value_width])?;
            if predicate(host, "blankDetail", vec![values])? {
                host.call("detailHeader", vec![*theme, label])
            } else {
                let alignment = host.call("left", vec![])?;
                // The host captures theme.muted before evaluating the padding argument.
                host.call(
                    "detailLines",
                    vec![
                        *theme,
                        label,
                        *label_width,
                        alignment,
                        values,
                        *continuation,
                    ],
                )
            }
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
