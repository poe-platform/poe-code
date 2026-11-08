//! ANSI word wrapping and line-boundary style policy. Host operations preserve
//! ECMAScript strings, arrays, iterators, coercions and callback order.
use crate::table::Host;

pub fn closing_code(code: f64) -> Option<f64> {
    if (30.0..=37.0).contains(&code) || (90.0..=97.0).contains(&code) {
        Some(39.0)
    } else if (40.0..=47.0).contains(&code) || (100.0..=107.0).contains(&code) {
        Some(49.0)
    } else {
        [
            (0.0, 0.0),
            (1.0, 22.0),
            (2.0, 22.0),
            (3.0, 23.0),
            (4.0, 24.0),
            (7.0, 27.0),
            (8.0, 28.0),
            (9.0, 29.0),
        ]
        .into_iter()
        .find_map(|(open, close)| (code == open).then_some(close))
    }
}

fn predicate<H: Host>(host: &mut H, name: &str, args: Vec<H::Value>) -> Result<bool, H::Error> {
    let value = host.call(name, args)?;
    host.is_true(value)
}

fn disabled<H: Host>(host: &mut H, options: H::Value, name: &str) -> Result<bool, H::Error> {
    let value = host.get(options, name)?;
    predicate(host, "isFalse", vec![value])
}

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("word", [rows, word, columns]) => {
            let characters = host.call("iterator", vec![*word])?;
            let mut inside_escape = false;
            let mut inside_link = false;
            let last = host.call("last", vec![*rows])?;
            let zero = host.call("zero", vec![])?;
            let mut visible = if host.is_undefined(last)? {
                zero
            } else {
                host.call("width", vec![last])?
            };
            let mut current = host.call("next", vec![characters])?;
            let mut next = host.call("next", vec![characters])?;
            let mut raw_index = zero;
            loop {
                let done = host.get(current, "done")?;
                if predicate(host, "truthy", vec![done])? {
                    break;
                }
                let character = host.get(current, "value")?;
                let length = host.call("width", vec![character])?;
                let total = host.call("add", vec![visible, length])?;
                if predicate(host, "le", vec![total, *columns])? {
                    host.call("append", vec![*rows, character])?;
                } else {
                    host.call("push", vec![*rows, character])?;
                    visible = zero;
                }
                if host.is_kind(character, "\u{1b}")? || host.is_kind(character, "\u{9b}")? {
                    inside_escape = true;
                    inside_link = predicate(host, "startsLink", vec![*word, raw_index])?;
                }
                if inside_escape {
                    if inside_link {
                        if host.is_kind(character, "\u{7}")? {
                            inside_escape = false;
                            inside_link = false;
                        }
                    } else if host.is_kind(character, "m")? {
                        inside_escape = false;
                    }
                } else {
                    visible = host.call("add", vec![visible, length])?;
                    if predicate(host, "same", vec![visible, *columns])? {
                        let done = host.get(next, "done")?;
                        if !predicate(host, "truthy", vec![done])? {
                            host.call("pushEmpty", vec![*rows])?;
                            visible = zero;
                        }
                    }
                }
                current = next;
                next = host.call("next", vec![characters])?;
                let length = host.get(character, "length")?;
                raw_index = host.call("add", vec![raw_index, length])?;
            }
            let last = host.call("last", vec![*rows])?;
            if !predicate(host, "truthy", vec![visible])? && !host.is_undefined(last)? {
                let length = host.get(last, "length")?;
                if predicate(host, "truthy", vec![length])?
                    && predicate(host, "multiple", vec![*rows])?
                {
                    host.call("mergeLast", vec![*rows])?;
                }
            }
            host.call("undefined", vec![])
        }
        ("trimRight", [text]) => {
            let words = host.call("words", vec![*text])?;
            let mut last = host.get(words, "length")?;
            while predicate(host, "truthy", vec![last])? {
                let previous = host.call("decrement", vec![last])?;
                let word = host.call("at", vec![words, previous])?;
                let width = host.call("width", vec![word])?;
                if predicate(host, "truthy", vec![width])? {
                    break;
                }
                last = host.call("decrement", vec![last])?;
            }
            let length = host.get(words, "length")?;
            if predicate(host, "same", vec![last, length])? {
                Ok(*text)
            } else {
                host.call("trimmedWords", vec![words, last])
            }
        }
        ("line", [text, columns, options]) => {
            if !disabled(host, *options, "trim")? {
                let trimmed = host.call("trim", vec![*text])?;
                if host.is_kind(trimmed, "")? {
                    return host.call("empty", vec![]);
                }
            }
            let words = host.call("words", vec![*text])?;
            let mut rows = host.call("rows", vec![])?;
            let zero = host.call("zero", vec![])?;
            let mut row_length = zero;
            let mut index = zero;
            loop {
                let length = host.get(words, "length")?;
                if !predicate(host, "lt", vec![index, length])? {
                    break;
                }
                let word = host.call("at", vec![words, index])?;
                if !disabled(host, *options, "trim")? {
                    let row = host.call("lastOrEmpty", vec![rows])?;
                    let trimmed = host.call("trimStart", vec![row])?;
                    let before = host.get(row, "length")?;
                    let after = host.get(trimmed, "length")?;
                    if !predicate(host, "same", vec![before, after])? {
                        host.call("setLast", vec![rows, trimmed])?;
                        row_length = host.call("width", vec![trimmed])?;
                    }
                }
                if !predicate(host, "same", vec![index, zero])? {
                    if predicate(host, "ge", vec![row_length, *columns])?
                        && (disabled(host, *options, "wordWrap")?
                            || disabled(host, *options, "trim")?)
                    {
                        host.call("pushEmpty", vec![rows])?;
                        row_length = zero;
                    }
                    if predicate(host, "truthy", vec![row_length])?
                        || disabled(host, *options, "trim")?
                    {
                        host.call("appendSpace", vec![rows])?;
                        row_length = host.call("increment", vec![row_length])?;
                    }
                }
                let word_length = host.call("width", vec![word])?;
                let hard = host.get(*options, "hard")?;
                if predicate(host, "truthy", vec![hard])?
                    && predicate(host, "gt", vec![word_length, *columns])?
                {
                    let remaining = host.call("subtract", vec![*columns, row_length])?;
                    let here = host.call("breaksHere", vec![word_length, remaining, *columns])?;
                    let next = host.call("breaksNext", vec![word_length, *columns])?;
                    if predicate(host, "lt", vec![next, here])? {
                        host.call("pushEmpty", vec![rows])?;
                    }
                    run(host, "word", &[rows, word, *columns])?;
                    let last = host.call("lastOrEmpty", vec![rows])?;
                    row_length = host.call("width", vec![last])?;
                    index = host.call("increment", vec![index])?;
                    continue;
                }
                let total = host.call("add", vec![row_length, word_length])?;
                if predicate(host, "gt", vec![total, *columns])?
                    && predicate(host, "truthy", vec![row_length])?
                    && predicate(host, "truthy", vec![word_length])?
                {
                    if disabled(host, *options, "wordWrap")?
                        && predicate(host, "lt", vec![row_length, *columns])?
                    {
                        run(host, "word", &[rows, word, *columns])?;
                        let last = host.call("lastOrEmpty", vec![rows])?;
                        row_length = host.call("width", vec![last])?;
                        index = host.call("increment", vec![index])?;
                        continue;
                    }
                    host.call("pushEmpty", vec![rows])?;
                    row_length = zero;
                }
                let total = host.call("add", vec![row_length, word_length])?;
                if predicate(host, "gt", vec![total, *columns])?
                    && disabled(host, *options, "wordWrap")?
                {
                    run(host, "word", &[rows, word, *columns])?;
                    let last = host.call("lastOrEmpty", vec![rows])?;
                    row_length = host.call("width", vec![last])?;
                    index = host.call("increment", vec![index])?;
                    continue;
                }
                host.call("append", vec![rows, word])?;
                row_length = host.call("add", vec![row_length, word_length])?;
                index = host.call("increment", vec![index])?;
            }
            if !disabled(host, *options, "trim")? {
                rows = host.call("trimRows", vec![rows])?;
            }
            let text = host.call("joinRows", vec![rows])?;
            run(host, "escapes", &[text])
        }
        ("escapes", [text]) => {
            let mut output = host.call("empty", vec![])?;
            let undefined = host.call("undefined", vec![])?;
            let mut code = undefined;
            let mut url = undefined;
            let mut surrogate = false;
            let mut index = host.call("zero", vec![])?;
            loop {
                let length = host.get(*text, "length")?;
                if !predicate(host, "lt", vec![index, length])? {
                    break;
                }
                let character = host.call("at", vec![*text, index])?;
                output = host.call("add", vec![output, character])?;
                if !surrogate {
                    surrogate = predicate(host, "highSurrogate", vec![character])?;
                    if surrogate {
                        index = host.call("increment", vec![index])?;
                        continue;
                    }
                } else {
                    surrogate = false;
                }
                if host.is_kind(character, "\u{1b}")? || host.is_kind(character, "\u{9b}")? {
                    let groups = host.call("groups", vec![*text, index])?;
                    let found = host.call("groupCode", vec![groups])?;
                    if !host.is_undefined(found)? {
                        let found = host.get(groups, "code")?;
                        let parsed = host.call("parseFloat", vec![found])?;
                        code = if predicate(host, "endCode", vec![parsed])? {
                            undefined
                        } else {
                            parsed
                        };
                    } else {
                        let found = host.call("groupUri", vec![groups])?;
                        if !host.is_undefined(found)? {
                            let uri = host.get(groups, "uri")?;
                            let length = host.get(uri, "length")?;
                            url = if predicate(host, "isZero", vec![length])? {
                                undefined
                            } else {
                                host.get(groups, "uri")?
                            };
                        }
                    }
                }
                let next = host.call("increment", vec![index])?;
                let after = host.call("at", vec![*text, next])?;
                if host.is_kind(after, "\n")? {
                    if predicate(host, "truthy", vec![url])? {
                        let closed = host.call("closeLink", vec![])?;
                        output = host.call("add", vec![output, closed])?;
                    }
                    let closing = if predicate(host, "truthy", vec![code])? {
                        host.call("closing", vec![code])?
                    } else {
                        undefined
                    };
                    if predicate(host, "truthy", vec![code])?
                        && predicate(host, "truthy", vec![closing])?
                    {
                        let ansi = host.call("ansi", vec![closing])?;
                        output = host.call("add", vec![output, ansi])?;
                    }
                } else if host.is_kind(character, "\n")? {
                    if predicate(host, "truthy", vec![code])? {
                        let closing = host.call("closing", vec![code])?;
                        if predicate(host, "truthy", vec![closing])? {
                            let ansi = host.call("ansi", vec![code])?;
                            output = host.call("add", vec![output, ansi])?;
                        }
                    }
                    if predicate(host, "truthy", vec![url])? {
                        let link = host.call("link", vec![url])?;
                        output = host.call("add", vec![output, link])?;
                    }
                }
                index = host.call("increment", vec![index])?;
            }
            Ok(output)
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
