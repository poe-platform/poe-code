//! Detail and inspector card composition with host-owned themes and collections.
use crate::table::Host;

fn predicate<H: Host>(host: &mut H, name: &str, args: Vec<H::Value>) -> Result<bool, H::Error> {
    let value = host.call(name, args)?;
    host.is_true(value)
}

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("detail", [options]) => {
            let width = host.call("width", vec![*options])?;
            let header = host.call("header", vec![*options])?;
            let subtitle = host.get(*options, "subtitle")?;
            let subtitle = if predicate(host, "truthy", vec![subtitle])? {
                host.call("subtitle", vec![*options])?
            } else {
                host.call("undefined", vec![])?
            };
            let identity = host.call("identity", vec![header, subtitle])?;
            let hero = if predicate(host, "hasBadges", vec![*options])? {
                host.call("hero", vec![*options, identity])?
            } else {
                identity
            };
            let blocks = host.call("start", vec![hero])?;
            host.call("proseBlocks", vec![*options, width, blocks])?;
            host.call("sectionBlocks", vec![*options, width, blocks])?;
            host.call("blocks", vec![blocks])
        }
        ("prose", [options, prose, width]) => {
            let title = host.get(*prose, "title")?;
            let titled = predicate(host, "truthy", vec![title])?;
            host.call(
                if titled { "titledProse" } else { "plainProse" },
                vec![*options, *prose, *width],
            )
        }
        ("section", [options, section, width, blocks]) => {
            let rows = host.get(*section, "rows")?;
            if predicate(host, "emptyArray", vec![rows])? {
                return host.call("undefined", vec![]);
            }
            let rows = host.get(*section, "rows")?;
            let theme = host.get(*options, "theme")?;
            let rows = run(host, "rows", &[rows, theme, *width])?;
            host.call("pushSection", vec![*options, *section, rows, *blocks])
        }
        ("sectionContent", [options, section, rows]) => {
            let title = host.get(*section, "title")?;
            let titled = predicate(host, "truthy", vec![title])?;
            host.call(
                if titled {
                    "titledSection"
                } else {
                    "plainSection"
                },
                vec![*options, *section, *rows],
            )
        }
        ("rows", [rows, theme, width]) => {
            if predicate(host, "emptyArray", vec![*rows])? {
                return host.call("array", vec![]);
            }
            let label = host.call("labelWidth", vec![*rows])?;
            let value = host.call("valueWidth", vec![*width, label])?;
            let continuation = host.call("continuation", vec![label])?;
            host.call(
                "renderRows",
                vec![*rows, *theme, label, value, continuation],
            )
        }
        ("row", [row, theme, label, value, continuation]) => {
            let text = host.get(*row, "value")?;
            let values = host.call("wrap", vec![text, *value])?;
            host.call(
                "rowLines",
                vec![*row, *theme, *label, values, *continuation],
            )
        }
        ("inspector", [options]) => {
            let value = host.get(*options, "preview")?;
            let limit = host.call("previewLimit", vec![*options])?;
            let preview = run(host, "preview", &[value, limit])?;
            let sections = host.call("inspectorSections", vec![*options])?;
            let details = host.call("detailOptions", vec![*options, preview, sections])?;
            run(host, "detail", &[details])
        }
        ("hasFields", [section]) => {
            let fields = host.get(*section, "fields")?;
            host.call("nonemptyArray", vec![fields])
        }
        ("previewProse", [options, preview]) => {
            if host.is_undefined(*preview)? {
                host.call("undefined", vec![])
            } else {
                host.call("proseOption", vec![*options, *preview])
            }
        }
        ("preview", [value, limit]) => {
            if host.is_undefined(*value)? {
                return host.call("undefined", vec![]);
            }
            let lines = host.call("previewLines", vec![*value])?;
            let first = host.call("firstContent", vec![lines])?;
            let content = if predicate(host, "missingContent", vec![first])? {
                host.call("array", vec![])?
            } else {
                host.call("sliceContent", vec![lines, first])?
            };
            if predicate(host, "emptyArray", vec![content])? {
                return host.call("undefined", vec![]);
            }
            let length = host.get(content, "length")?;
            let fits = predicate(host, "le", vec![length, *limit])?;
            host.call(
                if fits {
                    "joinLines"
                } else {
                    "truncatedPreview"
                },
                vec![content, *limit],
            )
        }
        ("previewLine", [line]) => {
            if predicate(host, "endsCR", vec![*line])? {
                host.call("withoutCR", vec![*line])
            } else {
                Ok(*line)
            }
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
