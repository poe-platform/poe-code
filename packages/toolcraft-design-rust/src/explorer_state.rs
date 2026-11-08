//! Explorer pane normalization, initial state, action ownership and viewport modes.
use crate::feedback::Host;

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{let name=$name;let args=vec![$($arg),*];host.call(name,args)?}}; }
    macro_rules! g {
        ($value:expr,$key:expr) => {{
            let value = $value;
            host.get(value, $key)?
        }};
    }
    macro_rules! p { ($name:expr $(,$arg:expr)* $(,)?) => {{let value=c!($name $(,$arg)*);host.is_true(value)?}}; }
    macro_rules! l {
        ($text:expr) => {
            host.literal($text)?
        };
    }
    macro_rules! n {
        ($number:expr) => {
            host.number($number)?
        };
    }
    macro_rules! set {
        ($value:expr,$key:expr,$item:expr) => {
            c!("assign", $value, l!($key), $item)
        };
    }
    macro_rules! method { ($value:expr,$key:expr $(,$arg:expr)*) => {{let receiver=$value;c!("invoke",g!(receiver,$key),receiver $(,$arg)*)}}; }
    macro_rules! obj { ($($key:expr => $value:expr),* $(,)?) => {{let object=c!("object");$(set!(object,$key,$value);)*object}}; }
    macro_rules! opt {
        ($value:expr,$key:expr) => {
            c!("optionalGet", $value, l!($key))
        };
    }
    macro_rules! fallback {
        ($value:expr,$default:expr) => {{
            let value = $value;
            if p!("nullish", value) {
                $default
            } else {
                value
            }
        }};
    }
    macro_rules! call { ($name:expr $(,$arg:expr)*) => {{let args=vec![$($arg),*];run(host,$name,&args)?}}; }
    let undefined = c!("undefined");
    match operation {
        "regions" => {
            let regions = c!("object");
            for (index, key) in [
                "REGION_HEADER",
                "REGION_LIST",
                "REGION_DETAIL",
                "REGION_FOOTER",
                "REGION_MODAL",
                "REGION_TOAST",
            ]
            .iter()
            .enumerate()
            {
                set!(regions, key, n!((1u32 << index) as f64));
            }
            set!(regions, "REGION_ALL", n!(63.));
            Ok(regions)
        }
        "normalize" => {
            let config = args[0];
            if p!("same", g!(config, "panes"), undefined) {
                if p!("same", g!(config, "rows"), undefined)
                    || p!("same", g!(config, "detail"), undefined)
                {
                    c!("error", l!("Explorer requires panes"));
                }
                return Ok(config);
            }
            if p!("lt", g!(g!(config, "panes"), "length"), n!(1.))
                || p!("gt", g!(g!(config, "panes"), "length"), n!(3.))
            {
                c!("error", l!("Explorer requires 1 to 3 panes"));
            }
            let list = c!("findList", g!(config, "panes"));
            if p!("same", list, undefined) {
                c!("error", l!("Explorer requires a list pane"));
            }
            let companion = c!("findCompanion", g!(config, "panes"), list);
            let detail = if p!("same", opt!(companion, "kind"), l!("detail")) {
                c!("detail", companion)
            } else if p!("same", opt!(companion, "kind"), l!("list")) {
                let detail = c!("listDetail", companion);
                set!(detail, "actions", g!(config, "actions"));
                detail
            } else {
                c!("emptyDetail")
            };
            let normalized = c!("spread", config);
            set!(normalized, "rows", g!(list, "rows"));
            set!(normalized, "detail", detail);
            set!(
                normalized,
                "multiSelect",
                fallback!(g!(list, "multiSelect"), g!(config, "multiSelect"))
            );
            set!(
                normalized,
                "emptyHint",
                fallback!(g!(list, "emptyHint"), g!(config, "emptyHint"))
            );
            Ok(normalized)
        }
        "isList" => Ok(c!("same", g!(args[0], "kind"), l!("list"))),
        "detailResult" => {
            let items = c!("array");
            if p!("truthy", g!(g!(args[1], "signal"), "aborted")) {
                return Ok(items);
            }
            let item = obj!("id"=>g!(args[0],"id"),"render"=>c!("content",args[2]),"renderedContent"=>args[2]);
            method!(items, "push", item);
            Ok(items)
        }
        "listResult" => Ok(c!("mapRows", args[0])),
        "listRow" => {
            let item = c!("spread", args[0]);
            set!(item, "render", c!("emptyRender"));
            Ok(item)
        }
        "size" => {
            let value = args[0];
            Ok(if p!("finite", value) {
                c!("max", n!(0.), c!("floor", value))
            } else {
                n!(0.)
            })
        }
        "layout" => {
            let cols = args[0];
            let rows = args[1];
            let mode = if p!("lt", cols, n!(60.)) || p!("lt", rows, n!(8.)) {
                "too-narrow"
            } else if p!("lt", cols, n!(80.)) {
                "narrow-list-only"
            } else if p!("lt", cols, n!(100.)) {
                "narrow-vertical"
            } else if p!("lt", cols, n!(120.)) {
                "medium"
            } else {
                "wide"
            };
            Ok(l!(mode))
        }
        "create" => {
            let config = call!("normalize", args[0]);
            let size = obj!("cols"=>call!("size",g!(args[1],"cols")),"rows"=>call!("size",g!(args[1],"rows")));
            let multi = fallback!(g!(config, "multiSelect"), c!("true"));
            let rows = fallback!(g!(config, "initialRows"), c!("array"));
            let filter = fallback!(g!(config, "initialFilter"), l!(""));
            let state = obj!(
                "title"=>g!(config,"title"),"emptyHint"=>fallback!(g!(config,"emptyHint"),l!("No detail")),
                "rows"=>rows,"rowsLoading"=>c!("true"),"filtered"=>c!("indices",rows),"matchPositions"=>c!("map"),
                "cursor"=>n!(0.),"filter"=>filter,"filterFocused"=>c!("false"),"focused"=>l!("list"),
                "detail"=>obj!("rowId"=>fallback!(opt!(c!("at",rows,n!(0.)),"id"),c!("null")),
                  "items"=>c!("null"),"allItems"=>c!("null"),"filter"=>l!(""),"cursor"=>n!(0.),"scroll"=>n!(0.),
                  "token"=>if p!("gt",g!(rows,"length"),n!(0.)){n!(1.)}else{n!(0.)},"loading"=>c!("gt",g!(rows,"length"),n!(0.))),
                "selected"=>c!("set"),"multiSelect"=>multi,"modal"=>c!("null"),"toast"=>c!("null"),"dirty"=>n!(63.),
                "size"=>size,"layout"=>call!("layout",g!(size,"cols"),g!(size,"rows")),"bindings"=>c!("resolveBindings",config),
                "actionState"=>call!("actions",config),"suspended"=>c!("false"),
                "paneDefinitions"=>fallback!(c!("definitions",g!(config,"panes")),{
                    let panes=c!("array");method!(panes,"push",obj!("id"=>l!("list"),"title"=>g!(config,"title"),"kind"=>l!("list")));
                    method!(panes,"push",obj!("id"=>l!("detail"),"title"=>l!("Preview"),"kind"=>l!("detail")));panes
                })
            );
            Ok(state)
        }
        "pane" => {
            let pane = obj!("id"=>args[0],"title"=>args[1],"kind"=>args[2]);
            if p!("same", args[2], l!("detail")) && p!("has", args[3], l!("titleForRow")) {
                set!(pane, "titleForRow", g!(args[3], "titleForRow"));
            }
            Ok(pane)
        }
        "actions" => {
            let config = args[0];
            let state = c!("map");
            let groups = [
                ("row", g!(config, "actions")),
                (
                    "detail",
                    fallback!(opt!(g!(config, "detail"), "actions"), c!("array")),
                ),
            ];
            for (source, actions) in groups {
                c!("walk", l!("action"), actions, state, config, l!(source));
            }
            Ok(state)
        }
        "action" => {
            let action = args[0];
            let state = args[1];
            let config = args[2];
            if p!("truthy", method!(state, "has", g!(action, "id"))) {
                if !p!("same", c!("sharedList", config), c!("true")) {
                    c!("error", c!("duplicate", action));
                }
                let existing = method!(state, "get", g!(action, "id"));
                let id = g!(action, "id");
                let updated = c!("spread", existing);
                set!(updated, "source", l!("both"));
                method!(state, "set", id, updated);
                return Ok(undefined);
            }
            let id = g!(action, "id");
            let item = obj!("available"=>c!("true"),"label"=>if p!("callable",g!(action,"label")){g!(action,"id")}else{g!(action,"label")},"action"=>action,"source"=>args[3]);
            method!(state, "set", id, item);
            Ok(undefined)
        }
        "sharedPane" => Ok(c!(if p!("same", g!(args[0], "kind"), l!("list"))
            && !p!("same", args[0], opt!(g!(args[1], "panes"), "0"))
        {
            "true"
        } else {
            "false"
        })),
        _ => host.call("invalidOperation", vec![]),
    }
}
