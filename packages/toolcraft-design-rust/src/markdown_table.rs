//! Terminal Markdown grid/stacked table selection and alignment policy.
use crate::{
    feedback::Host,
    markdown_render::{empty, nonempty, predicate},
};
pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("table", [node, ctx]) => {
            let rows = host.call("tableRows", vec![*node])?;
            if empty(host, rows)? {
                return host.literal("");
            }
            let count = host.call("columnCount", vec![*node, rows])?;
            let zero = host.number(0.)?;
            if predicate(host, "same", vec![count, zero])? {
                return host.literal("");
            }
            let rendered = host.call("renderedRows", vec![rows, count, *ctx])?;
            let widths = host.call("columnWidths", vec![rendered, count])?;
            let total = host.call("tableWidth", vec![widths])?;
            let width = host.get(*ctx, "width")?;
            if predicate(host, "gt", vec![total, width])? {
                return run(host, "stacked", &[rows, count, *ctx]);
            }
            let lines = host.call("alignedRows", vec![rendered, widths, *node, *ctx])?;
            let output = host.call("outputRows", vec![lines, widths, *ctx])?;
            host.call("paragraph", vec![output])
        }
        ("renderedCell", [cell, ctx]) => {
            let ty = host.call("optionalType", vec![*cell])?;
            if host.is_kind(ty, "tableCell")? {
                host.call("tableCell", vec![*cell, *ctx])
            } else {
                host.literal("")
            }
        }
        ("tableCell", [cell, ctx]) => host.call("tableCell", vec![*cell, *ctx]),
        ("alignedCell", [cell, row, widths, index, node, ctx]) => {
            let zero = host.number(0.)?;
            let cell = if predicate(host, "same", vec![*row, zero])? {
                host.call("header", vec![*cell, *ctx])?
            } else {
                *cell
            };
            let mut width = host.call("at", vec![*widths, *index])?;
            if host.is_undefined(width)? || predicate(host, "isNull", vec![width])? {
                width = zero;
            }
            let align = host.get(*node, "align")?;
            let align = host.call("at", vec![align, *index])?;
            run(host, "alignment", &[cell, width, align])
        }
        ("alignment", [value, width, align]) => {
            let extra = host.call("extraSpace", vec![*value, *width])?;
            let operation = if host.is_kind(*align, "right")? {
                "right"
            } else if host.is_kind(*align, "center")? {
                "center"
            } else {
                "left"
            };
            host.call(operation, vec![*value, extra])
        }
        ("outputRow", [row, index, lines, widths, ctx]) => {
            let line = host.call("tableLine", vec![*row])?;
            let zero = host.number(0.)?;
            if !predicate(host, "same", vec![*index, zero])? {
                return Ok(line);
            }
            let length = host.get(*lines, "length")?;
            let one = host.number(1.)?;
            if predicate(host, "same", vec![length, one])? {
                Ok(line)
            } else {
                host.call("tableDivider", vec![line, *widths, *ctx])
            }
        }
        ("stacked", [rows, count, ctx]) => {
            let zero = host.number(0.)?;
            let header = host.call("at", vec![*rows, zero])?;
            if host.is_undefined(header)? {
                return host.literal("");
            }
            let data = host.call("dataRows", vec![*rows])?;
            if empty(host, data)? {
                let lines = host.call("headerLines", vec![header, *count, *ctx])?;
                return if empty(host, lines)? {
                    host.literal("")
                } else {
                    host.call("paragraph", vec![lines])
                };
            }
            let blocks = host.call("stackedBlocks", vec![data, header, *count, *ctx])?;
            if empty(host, blocks)? {
                host.literal("")
            } else {
                host.call("stackedOutput", vec![blocks])
            }
        }
        ("stackedLabel", [cell, index, ctx]) => {
            let ty = host.call("optionalType", vec![*cell])?;
            if !host.is_kind(ty, "tableCell")? {
                return host.call("columnLabel", vec![*index]);
            }
            let label = host.call("labelText", vec![*cell, *ctx])?;
            if nonempty(host, label)? {
                Ok(label)
            } else {
                host.call("columnLabel", vec![*index])
            }
        }
        ("stackedValue", [cell, ctx]) => {
            let ty = host.call("optionalType", vec![*cell])?;
            if !host.is_kind(ty, "tableCell")? {
                return host.call("emptyTokens", vec![*ctx]);
            }
            let tokens = host.call("valueTokens", vec![*cell, *ctx])?;
            if nonempty(host, tokens)? {
                Ok(tokens)
            } else {
                host.call("emptyTokens", vec![*ctx])
            }
        }
        ("stackedField", [header, cell, index, ctx]) => {
            let tokens = host.call("fieldTokens", vec![*header, *cell, *index, *ctx])?;
            host.call("fieldOutput", vec![tokens, *ctx])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
