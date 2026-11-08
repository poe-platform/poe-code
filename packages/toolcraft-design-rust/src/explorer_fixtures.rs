//! Public explorer fixture construction and snapshot traversal.
use crate::feedback::Host;
use mcp_protocol_rust::json::{self, Limits, Value};
use std::sync::OnceLock;

pub fn data(kind: &str) -> Value {
    static DATA: OnceLock<Value> = OnceLock::new();
    DATA.get_or_init(|| {
        json::parse(
            include_bytes!("explorer_fixture_data.json"),
            Limits::default(),
        )
        .expect("embedded explorer fixture data is valid JSON")
    })
    .get(kind)
    .cloned()
    .unwrap_or(Value::Null)
}
fn set<H: Host>(
    host: &mut H,
    object: H::Value,
    key: &'static str,
    value: H::Value,
) -> Result<(), H::Error> {
    let key = host.literal(key)?;
    host.call("set", vec![object, key, value])?;
    Ok(())
}
fn object<H: Host>(
    host: &mut H,
    fields: &[(&'static str, H::Value)],
) -> Result<H::Value, H::Error> {
    let object = host.call("object", vec![])?;
    for (key, value) in fields {
        let key = host.literal(key)?;
        host.call("define", vec![object, key, *value])?;
    }
    Ok(object)
}
fn nullish<H: Host>(host: &mut H, value: H::Value) -> Result<bool, H::Error> {
    let result = host.call("nullish", vec![value])?;
    host.is_true(result)
}
fn fixture_data<H: Host>(host: &mut H, key: &'static str) -> Result<H::Value, H::Error> {
    let key = host.literal(key)?;
    host.call("data", vec![key])
}
pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{let args=vec![$($arg),*];host.call($name,args)?}}; }
    match (operation, args) {
        ("single", []) => {
            let item = fixture_data(host, "single")?;
            let render = c!("singleRender");
            set(host, item, "render", render)?;
            Ok(item)
        }
        ("singleRender", []) => {
            let lines = fixture_data(host, "singleLines")?;
            host.call("join", vec![lines])
        }
        ("list", []) => {
            let items = fixture_data(host, "details")?;
            for index in 0..2 {
                let index = host.number(f64::from(index))?;
                let item = c!("at", items, index);
                let render = c!("listRender", index);
                set(host, item, "render", render)?;
            }
            Ok(items)
        }
        ("listRender", [index]) => {
            let bodies = fixture_data(host, "detailBodies")?;
            host.call("at", vec![bodies, *index])
        }
        ("actions", []) => {
            let actions = fixture_data(host, "actions")?;
            for index in 0..4 {
                let index = host.number(f64::from(index))?;
                let action = c!("at", actions, index);
                let handler = c!("handler");
                set(host, action, "handler", handler)?;
            }
            Ok(actions)
        }
        ("state", [overrides]) => {
            let mut rows = host.get(*overrides, "rows")?;
            if nullish(host, rows)? {
                rows = fixture_data(host, "rows")?;
            }
            let mut filter = host.get(*overrides, "filter")?;
            if nullish(host, filter)? {
                filter = host.literal("")?;
            }
            let mut size = host.get(*overrides, "size")?;
            if nullish(host, size)? {
                let cols = host.number(100.)?;
                let rows = host.number(14.)?;
                size = object(host, &[("cols", cols), ("rows", rows)])?;
            }
            let mut title = host.get(*overrides, "title")?;
            if nullish(host, title)? {
                title = host.literal("Plans")?;
            }
            let row_loader = c!("rowLoader", rows);
            let items = c!("emptyItems");
            let detail = object(host, &[("items", items)])?;
            let actions = run(host, "actions", &[])?;
            let yes = c!("true");
            let hint = host.literal("No plans")?;
            let config = object(
                host,
                &[
                    ("title", title),
                    ("rows", row_loader),
                    ("detail", detail),
                    ("actions", actions),
                    ("multiSelect", yes),
                    ("emptyHint", hint),
                ],
            )?;
            let state = c!("initialState", config, size);
            set(host, state, "rows", rows)?;
            set(host, state, "filter", filter)?;
            let matches = c!("filterRows", filter, rows);
            let filtered = c!("indices", matches);
            set(host, state, "filtered", filtered)?;
            let positions = c!("positions", matches);
            set(host, state, "matchPositions", positions)?;
            let mut cursor = host.get(*overrides, "cursor")?;
            if nullish(host, cursor)? {
                cursor = host.number(0.)?;
            }
            set(host, state, "cursor", cursor)?;
            let mut detail = host.get(*overrides, "detail")?;
            if nullish(host, detail)? {
                let zero = host.number(0.)?;
                let row = c!("at", rows, zero);
                let mut row_id = if nullish(host, row)? {
                    c!("undefined")
                } else {
                    host.get(row, "id")?
                };
                if nullish(host, row_id)? {
                    row_id = c!("null");
                }
                let item = run(host, "single", &[])?;
                let items = c!("array", item);
                let one = host.number(1.)?;
                let no = c!("false");
                detail = object(
                    host,
                    &[
                        ("rowId", row_id),
                        ("items", items),
                        ("cursor", zero),
                        ("scroll", zero),
                        ("token", one),
                        ("loading", no),
                    ],
                )?;
            }
            set(host, state, "detail", detail)?;
            let mut selected = host.get(*overrides, "selected")?;
            if nullish(host, selected)? {
                selected = c!("selected");
            }
            set(host, state, "selected", selected)?;
            let mut focused = host.get(*overrides, "focused")?;
            if nullish(host, focused)? {
                focused = host.literal("list")?;
            }
            set(host, state, "focused", focused)?;
            for key in ["modal", "toast"] {
                let mut value = host.get(*overrides, key)?;
                if nullish(host, value)? {
                    value = c!("null");
                }
                set(host, state, key, value)?;
            }
            let mut dirty = host.get(*overrides, "dirty")?;
            if nullish(host, dirty)? {
                dirty = c!("allRegions");
            }
            set(host, state, "dirty", dirty)?;
            let layout = c!("layout", size);
            let mode = host.get(layout, "mode")?;
            set(host, state, "layout", mode)?;
            c!("overrides", state, *overrides);
            Ok(state)
        }
        ("snapshot", [state]) => {
            let size = host.get(*state, "size")?;
            let cols = host.get(size, "cols")?;
            let size = host.get(*state, "size")?;
            let rows = host.get(size, "rows")?;
            let screen = c!("screen", cols, rows);
            c!("render", *state, screen);
            let output = run(host, "dump", &[screen])?;
            let lines = c!("split", output);
            let lines = c!("trimLines", lines);
            host.call("join", vec![lines])
        }
        ("dump", [screen]) => {
            let lines = c!("array");
            let mut y = 0.;
            loop {
                let row = host.number(y)?;
                let height = host.get(*screen, "height")?;
                let within = c!("lt", row, height);
                if !host.is_true(within)? {
                    break;
                }
                let mut line = host.literal("")?;
                let mut x = 0.;
                loop {
                    let col = host.number(x)?;
                    let width = host.get(*screen, "width")?;
                    let within = c!("lt", col, width);
                    if !host.is_true(within)? {
                        break;
                    }
                    let cell = c!("cell", *screen, col, row);
                    let text = c!("ansi", cell);
                    line = c!("concat", line, text);
                    x += 1.;
                }
                c!("push", lines, line);
                y += 1.;
            }
            host.call("join", vec![lines])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
