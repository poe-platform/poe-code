//! Prompt option windowing and physical-row/ellipsis budgeting.
use crate::feedback::Host;

fn predicate<H: Host>(host: &mut H, name: &str, args: Vec<H::Value>) -> Result<bool, H::Error> {
    let value = host.call(name, args)?;
    host.is_true(value)
}

pub fn run<H: Host>(host: &mut H, args: &[H::Value]) -> Result<H::Value, H::Error> {
    let [
        cursor,
        options,
        style,
        output,
        max_items,
        column_padding,
        row_padding,
    ] = args
    else {
        return host.call("invalidArguments", vec![]);
    };
    let zero = host.number(0.)?;
    let one = host.number(1.)?;
    let length = host.get(*options, "length")?;
    if predicate(host, "same", vec![length, zero])? {
        return host.call("array", vec![]);
    }
    let columns = host.call("columns", vec![*output, *column_padding])?;
    let budget = host.call("budget", vec![*output, *row_padding])?;
    let visible_count = host.call("visibleCount", vec![*max_items, budget])?;
    let capped_count = host.call("cap", vec![visible_count, *options])?;
    let mut start = zero;
    if predicate(host, "nearEnd", vec![*cursor, capped_count])? {
        start = host.call("start", vec![*cursor, capped_count, *options])?;
    }
    let mut end = host.call("add", vec![start, capped_count])?;
    let visible = host.call(
        "visible",
        vec![*options, start, end, *style, *cursor, columns],
    )?;
    let marker = host.call("marker", vec![columns])?;
    let marker_rows = host.call("markerRows", vec![marker])?;
    loop {
        let length = host.get(visible, "length")?;
        if !predicate(host, "gt", vec![length, one])? {
            break;
        }
        let needed = host.call(
            "neededRows",
            vec![visible, marker_rows, start, end, *options],
        )?;
        if !predicate(host, "gt", vec![needed, budget])? {
            break;
        }
        if predicate(host, "lt", vec![start, *cursor])? {
            host.call("shift", vec![visible])?;
            start = host.call("add", vec![start, one])?;
        } else {
            host.call("pop", vec![visible])?;
            end = host.call("subtract", vec![end, one])?;
        }
    }
    let mut remaining = host.call("remainingRows", vec![budget, visible])?;
    if predicate(host, "gt", vec![start, zero])?
        && predicate(host, "ge", vec![remaining, marker_rows])?
    {
        host.call("unshift", vec![visible, marker])?;
        remaining = host.call("subtract", vec![remaining, marker_rows])?;
    }
    let length = host.get(*options, "length")?;
    if predicate(host, "lt", vec![end, length])?
        && predicate(host, "ge", vec![remaining, marker_rows])?
    {
        host.call("push", vec![visible, marker])?;
    }
    Ok(visible)
}
