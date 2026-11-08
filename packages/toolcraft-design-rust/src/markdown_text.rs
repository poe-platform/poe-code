//! Grapheme-safe Markdown wrapping. ICU segmentation and formatter/collection
//! operations remain host capabilities; wrapping decisions live here.
use crate::feedback::Host;
#[derive(Debug, PartialEq)]
pub struct TextToken {
    pub kind: &'static str,
    pub start: usize,
    pub end: usize,
}
pub fn tokenize(source: &[u16]) -> Vec<TextToken> {
    let mut tokens = vec![];
    let mut index = 0;
    while index < source.len() {
        let start = index;
        let kind = if source[index] == 10 {
            "break"
        } else if matches!(source[index], 32 | 9) {
            "space"
        } else {
            "word"
        };
        index += 1;
        if kind != "break" {
            while index < source.len()
                && source[index] != 10
                && (matches!(source[index], 32 | 9) == (kind == "space"))
            {
                index += 1;
            }
        }
        tokens.push(TextToken {
            kind,
            start,
            end: index,
        });
    }
    tokens
}
fn predicate<H: Host>(host: &mut H, name: &str, args: Vec<H::Value>) -> Result<bool, H::Error> {
    let value = host.call(name, args)?;
    host.is_true(value)
}
fn positive<H: Host>(host: &mut H, value: H::Value) -> Result<bool, H::Error> {
    let zero = host.number(0.)?;
    predicate(host, "gt", vec![value, zero])
}
fn nonempty<H: Host>(host: &mut H, value: H::Value) -> Result<bool, H::Error> {
    let length = host.get(value, "length")?;
    positive(host, length)
}
pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("wrap", [tokens, width]) => {
            let state = host.call("wrapState", vec![])?;
            host.call("walkTokens", vec![*tokens, *width, state])?;
            let line = host.get(state, "currentLine")?;
            if nonempty(host, line)? {
                host.call("finishLine", vec![state])?;
            }
            host.get(state, "lines")
        }
        ("token", [token, width, state]) => {
            let ty = host.get(*token, "type")?;
            if host.is_kind(ty, "break")? {
                host.call("flushLine", vec![*state])?;
            } else {
                let ty = host.get(*token, "type")?;
                if host.is_kind(ty, "space")? {
                    let current = host.get(*state, "currentWidth")?;
                    if positive(host, current)? {
                        host.call("pendingSpace", vec![*state, *token])?;
                    }
                } else {
                    let value = host.get(*token, "value")?;
                    let chunks = run(host, "split", &[value, *width])?;
                    host.call("walkChunks", vec![chunks, *token, *width, *state])?;
                }
            }
            host.call("undefined", vec![])
        }
        ("chunk", [chunks, index, token, width, state]) => {
            let chunk = host.call("at", vec![*chunks, *index])?;
            let zero = host.number(0.)?;
            let gap = if predicate(host, "same", vec![*index, zero])? {
                host.get(*state, "pendingSpace")?
            } else {
                host.literal("")?
            };
            let chunk_width = host.call("visibleWidth", vec![chunk])?;
            let gap_width = host.call("visibleWidth", vec![gap])?;
            let current = host.get(*state, "currentWidth")?;
            if positive(host, current)? {
                let sum = host.call("add", vec![current, chunk_width])?;
                let sum = host.call("add", vec![sum, gap_width])?;
                if predicate(host, "gt", vec![sum, *width])? {
                    host.call("flushLine", vec![*state])?;
                }
            }
            let current = host.get(*state, "currentWidth")?;
            if positive(host, current)? && positive(host, gap_width)? {
                host.call("appendGap", vec![*state, gap, gap_width])?;
            }
            host.call("appendFormatted", vec![*state, chunk, *token])?;
            host.call("chunkDone", vec![*state, chunk_width])?;
            let length = host.get(*chunks, "length")?;
            let one = host.number(1.)?;
            let last = host.call("subtract", vec![length, one])?;
            if predicate(host, "lt", vec![*index, last])? {
                host.call("flushLine", vec![*state])?;
            }
            host.call("undefined", vec![])
        }
        ("split", [value, width]) => {
            let visible = host.call("visibleWidth", vec![*value])?;
            if predicate(host, "le", vec![visible, *width])? {
                return host.call("oneValue", vec![*value]);
            }
            let state = host.call("splitState", vec![])?;
            host.call("walkGraphemes", vec![*value, *width, state])?;
            let chunk = host.get(state, "chunk")?;
            if nonempty(host, chunk)? {
                host.call("finishWord", vec![state])?;
            }
            host.get(state, "chunks")
        }
        ("grapheme", [grapheme, width, state]) => {
            let visible = host.call("visibleWidth", vec![*grapheme])?;
            let chunk = host.get(*state, "chunk")?;
            if nonempty(host, chunk)? {
                let current = host.get(*state, "chunkWidth")?;
                let sum = host.call("add", vec![current, visible])?;
                if predicate(host, "gt", vec![sum, *width])? {
                    host.call("flushChunk", vec![*state])?;
                }
            }
            host.call("appendGrapheme", vec![*state, *grapheme, visible])?;
            let current = host.get(*state, "chunkWidth")?;
            if predicate(host, "ge", vec![current, *width])? {
                host.call("flushChunk", vec![*state])?;
            }
            host.call("undefined", vec![])
        }
        ("trim", [tokens]) => {
            let mut end = host.get(*tokens, "length")?;
            let one = host.number(1.)?;
            while positive(host, end)? {
                let last = host.call("subtract", vec![end, one])?;
                let ty = host.call("optionalType", vec![*tokens, last])?;
                if !host.is_kind(ty, "space")? {
                    break;
                }
                end = host.call("subtract", vec![end, one])?;
            }
            host.call("slice", vec![*tokens, end])
        }
        ("text", [value, width]) => {
            let tokens = host.call("tokenize", vec![*value])?;
            let width = host.call("width", vec![*width])?;
            run(host, "wrap", &[tokens, width])
        }
        ("html", [value]) => {
            let state = host.call("htmlState", vec![])?;
            host.call("walkHtml", vec![*value, state])?;
            host.get(state, "output")
        }
        ("htmlChar", [ch, state]) => {
            if host.is_kind(*ch, "<")? {
                host.call("enterTag", vec![*state])?;
            } else {
                let mut leave = false;
                if host.is_kind(*ch, ">")? {
                    let in_tag = host.get(*state, "inTag")?;
                    leave = host.is_true(in_tag)?;
                }
                if leave {
                    host.call("leaveTag", vec![*state])?;
                } else {
                    let in_tag = host.get(*state, "inTag")?;
                    if !host.is_true(in_tag)? {
                        host.call("appendHtml", vec![*state, *ch])?;
                    }
                }
            }
            host.call("undefined", vec![])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
