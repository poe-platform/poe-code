//! Suggestion admission and Damerau-Levenshtein traversal with live host values.
use crate::host::TextHost;

pub fn run<H: TextHost>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{let args=vec![$($arg),*];host.call($name,args)?}}; }
    match (operation, args) {
        ("suggest", [input, candidates, opts]) => {
            let length = host.get(*input, "length")?;
            let empty = c!("isZero", length);
            if host.is_true(empty)? {
                return host.call("empty", vec![]);
            }
            let max = host.get(*opts, "max")?;
            let max = if host.is_nullish(max)? {
                c!("three")
            } else {
                max
            };
            let threshold = host.get(*opts, "threshold")?;
            let threshold = if host.is_nullish(threshold)? {
                c!("defaultThreshold", *input)
            } else {
                threshold
            };
            host.call("rank", vec![*input, *candidates, max, threshold])
        }
        ("compare", [left, right]) => {
            let left_distance = host.get(*left, "distance")?;
            let right_distance = host.get(*right, "distance")?;
            host.call(
                if host.same(left_distance, right_distance)? {
                    "compareCandidates"
                } else {
                    "distanceDifference"
                },
                vec![*left, *right],
            )
        }
        ("distance", [left, right]) => distance(host, *left, *right),
        _ => host.call("invalidOperation", vec![]),
    }
}

fn distance<H: TextHost>(
    host: &mut H,
    left: H::Value,
    right: H::Value,
) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{let args=vec![$($arg),*];host.call($name,args)?}}; }
    let distances = c!("matrix", left, right);
    let mut row = c!("zero");
    loop {
        let more = c!("rowMore", row, left);
        if !host.is_true(more)? {
            break;
        }
        c!("setRow", distances, row);
        row = c!("increment", row);
    }
    let mut column = c!("zero");
    loop {
        let more = c!("columnMore", column, right);
        if !host.is_true(more)? {
            break;
        }
        c!("setColumn", distances, column);
        column = c!("increment", column);
    }
    row = c!("one");
    loop {
        let more = c!("rowMore", row, left);
        if !host.is_true(more)? {
            break;
        }
        column = c!("one");
        loop {
            let more = c!("columnMore", column, right);
            if !host.is_true(more)? {
                break;
            }
            let equal = c!("equalCell", left, right, row, column);
            let cost = host.call(if host.is_true(equal)? { "zero" } else { "one" }, vec![])?;
            let deletion = c!("deletion", distances, row, column);
            let insertion = c!("insertion", distances, row, column);
            let substitution = c!("substitution", distances, row, column, cost);
            c!(
                "assignMinimum",
                distances,
                row,
                column,
                deletion,
                insertion,
                substitution
            );
            let row_past = c!("pastOne", row);
            if host.is_true(row_past)? {
                let column_past = c!("pastOne", column);
                if host.is_true(column_past)? {
                    let first = c!("transposeFirst", left, right, row, column);
                    if host.is_true(first)? {
                        let second = c!("transposeSecond", left, right, row, column);
                        if host.is_true(second)? {
                            c!("transposeMinimum", distances, row, column);
                        }
                    }
                }
            }
            column = c!("increment", column);
        }
        row = c!("increment", row);
    }
    host.call("result", vec![distances, left, right])
}
