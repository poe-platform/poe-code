//! Explorer accelerator resolution, selection and live action contexts.
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
    macro_rules! l {
        ($value:expr) => {
            host.literal($value)?
        };
    }
    macro_rules! n {
        ($value:expr) => {{
            let value = $value;
            host.number(value)?
        }};
    }
    macro_rules! set {
        ($value:expr,$key:expr,$item:expr) => {
            c!("assign", $value, l!($key), $item)
        };
    }
    macro_rules! obj { ($($key:expr => $value:expr),* $(,)?) => {{let object=c!("object");$(set!(object,$key,$value);)*object}}; }
    macro_rules! opt {
        ($value:expr,$key:expr) => {
            c!("optionalGet", $value, l!($key))
        };
    }
    macro_rules! fallback {
        ($value:expr,$other:expr) => {{
            let value = $value;
            if p!("nullish", value) { $other } else { value }
        }};
    }
    macro_rules! call { ($name:expr $(,$arg:expr)*) => {{let args=vec![$($arg),*];run(host,$name,&args)?}}; }
    macro_rules! method { ($value:expr,$key:expr $(,$arg:expr)*) => {{let receiver=$value;c!("invoke",g!(receiver,$key),receiver $(,$arg)*)}}; }
    let undefined = c!("undefined");
    match operation {
        "resolve" => {
            let state = args[0];
            let target = method!(g!(state, "bindings"), "resolve", args[1]);
            if !p!("same", opt!(target, "type"), l!("action")) {
                return Ok(c!("null"));
            }
            let action = method!(g!(state, "actionState"), "get", g!(target, "id"));
            if !p!("same", opt!(action, "available"), c!("true"))
                || p!("same", g!(action, "running"), c!("true"))
                || p!("same", g!(action, "action"), undefined)
            {
                return Ok(c!("null"));
            }
            Ok(g!(action, "action"))
        }
        "context" => {
            let state = args[0];
            let source = args[2];
            let handles = args[3];
            let rows = args[4];
            let detail_active =
                p!("same", source, l!("both")) && p!("same", g!(state, "focused"), l!("detail"));
            let row = fallback!(
                c!("optionalGet", rows, n!(0.)),
                fallback!(
                    if detail_active {
                        call!("detailRow", state)
                    } else {
                        call!("row", state)
                    },
                    obj!("id"=>l!(""),"title"=>l!(""))
                )
            );
            let panes = call!("panes", state);
            let result = obj!(
                "row"=>row,
                "rows"=>fallback!(rows,call!("rows",state,row)),
                "item"=>if p!("same",source,l!("detail")) || detail_active {call!("item",state)}else{undefined},
                "filter"=>g!(state,"filter"),
            );
            for key in [
                "refresh",
                "reloadDetail",
                "suspendAnd",
                "openModal",
                "toast",
                "confirm",
                "promptText",
                "exit",
            ] {
                set!(result, key, g!(handles, key));
            }
            set!(
                result,
                "activePane",
                c!(
                    "at",
                    panes,
                    n!(if p!("same", g!(state, "focused"), l!("detail")) {
                        1.
                    } else {
                        0.
                    })
                )
            );
            set!(
                result,
                "inactivePane",
                c!(
                    "at",
                    panes,
                    n!(if p!("same", g!(state, "focused"), l!("detail")) {
                        0.
                    } else {
                        1.
                    })
                )
            );
            Ok(result)
        }
        "row" => {
            let state = args[0];
            Ok(c!(
                "at",
                g!(state, "rows"),
                fallback!(
                    c!("at", g!(state, "filtered"), g!(state, "cursor")),
                    n!(-1.)
                )
            ))
        }
        "item" => {
            let state = args[0];
            let items = g!(g!(state, "detail"), "items");
            Ok(if p!("nullish", items) {
                undefined
            } else {
                c!("at", items, g!(g!(state, "detail"), "cursor"))
            })
        }
        "detailRow" => {
            let item = call!("item", args[0]);
            Ok(if p!("same", item, undefined) {
                undefined
            } else {
                call!("itemRow", item)
            })
        }
        "itemRow" => {
            let item = args[0];
            Ok(
                obj!("id"=>g!(item,"id"),"title"=>fallback!(g!(item,"title"),g!(item,"id")),"subtitle"=>g!(item,"subtitle"),"badge"=>g!(item,"badge")),
            )
        }
        "rows" => {
            let state = args[0];
            let row = args[1];
            if !p!("truthy", g!(state, "multiSelect"))
                || p!("same", g!(g!(state, "selected"), "size"), n!(0.))
            {
                let rows = c!("array");
                if !p!("same", g!(row, "id"), l!("")) {
                    method!(rows, "push", row);
                }
                return Ok(rows);
            }
            let rows = if p!("same", g!(state, "focused"), l!("detail")) {
                c!(
                    "mapDetails",
                    fallback!(g!(g!(state, "detail"), "items"), c!("array"))
                )
            } else {
                g!(state, "rows")
            };
            Ok(c!("filterSelected", rows, state))
        }
        "selected" => Ok(method!(g!(args[0], "selected"), "has", g!(args[1], "id"))),
        "panes" => {
            let state = args[0];
            let definitions = g!(state, "paneDefinitions");
            let list = obj!(
                "id"=>fallback!(opt!(c!("at",definitions,n!(0.)),"id"),l!("list")),
                "title"=>fallback!(opt!(c!("at",definitions,n!(0.)),"title"),g!(state,"title")),
                "rows"=>g!(state,"rows"),"cursor"=>g!(state,"cursor"),"selected"=>g!(state,"selected"),"filter"=>g!(state,"filter"),
            );
            let detail = obj!(
                "id"=>fallback!(opt!(c!("at",definitions,n!(1.)),"id"),l!("detail")),
                "title"=>fallback!(opt!(c!("at",definitions,n!(1.)),"title"),l!("Preview")),
                "rows"=>c!("mapDetails",fallback!(g!(g!(state,"detail"),"items"),c!("array"))),
                "cursor"=>g!(g!(state,"detail"),"cursor"),"selected"=>g!(state,"selected"),"filter"=>l!(""),
            );
            Ok(c!("pair", list, detail))
        }
        _ => Ok(c!("invalidOperation")),
    }
}
