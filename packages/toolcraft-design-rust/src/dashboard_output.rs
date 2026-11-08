//! Dashboard transcript wrapping, viewport rendering and conversation presentation.
use crate::feedback::Host;

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{let args=vec![$($arg),*];host.call($name,args)?}}; }
    macro_rules! g {
        ($value:expr,$key:expr) => {{
            let value = $value;
            host.get(value, $key)?
        }};
    }
    macro_rules! p { ($name:expr $(,$arg:expr)* $(,)?) => {{let value=c!($name $(,$arg)*);host.is_true(value)?}}; }
    macro_rules! r { ($op:expr $(,$arg:expr)* $(,)?) => {{let args=[$($arg),*];run(host,$op,&args)?}}; }
    macro_rules! l {
        ($text:expr) => {{
            let text = $text;
            host.literal(text)?
        }};
    }
    macro_rules! set {
        ($value:expr,$key:expr,$item:expr) => {
            c!("set", $value, l!($key), $item)
        };
    }
    macro_rules! walk { ($op:expr,$values:expr $(,$arg:expr)* $(,)?) => {c!("walk",l!($op),$values $(,$arg)*)}; }
    macro_rules! put {
        ($buffer:expr,$rect:expr,$row:expr,$text:expr,$style:expr) => {{
            let buffer = $buffer;
            c!(
                "invoke",
                g!(buffer, "putInRect"),
                buffer,
                $rect,
                $row,
                $text,
                $style
            )
        }};
    }
    let zero = host.number(0.)?;
    let one = host.number(1.)?;
    let three = host.number(3.)?;
    let undefined = c!("undefined");
    let empty = l!("");
    match (operation, args) {
        ("compute", [items, width, preformatted]) => {
            let lines = c!("array");
            if p!("le", *width, zero) {
                return Ok(lines);
            }
            let muted = g!(g!(c!("getTheme"), "styles"), "muted");
            let width = c!("max", c!("subtract", *width, three), zero);
            walk!("visualItem", *items, width, *preformatted, muted, lines);
            return Ok(lines);
        }
        ("visualItem", [item, width, preformatted, muted, lines]) => {
            let style = r!("style", g!(*item, "kind"));
            if p!("truthy", *preformatted)
                || p!("hasAnsi", g!(*item, "text"))
                || p!("truthy", r!("controls", g!(*item, "text")))
            {
                let text = g!(*item, "text");
                let base = if p!("truthy", *preformatted) || p!("hasAnsi", g!(*item, "text")) {
                    c!("object")
                } else {
                    style
                };
                let styled = c!("parseAnsi", text, base);
                let state = c!("object");
                set!(state, "first", c!("true"));
                walk!(
                    "styledLine",
                    styled,
                    *width,
                    *item,
                    style,
                    *muted,
                    *lines,
                    state
                );
            } else {
                let wrapped = r!("wrap", g!(*item, "text"), *width);
                let mut index = zero;
                while p!("lt", index, g!(wrapped, "length")) {
                    let first = p!("same", index, zero);
                    let prefix = if first {
                        r!("prefix", g!(*item, "kind"))
                    } else {
                        l!("│")
                    };
                    let prefix_style = if first { style } else { *muted };
                    let text = c!("at", wrapped, index);
                    let text = if p!("nullish", text) { empty } else { text };
                    c!(
                        "push",
                        *lines,
                        c!("line", prefix, prefix_style, style, text)
                    );
                    index = c!("add", index, one);
                }
            }
        }
        ("styledLine", [line, width, item, style, muted, lines, state]) => {
            let rows = r!("hardWrap", g!(*line, "segments"), *width);
            walk!("styledRow", rows, *item, *style, *muted, *lines, *state);
        }
        ("styledRow", [segments, item, style, muted, lines, state]) => {
            let first = p!("truthy", g!(*state, "first"));
            let prefix = if first {
                r!("prefix", g!(*item, "kind"))
            } else {
                l!("│")
            };
            let prefix_style = if first { *style } else { *muted };
            let line = c!(
                "line",
                prefix,
                prefix_style,
                *style,
                c!("segmentText", *segments)
            );
            c!("push", *lines, c!("withSegments", line, *segments));
            set!(*state, "first", c!("false"));
        }
        ("style", [kind]) => {
            let styles = g!(c!("getTheme"), "styles");
            let key = if p!("same", *kind, l!("success")) {
                "success"
            } else if p!("same", *kind, l!("error")) {
                "error"
            } else if p!("same", *kind, l!("tool")) {
                "muted"
            } else {
                "info"
            };
            return Ok(g!(styles, key));
        }
        ("prefix", [kind]) => {
            return Ok(l!(if p!("same", *kind, l!("success")) {
                "◆"
            } else if p!("same", *kind, l!("error")) {
                "■"
            } else if p!("same", *kind, l!("tool")) {
                "│"
            } else if p!("same", *kind, l!("status")) {
                "●"
            } else {
                "◇"
            }));
        }
        ("controls", [text]) => {
            let mut index = zero;
            while p!("lt", index, g!(*text, "length")) {
                let code = c!("charCodeAt", *text, index);
                if (p!("lt", code, host.number(32.)?)
                    && !p!("same", code, host.number(10.)?)
                    && !p!("same", code, host.number(9.)?))
                    || (p!("ge", code, host.number(127.)?) && p!("le", code, host.number(159.)?))
                {
                    return Ok(c!("true"));
                }
                index = c!("add", index, one);
            }
            return Ok(c!("false"));
        }
        ("hardWrap", [segments, width]) => {
            let rows = c!("array");
            c!("push", rows, c!("array"));
            if p!("le", *width, zero) {
                return Ok(rows);
            }
            let state = c!("object");
            set!(state, "width", zero);
            walk!("hardSegment", *segments, *width, rows, state);
            return Ok(rows);
        }
        ("hardSegment", [segment, width, rows, state]) => {
            let units = c!(
                "graphemes",
                c!("expandTabs", g!(*segment, "text"), g!(*state, "width"))
            );
            walk!("hardGrapheme", units, *segment, *width, *rows, *state);
        }
        ("hardGrapheme", [unit, segment, width, rows, state]) => {
            let cells = c!("graphemeWidth", *unit);
            if p!("gt", g!(*state, "width"), zero)
                && p!("gt", c!("add", g!(*state, "width"), cells), *width)
            {
                c!("push", *rows, c!("array"));
                set!(*state, "width", zero);
            }
            let row = c!("at", *rows, c!("subtract", g!(*rows, "length"), one));
            r!("append", row, *unit, g!(*segment, "style"));
            set!(*state, "width", c!("add", g!(*state, "width"), cells));
        }
        ("append", [segments, text, style]) => {
            let last = c!(
                "at",
                *segments,
                c!("subtract", g!(*segments, "length"), one)
            );
            let mut equal = p!("truthy", last);
            if equal {
                let left = g!(last, "style");
                for key in ["fg", "bg", "bold", "dim", "inverse", "underline"] {
                    if !p!("same", g!(left, key), g!(*style, key)) {
                        equal = false;
                        break;
                    }
                }
            }
            if equal {
                set!(last, "text", c!("add", g!(last, "text"), *text));
            } else {
                c!("push", *segments, c!("segment", *text, *style));
            }
        }
        ("wrap", [value, width]) => {
            let lines = c!("array");
            let state = c!("object");
            set!(state, "text", empty);
            walk!("logicalChar", *value, lines, state);
            c!("push", lines, g!(state, "text"));
            if p!("le", *width, zero) {
                return Ok(c!("emptyLines", lines));
            }
            return Ok(c!("wrapLines", lines, *width));
        }
        ("logicalChar", [ch, lines, state]) => {
            if p!("same", *ch, l!("\r")) {
                return Ok(undefined);
            }
            if p!("same", *ch, l!("\n")) {
                c!("push", *lines, g!(*state, "text"));
                set!(*state, "text", empty);
            } else {
                set!(*state, "text", c!("add", g!(*state, "text"), *ch));
            }
        }
        ("paragraph", [value, width]) => {
            let lines = c!("array");
            if p!("same", g!(*value, "length"), zero) {
                c!("push", lines, empty);
                return Ok(lines);
            }
            let tokens = c!("array");
            let token_state = c!("object");
            set!(token_state, "text", empty);
            walk!("tokenChar", *value, tokens, token_state);
            if !p!("same", g!(token_state, "kind"), undefined) {
                c!(
                    "push",
                    tokens,
                    c!("token", g!(token_state, "kind"), g!(token_state, "text"))
                );
            }
            let state = c!("object");
            set!(state, "text", empty);
            set!(state, "width", zero);
            set!(state, "space", empty);
            walk!("wrapToken", tokens, *width, lines, state);
            if p!("gt", g!(g!(state, "text"), "length"), zero)
                || p!("same", g!(lines, "length"), zero)
            {
                c!("push", lines, g!(state, "text"));
            }
            return Ok(lines);
        }
        ("tokenChar", [ch, tokens, state]) => {
            let kind = if p!("same", *ch, l!(" ")) || p!("same", *ch, l!("\t")) {
                l!("space")
            } else {
                l!("word")
            };
            let old = g!(*state, "kind");
            if !p!("same", old, undefined) && !p!("same", old, kind) {
                c!("push", *tokens, c!("token", old, g!(*state, "text")));
                set!(*state, "text", empty);
            }
            set!(*state, "kind", kind);
            set!(*state, "text", c!("add", g!(*state, "text"), *ch));
        }
        ("wrapToken", [token, width, lines, state]) => {
            if p!("same", g!(*token, "kind"), l!("space")) {
                if p!("gt", g!(g!(*state, "text"), "length"), zero) {
                    set!(
                        *state,
                        "space",
                        c!("add", g!(*state, "space"), g!(*token, "value"))
                    );
                }
                return Ok(undefined);
            }
            let chunks = r!("word", g!(*token, "value"), *width);
            let mut index = zero;
            while p!("lt", index, g!(chunks, "length")) {
                let chunk = c!("at", chunks, index);
                let chunk = if p!("nullish", chunk) { empty } else { chunk };
                let gap = if p!("same", index, zero) {
                    g!(*state, "space")
                } else {
                    empty
                };
                let cells = c!("displayWidth", chunk);
                if p!("gt", g!(g!(*state, "text"), "length"), zero)
                    && p!(
                        "gt",
                        c!(
                            "add",
                            c!("add", g!(*state, "width"), g!(gap, "length")),
                            cells
                        ),
                        *width
                    )
                {
                    r!("flush", *lines, *state);
                }
                if p!("gt", g!(g!(*state, "text"), "length"), zero)
                    && p!("gt", g!(gap, "length"), zero)
                {
                    set!(*state, "text", c!("add", g!(*state, "text"), gap));
                    set!(
                        *state,
                        "width",
                        c!("add", g!(*state, "width"), g!(gap, "length"))
                    );
                }
                set!(*state, "text", c!("add", g!(*state, "text"), chunk));
                set!(*state, "width", c!("add", g!(*state, "width"), cells));
                set!(*state, "space", empty);
                if p!("lt", index, c!("subtract", g!(chunks, "length"), one)) {
                    r!("flush", *lines, *state);
                }
                index = c!("add", index, one);
            }
        }
        ("flush", [lines, state]) => {
            c!("push", *lines, g!(*state, "text"));
            set!(*state, "text", empty);
            set!(*state, "width", zero);
            set!(*state, "space", empty);
        }
        ("word", [value, width]) => {
            let chunks = c!("array");
            if p!("le", c!("displayWidth", *value), *width) {
                c!("push", chunks, *value);
                return Ok(chunks);
            }
            let state = c!("object");
            set!(state, "text", empty);
            set!(state, "width", zero);
            walk!(
                "wordGrapheme",
                c!("graphemes", *value),
                *width,
                chunks,
                state
            );
            if p!("gt", g!(g!(state, "text"), "length"), zero) {
                c!("push", chunks, g!(state, "text"));
            }
            return Ok(chunks);
        }
        ("wordGrapheme", [unit, width, chunks, state]) => {
            let cells = c!("graphemeWidth", *unit);
            if p!("gt", g!(g!(*state, "text"), "length"), zero)
                && p!("gt", c!("add", g!(*state, "width"), cells), *width)
            {
                c!("push", *chunks, g!(*state, "text"));
                set!(*state, "text", empty);
                set!(*state, "width", zero);
            }
            set!(*state, "text", c!("add", g!(*state, "text"), *unit));
            set!(*state, "width", c!("add", g!(*state, "width"), cells));
        }
        ("render", [buffer, rect, items, offset, options]) => {
            c!("invoke", g!(*buffer, "clearRect"), *buffer, *rect);
            if p!("le", g!(*rect, "width"), zero) || p!("le", g!(*rect, "height"), zero) {
                return Ok(zero);
            }
            let items = if p!("truthy", g!(*options, "conversation"))
                && !p!("truthy", g!(*options, "details"))
            {
                r!("fold", *items)
            } else {
                *items
            };
            let view = c!(
                "viewport",
                items,
                g!(*rect, "height"),
                *offset,
                *rect,
                *options
            );
            let lines = g!(view, "rows");
            let actual = g!(view, "offset");
            let text_rect = c!(
                "rect",
                c!("add", g!(*rect, "x"), three),
                g!(*rect, "y"),
                c!("subtract", g!(*rect, "width"), three),
                g!(*rect, "height")
            );
            let mut row = zero;
            while p!("lt", row, g!(*rect, "height")) {
                let line = c!("at", lines, row);
                if !p!("same", line, undefined) {
                    put!(
                        *buffer,
                        *rect,
                        row,
                        g!(line, "prefix"),
                        g!(line, "prefixStyle")
                    );
                    if p!("truthy", g!(line, "segments"))
                        && p!("gt", g!(g!(line, "segments"), "length"), zero)
                    {
                        let state = c!("object");
                        set!(state, "x", zero);
                        c!(
                            "walkUntil",
                            l!("paintSegment"),
                            g!(line, "segments"),
                            *buffer,
                            text_rect,
                            row,
                            state
                        );
                    } else {
                        put!(*buffer, text_rect, row, g!(line, "text"), g!(line, "style"));
                    }
                }
                row = c!("add", row, one);
            }
            return Ok(actual);
        }
        ("paintSegment", [segment, buffer, rect, row, state]) => {
            if p!("same", g!(g!(*segment, "text"), "length"), zero) {
                return Ok(undefined);
            }
            let remaining = c!("subtract", g!(*rect, "width"), g!(*state, "x"));
            if p!("le", remaining, zero) {
                return Ok(c!("true"));
            }
            // Resolve the drawing method before evaluating its arguments.
            let method = g!(*buffer, "putInRect");
            let target = c!(
                "rect",
                c!("add", g!(*rect, "x"), g!(*state, "x")),
                g!(*rect, "y"),
                remaining,
                g!(*rect, "height")
            );
            c!(
                "invoke",
                method,
                *buffer,
                target,
                *row,
                g!(*segment, "text"),
                g!(*segment, "style")
            );
            set!(
                *state,
                "x",
                c!(
                    "add",
                    g!(*state, "x"),
                    c!("displayWidth", g!(*segment, "text"), g!(*state, "x"))
                )
            );
        }
        ("itemRows", [item, rect, options, offset]) => {
            if p!("truthy", g!(*options, "conversation"))
                && p!("same", g!(*item, "role"), l!("reasoning"))
                && !p!("truthy", g!(*options, "details"))
            {
                return Ok(c!("array"));
            }
            let mut label = g!(*item, "text");
            let elapsed = if p!("same", g!(*options, "now"), undefined) {
                zero
            } else {
                c!("subtract", g!(*options, "now"), g!(*item, "ts"))
            };
            if p!("truthy", g!(*options, "conversation"))
                && p!("same", g!(*item, "role"), l!("action"))
                && p!("same", g!(*item, "kind"), l!("tool"))
                && p!("finite", elapsed)
                && p!("ge", elapsed, host.number(1000.)?)
            {
                let duration = c!("formatElapsed", elapsed);
                let duration = if p!("ge", elapsed, host.number(3_600_000.)?) {
                    duration
                } else {
                    c!("elapsedSlice", duration)
                };
                label = c!("durationLabel", label, duration);
            }
            let text = if p!("truthy", g!(*options, "details")) && p!("truthy", g!(*item, "detail"))
            {
                if p!("same", g!(*item, "role"), l!("plan")) {
                    g!(*item, "detail")
                } else {
                    c!("details", label, g!(*item, "detail"))
                }
            } else {
                label
            };
            let agent = if p!("truthy", g!(*options, "conversation"))
                && p!("same", g!(*item, "role"), l!("agent"))
            {
                r!(
                    "agent",
                    *item,
                    g!(*rect, "width"),
                    c!(
                        "add",
                        c!("add", g!(*rect, "height"), *offset),
                        host.number(4.)?
                    )
                )
            } else {
                undefined
            };
            let cached = if p!("nullish", agent) {
                undefined
            } else {
                g!(agent, "lines")
            };
            let lines = if p!("nullish", cached) {
                let value = if p!("same", text, g!(*item, "text")) {
                    *item
                } else {
                    c!("replaceText", *item, text)
                };
                let items = c!("array");
                c!("push", items, value);
                r!("compute", items, g!(*rect, "width"), c!("false"))
            } else {
                cached
            };
            if !p!("truthy", g!(*options, "conversation")) {
                return Ok(lines);
            }
            let prose = p!("same", g!(*item, "role"), l!("agent"))
                || p!("same", g!(*item, "role"), l!("user"));
            if prose {
                while p!("gt", g!(lines, "length"), zero)
                    && p!(
                        "same",
                        g!(
                            c!(
                                "trim",
                                g!(
                                    c!("at", lines, c!("subtract", g!(lines, "length"), one)),
                                    "text"
                                )
                            ),
                            "length"
                        ),
                        zero
                    )
                {
                    c!("pop", lines);
                }
                while p!("gt", g!(lines, "length"), zero)
                    && p!(
                        "same",
                        g!(c!("trim", g!(c!("at", lines, zero), "text")), "length"),
                        zero
                    )
                {
                    c!("shift", lines);
                }
            }
            let style = if p!("same", g!(*item, "kind"), l!("error")) {
                g!(g!(c!("getTheme"), "styles"), "error")
            } else if prose {
                c!("object")
            } else {
                g!(g!(c!("getTheme"), "styles"), "muted")
            };
            let prefix = if p!("same", g!(*item, "role"), l!("user")) {
                l!("›")
            } else if p!("same", g!(*item, "role"), l!("agent")) {
                l!("•")
            } else if p!("same", g!(*item, "kind"), l!("tool")) {
                l!("›")
            } else if p!("same", g!(*item, "kind"), l!("success")) {
                l!("✓")
            } else if p!("same", g!(*item, "kind"), l!("error")) {
                l!("!")
            } else {
                l!("·")
            };
            let mut index = zero;
            while p!("lt", index, g!(lines, "length")) {
                let line = c!("at", lines, index);
                let complete = if p!("nullish", agent) {
                    undefined
                } else {
                    g!(agent, "complete")
                };
                let head = if p!("same", index, zero) && !p!("same", complete, c!("false")) {
                    prefix
                } else {
                    empty
                };
                set!(line, "prefix", head);
                set!(line, "prefixStyle", style);
                set!(line, "style", style);
                index = c!("add", index, one);
            }
            if prose && p!("gt", g!(lines, "length"), zero) {
                c!(
                    "push",
                    lines,
                    c!("line", empty, c!("object"), c!("object"), empty)
                );
            }
            return Ok(lines);
        }
        ("fold", [items]) => {
            let result = c!("array");
            let state = c!("object");
            set!(state, "completed", c!("array"));
            walk!("foldItem", *items, result, state);
            r!("foldFlush", result, state);
            return Ok(result);
        }
        ("foldItem", [item, result, state]) => {
            if p!("same", g!(*item, "role"), l!("reasoning")) {
                return Ok(undefined);
            }
            if p!("same", g!(*item, "role"), l!("action"))
                && p!("same", g!(*item, "kind"), l!("success"))
            {
                c!("push", g!(*state, "completed"), *item);
            } else {
                r!("foldFlush", *result, *state);
                c!("push", *result, *item);
            }
        }
        ("foldFlush", [result, state]) => {
            let completed = g!(*state, "completed");
            if p!("ge", g!(completed, "length"), host.number(4.)?) {
                let summary = c!(
                    "summary",
                    c!("subtract", g!(completed, "length"), host.number(2.)?),
                    g!(c!("at", completed, zero), "ts")
                );
                let tail = c!("slice", completed, host.number(-2.)?);
                c!("push", *result, summary);
                c!("appendAll", *result, tail);
            } else {
                c!("appendAll", *result, completed);
            }
            set!(*state, "completed", c!("array"));
        }
        ("agent", [item, width, budget]) => {
            let theme = c!("getTheme");
            let color = c!("supportsColor");
            let cached = c!("cacheGet", *item);
            let old_text = if p!("nullish", cached) {
                undefined
            } else {
                g!(cached, "text")
            };
            if p!("same", old_text, g!(*item, "text"))
                && p!("same", g!(cached, "width"), *width)
                && p!("same", g!(cached, "theme"), theme)
                && p!("same", g!(cached, "color"), color)
                && (p!("truthy", g!(cached, "complete")) || p!("ge", g!(cached, "budget"), *budget))
            {
                return Ok(c!(
                    "agentResult",
                    c!("cloneLines", g!(cached, "lines")),
                    g!(cached, "complete")
                ));
            }
            let state = c!("object");
            set!(state, "complete", c!("true"));
            let attempt = c!("attemptMarkdown", *item, *width, *budget, state);
            let lines = if p!("truthy", g!(attempt, "failed")) {
                let items = c!("array");
                c!("push", items, *item);
                r!("compute", items, *width, c!("false"))
            } else {
                g!(attempt, "value")
            };
            c!(
                "cacheSet",
                *item,
                c!(
                    "cached",
                    g!(*item, "text"),
                    *width,
                    theme,
                    color,
                    *budget,
                    g!(state, "complete"),
                    lines
                )
            );
            return Ok(c!(
                "agentResult",
                c!("cloneLines", lines),
                g!(state, "complete")
            ));
        }
        ("agentBuild", [item, width, budget, state]) => {
            let ast = g!(c!("parse", g!(*item, "text")), "ast");
            let options = c!(
                "renderOptions",
                c!("max", one, c!("subtract", *width, three))
            );
            let text =
                if !p!("same", g!(ast, "type"), l!("root")) || p!("truthy", r!("footnotes", ast)) {
                    c!("render", ast, options)
                } else {
                    let fragments = c!("array");
                    let mut rows = zero;
                    let mut index = c!("subtract", g!(g!(ast, "children"), "length"), one);
                    while p!("ge", index, zero) && p!("lt", rows, *budget) {
                        let fragment = c!("render", c!("at", g!(ast, "children"), index), options);
                        c!("push", fragments, fragment);
                        rows = c!("add", rows, c!("newlineCount", fragment));
                        index = c!("subtract", index, one);
                    }
                    set!(*state, "complete", c!("lt", index, zero));
                    c!("reverseJoin", fragments)
                };
            let items = c!("array");
            c!("push", items, c!("replaceText", *item, text));
            return Ok(r!("compute", items, *width, c!("true")));
        }
        ("footnotes", [node]) => {
            let found = p!("same", g!(*node, "type"), l!("footnoteDefinition"))
                || p!("same", g!(*node, "type"), l!("footnoteReference"))
                || (p!("hasChildren", *node) && p!("someFootnotes", g!(*node, "children")));
            return Ok(if found { c!("true") } else { c!("false") });
        }
        _ => return host.call("invalidOperation", vec![]),
    }
    Ok(undefined)
}
