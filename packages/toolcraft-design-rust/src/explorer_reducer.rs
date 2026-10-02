//! Explorer event reduction with host-owned identities, iterators and deferred callbacks.
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
        ($text:expr) => {
            host.literal($text)?
        };
    }
    macro_rules! n {
        ($value:expr) => {
            host.number($value)?
        };
    }
    macro_rules! r { ($op:expr $(,$arg:expr)* $(,)?) => {{let args=[$($arg),*];run(host,$op,&args)?}}; }
    macro_rules! set {
        ($value:expr,$key:expr,$item:expr) => {
            c!("assign", $value, l!($key), $item)
        };
    }
    macro_rules! obj { ($($key:expr=>$value:expr),* $(,)?) => {{let object=c!("object");$(set!(object,$key,$value);)*object}}; }
    macro_rules! clone { ($value:expr $(,$key:expr=>$item:expr)* $(,)?) => {{let object=c!("spread",$value);$(set!(object,$key,$item);)*object}}; }
    macro_rules! m { ($value:expr,$key:expr $(,$arg:expr)* $(,)?) => {{let receiver=$value;c!("invoke",g!(receiver,$key),receiver $(,$arg)*)}}; }
    macro_rules! mc { ($value:expr,$key:expr,$message:expr $(,$arg:expr)* $(,)?) => {{let receiver=$value;c!("invokeChecked",g!(receiver,$key),receiver,l!($message) $(,$arg)*)}}; }
    macro_rules! fallback {
        ($value:expr,$other:expr) => {{
            let value = $value;
            if p!("nullish", value) { $other } else { value }
        }};
    }
    let zero = n!(0.);
    let one = n!(1.);
    let minus_one = n!(-1.);
    let undefined = c!("undefined");
    let null = c!("null");
    let yes = c!("true");
    let no = c!("false");
    macro_rules! opt {
        ($value:expr,$key:expr) => {{
            let value = $value;
            if p!("nullish", value) {
                undefined
            } else {
                g!(value, $key)
            }
        }};
    }
    macro_rules! opt_at {
        ($value:expr,$key:expr) => {{
            let value = $value;
            if p!("nullish", value) {
                undefined
            } else {
                c!("at", value, $key)
            }
        }};
    }
    macro_rules! eq {
        ($left:expr,$right:expr) => {
            p!("same", $left, $right)
        };
    }
    macro_rules! truth {
        ($value:expr) => {
            p!("truthy", $value)
        };
    }
    macro_rules! boolean {
        ($value:expr) => {
            if $value { yes } else { no }
        };
    }
    macro_rules! kind {
        ($state:expr,$kind:expr) => {
            eq!(opt!(g!($state, "modal"), "kind"), l!($kind))
        };
    }
    macro_rules! d { ($single:expr) => {c!("flag",l!($single))}; ($first:expr $(,$rest:expr)+) => {{let mut mask=c!("flag",l!($first));$(mask=c!("or",mask,c!("flag",l!($rest)));)*mask}}; }
    macro_rules! result { ($value:expr) => {obj!("state"=>$value,"effects"=>c!("noEffects"))}; }
    macro_rules! clamp {
        ($value:expr,$max:expr) => {{
            let value = $value;
            let max = $max;
            c!("min", max, c!("max", zero, value))
        }};
    }
    match (operation, args) {
        ("step", [state, event, handles]) => {
            let kind = g!(*event, "type");
            for (name, target, keys) in [
                ("key", "key", &["key"][..]),
                ("resize", "resize", &["cols", "rows"][..]),
                ("rowsLoaded", "rowsLoaded", &["rows"][..]),
                ("detailLoading", "detailLoading", &["rowId", "token"][..]),
                (
                    "detailLoaded",
                    "detailLoaded",
                    &["rowId", "token", "items"][..],
                ),
                (
                    "detailItemRendered",
                    "detailItemRendered",
                    &["rowId", "token", "itemIndex", "content"][..],
                ),
                (
                    "detailError",
                    "detailError",
                    &["rowId", "token", "error"][..],
                ),
                ("actionResolved", "actionResolved", &["actionId"][..]),
                ("toastExpired", "expireToast", &[][..]),
                ("suspendResumed", "suspendResumed", &["emit"][..]),
                ("modalDismissed", "modalDismissed", &["result"][..]),
            ] {
                if eq!(kind, l!(name)) {
                    let mut values = vec![*state];
                    for key in keys {
                        values.push(g!(*event, key));
                    }
                    if matches!(name, "key" | "suspendResumed" | "modalDismissed") {
                        values.push(*handles);
                    }
                    return run(host, target, &values);
                }
            }
            if eq!(kind, l!("modalOpened")) {
                return Ok(r!(
                    "setModal",
                    *state,
                    obj!("kind"=>l!("content"),"title"=>g!(*event,"title"),"content"=>g!(*event,"content"),"scroll"=>zero)
                ));
            }
        }
        ("key", [state, key, handles]) => {
            let target = mc!(
                g!(*state, "bindings"),
                "resolve",
                "state.bindings.resolve is not a function",
                *key
            );
            if eq!(opt!(target, "type"), l!("builtin")) && eq!(g!(target, "id"), l!("quit")) {
                let next = if eq!(g!(*state, "modal"), null) {
                    *state
                } else {
                    g!(r!("modalDismissed", *state, null, *handles), "state")
                };
                return Ok(
                    obj!("state"=>r!("markDirty",next,zero),"effects"=>c!("array",obj!("type"=>l!("exit"),"result"=>null))),
                );
            }
            if !eq!(g!(*state, "modal"), null) {
                return Ok(r!("modalKey", *state, *key, target, *handles));
            }
            if truth!(g!(*state, "filterFocused")) {
                return Ok(r!("filterKey", *state, *key, target, *handles));
            }
            if eq!(opt!(target, "type"), l!("action")) {
                if eq!(
                    opt!(
                        m!(g!(*state, "actionState"), "get", g!(target, "id")),
                        "running"
                    ),
                    yes
                ) {
                    mc!(
                        *handles,
                        "toast",
                        "runtimeHandles.toast is not a function",
                        l!("Action already running"),
                        l!("info")
                    );
                    return Ok(r!("mark", *state, zero));
                }
                if eq!(
                    opt!(
                        m!(g!(*state, "actionState"), "get", g!(target, "id")),
                        "source"
                    ),
                    l!("detail")
                ) && !eq!(g!(*state, "focused"), l!("detail"))
                {
                    return Ok(r!("mark", *state, zero));
                }
                let action = c!("resolveAction", *state, *key);
                return Ok(if eq!(action, null) {
                    r!("mark", *state, zero)
                } else {
                    r!("dispatchAction", *state, action, no, *handles, undefined)
                });
            }
            if eq!(opt!(target, "type"), l!("builtin")) {
                let id = g!(target, "id");
                for (name, op) in [
                    ("filter", "focusFilter"),
                    ("focusNext", "focusNext"),
                    ("toggleSelect", "toggleSelect"),
                    ("selectAll", "selectAll"),
                    ("clearSelection", "clearSelection"),
                ] {
                    if eq!(id, l!(name)) {
                        return Ok(r!(op, *state));
                    }
                }
                for (name, op) in [("escape", "escape"), ("confirm", "confirmKey")] {
                    if eq!(id, l!(name)) {
                        return Ok(r!(op, *state, *handles));
                    }
                }
                for (name, op, delta) in [
                    ("cursorUp", "moveCursor", -1.),
                    ("cursorDown", "moveCursor", 1.),
                    ("detailScrollDown", "detailScroll", 1.),
                    ("detailScrollUp", "detailScroll", -1.),
                    ("extendSelectionUp", "extendSelection", -1.),
                    ("extendSelectionDown", "extendSelection", 1.),
                    ("reorderUp", "reorder", -1.),
                    ("reorderDown", "reorder", 1.),
                ] {
                    if eq!(id, l!(name)) {
                        return Ok(r!(op, *state, n!(delta)));
                    }
                }
                if eq!(id, l!("help")) {
                    return Ok(r!("setModal", *state, obj!("kind"=>l!("help"))));
                }
                if eq!(id, l!("palette")) {
                    return Ok(r!(
                        "setModal",
                        *state,
                        obj!("kind"=>l!("palette"),"query"=>l!(""),"cursor"=>zero)
                    ));
                }
                if eq!(id, l!("top")) {
                    return Ok(r!("setCursor", *state, zero));
                }
                if eq!(id, l!("bottom")) {
                    return Ok(r!(
                        "setCursor",
                        *state,
                        c!("subtract", g!(g!(*state, "filtered"), "length"), one)
                    ));
                }
                for (name, negative, half) in [
                    ("pageUp", true, false),
                    ("pageDown", false, false),
                    ("halfPageUp", true, true),
                    ("halfPageDown", false, true),
                ] {
                    if eq!(id, l!(name)) {
                        let blob = truth!(r!("isDetailBlobFocused", *state));
                        let mut delta =
                            r!(if blob { "detailBodyHeight" } else { "pageSize" }, *state);
                        if half {
                            delta = c!("max", one, c!("floor", c!("divide", delta, n!(2.))));
                        }
                        if negative {
                            delta = c!("negate", delta);
                        }
                        return Ok(r!(
                            if blob { "detailScroll" } else { "moveCursor" },
                            *state,
                            delta
                        ));
                    }
                }
            }
            if truth!(r!("isBackspace", *key)) {
                if truth!(r!("isSecondListFocused", *state)) {
                    return Ok(r!(
                        "updateDetailFilter",
                        *state,
                        r!(
                            "removeLast",
                            fallback!(g!(g!(*state, "detail"), "filter"), l!(""))
                        )
                    ));
                }
                return Ok(r!(
                    "updateFilter",
                    *state,
                    r!("removeLast", g!(*state, "filter"))
                ));
            }
            if !truth!(g!(*state, "multiSelect")) && truth!(r!("isSelectionSpace", *key)) {
                return Ok(r!("mark", *state, zero));
            }
            if truth!(r!("isPrintable", *key)) {
                if truth!(r!("isSecondListFocused", *state)) {
                    let prefix = c!(
                        "string",
                        fallback!(g!(g!(*state, "detail"), "filter"), l!(""))
                    );
                    return Ok(r!(
                        "updateDetailFilter",
                        *state,
                        c!("template", prefix, g!(*key, "ch"), l!(""))
                    ));
                }
                let prefix = c!("string", g!(*state, "filter"));
                return Ok(r!(
                    "updateFilter",
                    *state,
                    c!("template", prefix, g!(*key, "ch"), l!(""))
                ));
            }
            return Ok(r!("mark", *state, zero));
        }
        ("filterKey", [state, key, target, handles]) => {
            if eq!(opt!(*target, "type"), l!("builtin")) && eq!(g!(*target, "id"), l!("escape")) {
                return Ok(r!("escape", *state, *handles));
            }
            if eq!(opt!(*target, "type"), l!("builtin")) && eq!(g!(*target, "id"), l!("confirm")) {
                return Ok(result!(
                    clone!(*state,"filterFocused"=>no,"dirty"=>d!("header","footer"))
                ));
            }
            if truth!(r!("isBackspace", *key)) {
                return Ok(r!(
                    "updateFilter",
                    *state,
                    r!("removeLast", g!(*state, "filter"))
                ));
            }
            if truth!(r!("isPrintable", *key)) {
                let prefix = c!("string", g!(*state, "filter"));
                return Ok(r!(
                    "updateFilter",
                    *state,
                    c!("template", prefix, g!(*key, "ch"), l!(""))
                ));
            }
            return Ok(r!("mark", *state, zero));
        }
        ("modalKey", [state, key, target, handles]) => {
            if kind!(*state, "input") {
                if eq!(opt!(*target, "type"), l!("builtin"))
                    && (eq!(g!(*target, "id"), l!("escape")) || eq!(g!(*target, "id"), l!("quit")))
                {
                    return Ok(r!("modalDismissed", *state, null, *handles));
                }
                if eq!(opt!(*target, "type"), l!("builtin"))
                    && eq!(g!(*target, "id"), l!("confirm"))
                {
                    return Ok(r!(
                        "modalDismissed",
                        *state,
                        g!(g!(*state, "modal"), "value"),
                        *handles
                    ));
                }
                if truth!(r!("isBackspace", *key)) {
                    return Ok(r!(
                        "setModal",
                        *state,
                        clone!(g!(*state,"modal"),"value"=>r!("removeLast",g!(g!(*state,"modal"),"value")))
                    ));
                }
                if truth!(r!("isPrintable", *key)) {
                    let modal = c!("spread", g!(*state, "modal"));
                    let prefix = c!("string", g!(g!(*state, "modal"), "value"));
                    set!(
                        modal,
                        "value",
                        c!("template", prefix, g!(*key, "ch"), l!(""))
                    );
                    return Ok(r!("setModal", *state, modal));
                }
                return Ok(r!("mark", *state, zero));
            }
            if kind!(*state, "confirm") {
                if eq!(opt!(*target, "type"), l!("builtin"))
                    && (eq!(g!(*target, "id"), l!("escape")) || eq!(g!(*target, "id"), l!("quit")))
                {
                    return Ok(r!("modalDismissed", *state, no, *handles));
                }
                if eq!(opt!(*target, "type"), l!("builtin"))
                    && eq!(g!(*target, "id"), l!("confirm"))
                {
                    return Ok(r!("modalDismissed", *state, yes, *handles));
                }
                if truth!(r!("isConfirmNo", *key)) {
                    return Ok(r!("modalDismissed", *state, no, *handles));
                }
                if truth!(r!("isConfirmYes", *key)) {
                    return Ok(r!("modalDismissed", *state, yes, *handles));
                }
                return Ok(r!("mark", *state, zero));
            }
            if kind!(*state, "help") {
                if eq!(opt!(*target, "type"), l!("builtin"))
                    && (eq!(g!(*target, "id"), l!("escape")) || eq!(g!(*target, "id"), l!("help")))
                {
                    return Ok(r!("modalDismissed", *state, no, *handles));
                }
                return Ok(r!("mark", *state, zero));
            }
            if kind!(*state, "palette") {
                if eq!(opt!(*target, "type"), l!("builtin")) {
                    let id = g!(*target, "id");
                    if eq!(id, l!("escape")) {
                        return Ok(r!("modalDismissed", *state, no, *handles));
                    }
                    if eq!(id, l!("confirm")) {
                        return Ok(r!("dispatchPaletteAction", *state, *handles));
                    }
                    if eq!(id, l!("cursorUp")) {
                        return Ok(r!("movePaletteCursor", *state, minus_one));
                    }
                    if eq!(id, l!("cursorDown")) {
                        return Ok(r!("movePaletteCursor", *state, one));
                    }
                }
                return Ok(r!("paletteInput", *state, *key));
            }
            if kind!(*state, "content") && eq!(opt!(*target, "type"), l!("builtin")) {
                let id = g!(*target, "id");
                if eq!(id, l!("escape")) || eq!(id, l!("confirm")) {
                    return Ok(r!("modalDismissed", *state, no, *handles));
                }
                if eq!(id, l!("cursorDown")) || eq!(id, l!("detailScrollDown")) {
                    return Ok(r!("scrollContentModal", *state, one));
                }
                if eq!(id, l!("cursorUp")) || eq!(id, l!("detailScrollUp")) {
                    return Ok(r!("scrollContentModal", *state, minus_one));
                }
                if eq!(id, l!("pageDown")) {
                    return Ok(r!(
                        "scrollContentModal",
                        *state,
                        r!("modalBodyHeight", *state)
                    ));
                }
                if eq!(id, l!("pageUp")) {
                    return Ok(r!(
                        "scrollContentModal",
                        *state,
                        c!("negate", r!("modalBodyHeight", *state))
                    ));
                }
            }
            return Ok(r!("mark", *state, zero));
        }
        ("resize", [state, cols, rows]) => {
            let size = obj!("cols"=>r!("normalizeSize",*cols),"rows"=>r!("normalizeSize",*rows));
            let layout = c!("layoutMode", g!(size, "cols"), g!(size, "rows"));
            if eq!(g!(g!(*state, "size"), "cols"), g!(size, "cols"))
                && eq!(g!(g!(*state, "size"), "rows"), g!(size, "rows"))
                && eq!(g!(*state, "layout"), layout)
            {
                return Ok(r!("mark", *state, zero));
            }
            return Ok(result!(r!(
                "clampDetailScroll",
                clone!(*state,"size"=>size,"layout"=>layout,"dirty"=>d!("all"))
            )));
        }
        ("rowsLoaded", [state, rows]) => {
            let previous = opt!(r!("currentRow", *state), "id");
            let ids = c!("set");
            c!("walk", *rows, l!("validateRow"), ids);
            let matches = c!("filter", g!(*state, "filter"), *rows);
            let filtered = c!("map1", matches, l!("matchIndex"));
            let positions = r!("createMatchPositions", matches);
            let identity = if eq!(previous, undefined) {
                minus_one
            } else {
                c!("findIndex1", filtered, l!("identityRow"), *rows, previous)
            };
            let cursor = if p!("ge", identity, zero) {
                identity
            } else {
                clamp!(
                    g!(*state, "cursor"),
                    c!("max", zero, c!("subtract", g!(filtered, "length"), one))
                )
            };
            let selected = if truth!(g!(*state, "multiSelect")) {
                r!("pruneSelection", g!(*state, "selected"), *rows)
            } else {
                c!("set")
            };
            let detail = r!("resetDetail", *state, *rows, filtered, cursor);
            let modal = r!("modalStillValid", g!(*state, "modal"), *rows);
            if kind!(*state, "confirm") && eq!(modal, null) {
                mc!(
                    g!(*state, "modal"),
                    "resolver",
                    "state.modal.resolver is not a function",
                    no
                );
            }
            let view = clone!(*state,"rows"=>*rows,"rowsLoading"=>no,"filtered"=>filtered,"matchPositions"=>positions,"cursor"=>cursor,"selected"=>selected,"detail"=>detail,"modal"=>modal);
            let next = clone!(view,"actionState"=>r!("recompute",view),"dirty"=>d!("header","list","detail","footer","modal"));
            let effect = r!("detailEffect", next);
            return Ok(
                obj!("state"=>next,"effects"=>if eq!(effect,undefined){c!("noEffects")}else{c!("array",effect)}),
            );
        }
        ("detailLoading", [state, row_id, token]) => {
            if !eq!(g!(g!(*state, "detail"), "rowId"), *row_id)
                || !eq!(g!(g!(*state, "detail"), "token"), *token)
            {
                return Ok(r!("mark", *state, zero));
            }
            if truth!(g!(g!(*state, "detail"), "loading")) {
                return Ok(r!("mark", *state, zero));
            }
            return Ok(result!(
                clone!(*state,"detail"=>clone!(g!(*state,"detail"),"loading"=>yes),"dirty"=>d!("detail"))
            ));
        }
        ("detailLoaded", [state, row_id, token, items]) => {
            if !eq!(g!(g!(*state, "detail"), "rowId"), *row_id)
                || !eq!(g!(g!(*state, "detail"), "token"), *token)
            {
                return Ok(r!("mark", *state, zero));
            }
            let visible = r!(
                "filterDetailItems",
                *items,
                fallback!(g!(g!(*state, "detail"), "filter"), l!(""))
            );
            let detail = clone!(g!(*state,"detail"),"items"=>visible,"allItems"=>*items,"cursor"=>clamp!(g!(g!(*state,"detail"),"cursor"),c!("max",zero,c!("subtract",g!(visible,"length"),one))),"scroll"=>zero,"loading"=>no);
            return Ok(result!(
                clone!(*state,"detail"=>detail,"actionState"=>r!("recompute",clone!(*state,"detail"=>detail)),"dirty"=>d!("detail","footer"))
            ));
        }
        ("detailItemRendered", [state, row_id, token, index, content]) => {
            if !eq!(g!(g!(*state, "detail"), "rowId"), *row_id)
                || !eq!(g!(g!(*state, "detail"), "token"), *token)
                || eq!(
                    opt_at!(g!(g!(*state, "detail"), "items"), *index),
                    undefined
                )
            {
                return Ok(r!("mark", *state, zero));
            }
            let items = c!(
                "map2",
                g!(g!(*state, "detail"), "items"),
                l!("renderedItem"),
                *index,
                *content
            );
            let detail = clone!(g!(*state,"detail"),"items"=>items);
            return Ok(result!(r!(
                "clampDetailScroll",
                clone!(*state,"detail"=>detail,"dirty"=>d!("detail"))
            )));
        }
        ("detailError", [state, row_id, token, error]) => {
            if !eq!(g!(g!(*state, "detail"), "rowId"), *row_id)
                || !eq!(g!(g!(*state, "detail"), "token"), *token)
            {
                return Ok(r!("mark", *state, zero));
            }
            let item = obj!("id"=>c!("template",*row_id,l!(":error"),l!("")),"title"=>l!("Error"),"badge"=>obj!("text"=>l!("error"),"tone"=>l!("error")),"render"=>c!("errorRender",*error));
            return Ok(r!(
                "detailLoaded",
                *state,
                *row_id,
                *token,
                c!("array", item)
            ));
        }
        ("actionResolved", [state, id]) => {
            let current = m!(g!(*state, "actionState"), "get", *id);
            if eq!(current, undefined) || !eq!(g!(current, "running"), yes) {
                return Ok(r!("mark", *state, zero));
            }
            let actions = c!("mapFrom", g!(*state, "actionState"));
            m!(actions, "set", *id, clone!(current,"running"=>no));
            return Ok(result!(
                clone!(*state,"actionState"=>actions,"dirty"=>d!("footer"))
            ));
        }
        ("expireToast", [state]) => {
            if eq!(g!(*state, "toast"), null) {
                return Ok(r!("mark", *state, zero));
            }
            return Ok(result!(clone!(*state,"toast"=>null,"dirty"=>d!("footer"))));
        }
        ("suspendResumed", [state, event, handles]) => {
            let next = r!("step", *state, *event, *handles);
            return Ok(
                obj!("state"=>clone!(g!(next,"state"),"dirty"=>c!("or",g!(g!(next,"state"),"dirty"),d!("all"))),"effects"=>g!(next,"effects")),
            );
        }
        ("modalDismissed", [state, result, handles]) => {
            let modal = g!(*state, "modal");
            let closed = clone!(*state,"modal"=>null,"dirty"=>d!("all"));
            if eq!(opt!(modal, "kind"), l!("confirm")) {
                mc!(
                    modal,
                    "resolver",
                    "modal.resolver is not a function",
                    c!("same", *result, yes)
                );
            }
            if eq!(opt!(modal, "kind"), l!("input")) {
                mc!(
                    modal,
                    "resolver",
                    "modal.resolver is not a function",
                    if p!("isString", *result) {
                        *result
                    } else {
                        null
                    }
                );
            }
            if !eq!(opt!(modal, "kind"), l!("confirm"))
                || !eq!(*result, yes)
                || eq!(g!(modal, "action"), undefined)
            {
                return Ok(result!(closed));
            }
            return Ok(r!(
                "dispatchAction",
                closed,
                g!(modal, "action"),
                yes,
                *handles,
                fallback!(g!(modal, "rows"), c!("array"))
            ));
        }
        ("moveCursor", [state, delta]) => {
            if eq!(g!(*state, "focused"), l!("detail")) && truth!(r!("hasDetailCursor", *state)) {
                return Ok(r!("moveDetailCursor", *state, *delta));
            }
            if truth!(r!("isDetailBlobFocused", *state)) {
                return Ok(r!("detailScroll", *state, *delta));
            }
            return Ok(r!(
                "setCursor",
                *state,
                c!("add", g!(*state, "cursor"), *delta)
            ));
        }
        ("isDetailBlobFocused", [state]) => {
            return Ok(boolean!(
                eq!(g!(*state, "focused"), l!("detail"))
                    && !truth!(r!("hasDetailCursor", *state))
                    && p!(
                        "gt",
                        fallback!(opt!(g!(g!(*state, "detail"), "items"), "length"), zero),
                        zero
                    )
            ));
        }
        ("moveDetailCursor", [state, delta]) => {
            let max = c!(
                "max",
                zero,
                c!(
                    "subtract",
                    fallback!(opt!(g!(g!(*state, "detail"), "items"), "length"), zero),
                    one
                )
            );
            let cursor = clamp!(c!("add", g!(g!(*state, "detail"), "cursor"), *delta), max);
            if eq!(cursor, g!(g!(*state, "detail"), "cursor")) {
                return Ok(r!("mark", *state, zero));
            }
            let detail = clone!(g!(*state,"detail"),"cursor"=>cursor);
            return Ok(result!(
                clone!(*state,"detail"=>detail,"actionState"=>r!("recompute",clone!(*state,"detail"=>detail)),"dirty"=>d!("detail","footer"))
            ));
        }
        ("hasDetailCursor", [state]) => {
            let items = fallback!(g!(g!(*state, "detail"), "items"), c!("array"));
            return Ok(c!("some1", items, l!("hasTitle")));
        }
        ("setCursor", [state, cursor]) => {
            let next_cursor = clamp!(
                *cursor,
                c!(
                    "max",
                    zero,
                    c!("subtract", g!(g!(*state, "filtered"), "length"), one)
                )
            );
            if eq!(next_cursor, g!(*state, "cursor")) {
                return Ok(r!("mark", *state, zero));
            }
            let detail = r!(
                "resetDetail",
                *state,
                g!(*state, "rows"),
                g!(*state, "filtered"),
                next_cursor
            );
            let next = clone!(*state,"cursor"=>next_cursor,"detail"=>detail,"actionState"=>r!("recompute",clone!(*state,"cursor"=>next_cursor,"detail"=>detail)),"dirty"=>d!("list","detail","footer"));
            let effect = r!("detailEffect", next);
            return Ok(
                obj!("state"=>next,"effects"=>if eq!(effect,undefined){c!("noEffects")}else{c!("array",effect)}),
            );
        }
        ("updateFilter", [state, filter]) => {
            if eq!(*filter, g!(*state, "filter")) {
                return Ok(r!("mark", *state, zero));
            }
            let matches = c!("filter", *filter, g!(*state, "rows"));
            let filtered = c!("map1", matches, l!("matchIndex"));
            let positions = r!("createMatchPositions", matches);
            let cursor = clamp!(
                zero,
                c!("max", zero, c!("subtract", g!(filtered, "length"), one))
            );
            let detail = r!(
                "resetDetail",
                clone!(*state,"filter"=>*filter),
                g!(*state, "rows"),
                filtered,
                cursor
            );
            let next = clone!(*state,"filter"=>*filter,"filterFocused"=>if eq!(*filter,l!("")){no}else{g!(*state,"filterFocused")},"filtered"=>filtered,"matchPositions"=>positions,"cursor"=>cursor,"detail"=>detail,"actionState"=>r!("recompute",clone!(*state,"filter"=>*filter,"filtered"=>filtered,"matchPositions"=>positions,"cursor"=>cursor,"detail"=>detail)),"dirty"=>d!("header","list","detail","footer"));
            let effect = r!("detailEffect", next);
            return Ok(
                obj!("state"=>next,"effects"=>if eq!(effect,undefined){c!("noEffects")}else{c!("array",effect)}),
            );
        }
        ("updateDetailFilter", [state, filter]) => {
            let all = fallback!(
                g!(g!(*state, "detail"), "allItems"),
                fallback!(g!(g!(*state, "detail"), "items"), c!("array"))
            );
            let items = r!("filterDetailItems", all, *filter);
            let detail = clone!(g!(*state,"detail"),"filter"=>*filter,"items"=>items,"cursor"=>zero,"scroll"=>zero);
            return Ok(result!(
                clone!(*state,"detail"=>detail,"actionState"=>r!("recompute",clone!(*state,"detail"=>detail)),"dirty"=>d!("header","detail","footer"))
            ));
        }
        ("filterDetailItems", [items, query]) => {
            let rows = c!("map1", *items, l!("detailRow"));
            let filtered = c!("filter", *query, rows);
            return Ok(c!(
                "filter1",
                c!("map1", filtered, l!("matchedItem"), *items),
                l!("defined")
            ));
        }
        ("isSecondListFocused", [state]) => {
            return Ok(boolean!(
                eq!(g!(*state, "focused"), l!("detail"))
                    && eq!(
                        opt!(g!(g!(*state, "paneDefinitions"), "1"), "kind"),
                        l!("list")
                    )
            ));
        }
        ("focusFilter", [state]) => {
            if truth!(g!(*state, "filterFocused")) {
                return Ok(r!("mark", *state, zero));
            }
            return Ok(result!(
                clone!(*state,"filterFocused"=>yes,"dirty"=>d!("header","footer"))
            ));
        }
        ("focusNext", [state]) => {
            let focused = if eq!(g!(*state, "focused"), l!("list")) {
                l!("detail")
            } else {
                l!("list")
            };
            return Ok(result!(
                clone!(*state,"focused"=>focused,"actionState"=>r!("recompute",clone!(*state,"focused"=>focused)),"dirty"=>d!("list","detail","footer"))
            ));
        }
        ("escape", [state, handles]) => {
            if truth!(r!("isSecondListFocused", *state))
                && p!(
                    "gt",
                    g!(
                        fallback!(g!(g!(*state, "detail"), "filter"), l!("")),
                        "length"
                    ),
                    zero
                )
            {
                return Ok(r!("updateDetailFilter", *state, l!("")));
            }
            if truth!(g!(*state, "filterFocused"))
                || p!("gt", g!(g!(*state, "filter"), "length"), zero)
            {
                let cleared = r!("updateFilter", clone!(*state,"filterFocused"=>no), l!(""));
                return Ok(
                    obj!("state"=>clone!(g!(cleared,"state"),"filterFocused"=>no,"dirty"=>c!("or",c!("or",g!(g!(cleared,"state"),"dirty"),d!("header")),d!("footer"))),"effects"=>g!(cleared,"effects")),
                );
            }
            if p!("gt", g!(g!(*state, "selected"), "size"), zero) {
                return Ok(r!("clearSelection", *state));
            }
            if !eq!(g!(*state, "modal"), null) {
                return Ok(r!("modalDismissed", *state, no, *handles));
            }
            return Ok(
                obj!("state"=>r!("markDirty",*state,zero),"effects"=>c!("array",obj!("type"=>l!("exit"),"result"=>null))),
            );
        }
        ("confirmKey", [state, handles]) => {
            if kind!(*state, "confirm") {
                return Ok(r!("modalDismissed", *state, yes, *handles));
            }
            let entries = c!("spreadArray", m!(g!(*state, "actionState"), "values"));
            return Ok(if truth!(c!("some1", entries, l!("availableIdle"))) {
                r!(
                    "setModal",
                    *state,
                    obj!("kind"=>l!("palette"),"query"=>l!(""),"cursor"=>zero)
                )
            } else {
                r!("dispatchPrimary", *state, *handles)
            });
        }
        ("toggleSelect", [state]) => {
            if !truth!(g!(*state, "multiSelect")) {
                return Ok(r!("mark", *state, zero));
            }
            let item = if eq!(g!(*state, "focused"), l!("detail")) {
                opt_at!(
                    g!(g!(*state, "detail"), "items"),
                    g!(g!(*state, "detail"), "cursor")
                )
            } else {
                undefined
            };
            let row = if eq!(item, undefined) {
                r!("currentRow", *state)
            } else {
                obj!("id"=>g!(item,"id"),"title"=>fallback!(g!(item,"title"),g!(item,"id")))
            };
            if eq!(row, undefined) {
                return Ok(r!("mark", *state, zero));
            }
            let selected = c!("setFrom", g!(*state, "selected"));
            if truth!(m!(selected, "has", g!(row, "id"))) {
                m!(selected, "delete", g!(row, "id"));
            } else {
                m!(selected, "add", g!(row, "id"));
            }
            return Ok(r!("selectionChanged", *state, selected));
        }
        ("selectAll", [state]) => {
            if !truth!(g!(*state, "multiSelect")) {
                return Ok(r!("mark", *state, zero));
            }
            let selected = c!("setFrom", g!(*state, "selected"));
            c!(
                "walk",
                g!(*state, "filtered"),
                l!("selectIndex"),
                *state,
                selected
            );
            return Ok(r!("selectionChanged", *state, selected));
        }
        ("clearSelection", [state]) => {
            if eq!(g!(g!(*state, "selected"), "size"), zero) {
                return Ok(r!("mark", *state, zero));
            }
            return Ok(r!("selectionChanged", *state, c!("set")));
        }
        ("selectionChanged", [state, selected]) => {
            let normalized = if truth!(g!(*state, "multiSelect")) {
                *selected
            } else {
                c!("set")
            };
            if truth!(r!("setsEqual", g!(*state, "selected"), normalized)) {
                return Ok(r!("mark", *state, zero));
            }
            return Ok(result!(
                clone!(*state,"selected"=>normalized,"actionState"=>r!("recompute",clone!(*state,"selected"=>normalized)),"dirty"=>d!("list","footer"))
            ));
        }
        ("detailScroll", [state, delta]) => {
            let scroll = clamp!(
                c!("add", g!(g!(*state, "detail"), "scroll"), *delta),
                r!("maxDetailScroll", *state)
            );
            if eq!(scroll, g!(g!(*state, "detail"), "scroll")) {
                return Ok(r!("mark", *state, zero));
            }
            return Ok(result!(
                clone!(*state,"detail"=>clone!(g!(*state,"detail"),"scroll"=>scroll),"dirty"=>d!("detail"))
            ));
        }
        ("scrollContentModal", [state, delta]) => {
            if !kind!(*state, "content") {
                return Ok(r!("mark", *state, zero));
            }
            let scroll = clamp!(
                c!("add", g!(g!(*state, "modal"), "scroll"), *delta),
                r!("maxContentModalScroll", *state)
            );
            if eq!(scroll, g!(g!(*state, "modal"), "scroll")) {
                return Ok(r!("mark", *state, zero));
            }
            return Ok(r!(
                "setModal",
                *state,
                clone!(g!(*state,"modal"),"scroll"=>scroll)
            ));
        }
        ("maxContentModalScroll", [state]) => {
            if !kind!(*state, "content") {
                return Ok(zero);
            }
            return Ok(c!(
                "max",
                zero,
                c!(
                    "subtract",
                    g!(
                        m!(g!(g!(*state, "modal"), "content"), "split", l!("\n")),
                        "length"
                    ),
                    r!("modalBodyHeight", *state)
                )
            ));
        }
        ("modalBodyHeight", [state]) => {
            let height = r!("normalizeSize", g!(g!(*state, "size"), "rows"));
            return Ok(if p!("le", height, n!(2.)) {
                zero
            } else {
                c!("max", zero, c!("subtract", height, n!(4.)))
            });
        }
        ("clampDetailScroll", [state]) => {
            let scroll = clamp!(
                g!(g!(*state, "detail"), "scroll"),
                r!("maxDetailScroll", *state)
            );
            return Ok(if eq!(scroll, g!(g!(*state, "detail"), "scroll")) {
                *state
            } else {
                clone!(*state,"detail"=>clone!(g!(*state,"detail"),"scroll"=>scroll))
            });
        }
        ("maxDetailScroll", [state]) => {
            let items = g!(g!(*state, "detail"), "items");
            if eq!(items, null) || eq!(g!(items, "length"), zero) {
                return Ok(zero);
            }
            if eq!(g!(items, "length"), one) && eq!(opt!(g!(items, "0"), "title"), undefined) {
                let body = c!(
                    "body",
                    g!(
                        c!(
                            "layout",
                            clone!(g!(*state,"size"),"focused"=>g!(*state,"focused"))
                        ),
                        "detail"
                    )
                );
                let content = opt!(g!(items, "0"), "renderedContent");
                if p!("le", g!(body, "width"), zero)
                    || p!("le", g!(body, "height"), zero)
                    || eq!(content, undefined)
                {
                    return Ok(zero);
                }
                return Ok(c!(
                    "max",
                    zero,
                    c!(
                        "subtract",
                        g!(
                            g!(c!("prepare", content, g!(body, "width")), "lines"),
                            "length"
                        ),
                        g!(body, "height")
                    )
                ));
            }
            return Ok(c!("max", zero, c!("subtract", g!(items, "length"), one)));
        }
        ("detailBodyHeight", [state]) => {
            let body = c!(
                "body",
                g!(
                    c!(
                        "layout",
                        clone!(g!(*state,"size"),"focused"=>g!(*state,"focused"))
                    ),
                    "detail"
                )
            );
            return Ok(if p!("gt", g!(body, "width"), zero) {
                g!(body, "height")
            } else {
                zero
            });
        }
        ("extendSelection", [state, delta]) => {
            if !truth!(g!(*state, "multiSelect")) {
                return Ok(r!("moveCursor", *state, *delta));
            }
            let moved = r!("moveCursor", *state, *delta);
            let row = r!("currentRow", g!(moved, "state"));
            if eq!(row, undefined) {
                return Ok(moved);
            }
            let selected = c!("setFrom", g!(g!(moved, "state"), "selected"));
            m!(selected, "add", g!(row, "id"));
            return Ok(
                obj!("state"=>clone!(g!(moved,"state"),"selected"=>selected,"actionState"=>r!("recompute",clone!(g!(moved,"state"),"selected"=>selected)),"dirty"=>g!(g!(moved,"state"),"dirty")),"effects"=>g!(moved,"effects")),
            );
        }
        ("reorder", [state, delta]) => {
            if !eq!(g!(*state, "filter"), l!(""))
                || !eq!(g!(*state, "focused"), l!("list"))
                || !eq!(g!(*state, "modal"), null)
            {
                return Ok(r!("mark", *state, zero));
            }
            let index = c!("at", g!(*state, "filtered"), g!(*state, "cursor"));
            if eq!(index, undefined) {
                return Ok(r!("mark", *state, zero));
            }
            let target_index = c!("add", index, *delta);
            if p!("lt", target_index, zero)
                || p!("ge", target_index, g!(g!(*state, "rows"), "length"))
            {
                return Ok(r!("mark", *state, zero));
            }
            let rows = c!("spreadArray", g!(*state, "rows"));
            let current = c!("at", rows, index);
            let target = c!("at", rows, target_index);
            if eq!(current, undefined) || eq!(target, undefined) {
                return Ok(r!("mark", *state, zero));
            }
            c!("write", rows, index, target);
            c!("write", rows, target_index, current);
            let filtered = c!("map2", rows, l!("index"));
            let positions = c!("map");
            let cursor = target_index;
            let next = clone!(*state,"rows"=>rows,"filtered"=>filtered,"matchPositions"=>positions,"cursor"=>cursor,"actionState"=>r!("recompute",clone!(*state,"rows"=>rows,"filtered"=>filtered,"matchPositions"=>positions,"cursor"=>cursor)),"dirty"=>d!("list","footer"));
            return Ok(
                obj!("state"=>next,"effects"=>c!("array",obj!("type"=>l!("persistOrder"),"movedId"=>g!(current,"id"),"orderedIds"=>c!("map1",rows,l!("id"))))),
            );
        }
        ("paletteInput", [state, key]) => {
            if !kind!(*state, "palette") {
                return Ok(r!("mark", *state, zero));
            }
            if truth!(r!("isBackspace", *key)) {
                return Ok(r!(
                    "setPaletteQuery",
                    *state,
                    r!("removeLast", g!(g!(*state, "modal"), "query"))
                ));
            }
            if truth!(r!("isPrintable", *key)) {
                let prefix = c!("string", g!(g!(*state, "modal"), "query"));
                return Ok(r!(
                    "setPaletteQuery",
                    *state,
                    c!("template", prefix, g!(*key, "ch"), l!(""))
                ));
            }
            return Ok(r!("mark", *state, zero));
        }
        ("setPaletteQuery", [state, query]) => {
            if !kind!(*state, "palette") {
                return Ok(r!("mark", *state, zero));
            }
            let entries = r!(
                "paletteEntries",
                clone!(*state,"modal"=>clone!(g!(*state,"modal"),"query"=>*query))
            );
            return Ok(r!(
                "setModal",
                *state,
                clone!(g!(*state,"modal"),"query"=>*query,"cursor"=>clamp!(g!(g!(*state,"modal"),"cursor"),c!("max",zero,c!("subtract",g!(entries,"length"),one))))
            ));
        }
        ("movePaletteCursor", [state, delta]) => {
            if !kind!(*state, "palette") {
                return Ok(r!("mark", *state, zero));
            }
            let max = c!(
                "max",
                zero,
                c!("subtract", g!(r!("paletteEntries", *state), "length"), one)
            );
            let cursor = clamp!(c!("add", g!(g!(*state, "modal"), "cursor"), *delta), max);
            if eq!(cursor, g!(g!(*state, "modal"), "cursor")) {
                return Ok(r!("mark", *state, zero));
            }
            return Ok(r!(
                "setModal",
                *state,
                clone!(g!(*state,"modal"),"cursor"=>cursor)
            ));
        }
        ("dispatchPaletteAction", [state, handles]) => {
            if !kind!(*state, "palette") {
                return Ok(r!("mark", *state, zero));
            }
            let entry = c!(
                "at",
                r!("paletteEntries", *state),
                g!(g!(*state, "modal"), "cursor")
            );
            if eq!(entry, undefined) {
                return Ok(r!("mark", *state, zero));
            }
            return Ok(r!(
                "dispatchById",
                clone!(*state,"modal"=>null,"dirty"=>d!("modal","footer")),
                g!(entry, "id"),
                no,
                *handles
            ));
        }
        ("dispatchPrimary", [state, handles]) => {
            return Ok(c!(
                "primary",
                m!(g!(*state, "actionState"), "entries"),
                *state,
                *handles
            ));
        }
        ("primaryEntry", [id, entry, state, handles]) => {
            if eq!(opt!(g!(*entry, "action"), "primary"), yes)
                && eq!(g!(*entry, "available"), yes)
                && !eq!(g!(*entry, "running"), yes)
            {
                return Ok(r!("dispatchById", *state, *id, no, *handles));
            }
        }
        ("dispatchById", [state, id, confirmed, handles]) => {
            let entry = m!(g!(*state, "actionState"), "get", *id);
            if !eq!(opt!(entry, "available"), yes)
                || eq!(g!(entry, "running"), yes)
                || eq!(g!(entry, "action"), undefined)
            {
                return Ok(r!("mark", *state, zero));
            }
            return Ok(r!(
                "dispatchAction",
                *state,
                g!(entry, "action"),
                *confirmed,
                *handles,
                undefined
            ));
        }
        ("dispatchAction", [state, action, confirmed, handles, modal_rows]) => {
            let rows = fallback!(*modal_rows, r!("selectedRows", *state));
            if eq!(g!(rows, "length"), zero) {
                return Ok(r!("mark", *state, zero));
            }
            if eq!(g!(*action, "destructive"), yes) && !truth!(*confirmed) {
                let label = if p!("callable", g!(*action, "label")) {
                    mc!(*action, "label", "action.label is not a function")
                } else {
                    g!(*action, "label")
                };
                let next = c!("spread", *state);
                let modal = obj!("kind"=>l!("confirm"),"title"=>if truth!(g!(*action,"destructive")){l!("Confirm destructive action")}else{l!("Confirm action")});
                let prefix = c!("template", label, l!(" "), l!(""));
                let subject = if eq!(g!(rows, "length"), one) {
                    g!(g!(rows, "0"), "title")
                } else {
                    c!("template", g!(rows, "length"), l!(" items"), l!(""))
                };
                set!(modal, "message", c!("template", prefix, subject, l!("?")));
                set!(modal, "confirmLabel", label);
                set!(modal, "cancelLabel", l!("Cancel"));
                set!(
                    modal,
                    "destructive",
                    c!("same", g!(*action, "destructive"), yes)
                );
                set!(modal, "action", *action);
                set!(modal, "rows", rows);
                set!(modal, "resolver", c!("noop"));
                set!(next, "modal", modal);
                set!(next, "dirty", d!("modal", "footer"));
                return Ok(result!(next));
            }
            let actions = c!("mapFrom", g!(*state, "actionState"));
            let current = m!(actions, "get", g!(*action, "id"));
            if !eq!(current, undefined) {
                m!(
                    actions,
                    "set",
                    g!(*action, "id"),
                    clone!(current,"running"=>yes)
                );
            }
            let next = clone!(*state,"actionState"=>actions,"dirty"=>c!("or",g!(*state,"dirty"),d!("footer")));
            return Ok(
                obj!("state"=>next,"effects"=>c!("array",c!("effect",next,*action,current,*handles,rows))),
            );
        }
        ("dispatchContext", [state, action, current, handles, rows]) => {
            return Ok(c!(
                "context",
                *state,
                *action,
                fallback!(
                    opt!(*current, "source"),
                    r!("actionSource", *state, *action)
                ),
                *handles,
                *rows
            ));
        }
        ("resumeEvent", [action]) => {
            return Ok(obj!("type"=>l!("actionResolved"),"actionId"=>g!(*action,"id")));
        }
        ("recompute", [view]) => {
            let next = c!("map");
            c!(
                "walkEntries",
                m!(g!(*view, "actionState"), "entries"),
                l!("recomputeEntry"),
                *view,
                next
            );
            return Ok(next);
        }
        ("recomputeEntry", [id, entry, view, next]) => {
            let action = g!(*entry, "action");
            if eq!(action, undefined) {
                m!(*next, "set", *id, *entry);
                return Ok(undefined);
            }
            let ctx = c!(
                "context",
                *view,
                action,
                fallback!(g!(*entry, "source"), r!("actionSource", *view, action)),
                c!("defaults")
            );
            let row = r!("currentRow", *view);
            let visible = if eq!(g!(action, "visible"), undefined) {
                yes
            } else if !eq!(row, undefined) {
                mc!(action, "visible", "action.visible is not a function", row)
            } else {
                no
            };
            let available = if truth!(visible) {
                if eq!(g!(action, "predicate"), undefined) {
                    g!(*entry, "available")
                } else {
                    mc!(
                        action,
                        "predicate",
                        "action.predicate is not a function",
                        ctx
                    )
                }
            } else {
                visible
            };
            let label = if p!("callable", g!(action, "label")) {
                mc!(action, "label", "action.label is not a function")
            } else {
                g!(action, "label")
            };
            m!(
                *next,
                "set",
                *id,
                clone!(*entry,"available"=>available,"label"=>label)
            );
        }
        ("resetDetail", [state, rows, filtered, cursor]) => {
            let row = c!(
                "at",
                *rows,
                fallback!(c!("at", *filtered, *cursor), minus_one)
            );
            if eq!(row, undefined) {
                return Ok(
                    obj!("rowId"=>null,"items"=>null,"cursor"=>zero,"scroll"=>zero,"token"=>c!("add",g!(g!(*state,"detail"),"token"),one),"loading"=>no),
                );
            }
            return Ok(
                obj!("rowId"=>g!(row,"id"),"items"=>g!(g!(*state,"detail"),"items"),"cursor"=>zero,"scroll"=>zero,"token"=>c!("add",g!(g!(*state,"detail"),"token"),one),"loading"=>no),
            );
        }
        ("detailEffect", [state]) => {
            if eq!(g!(g!(*state, "detail"), "rowId"), null) {
                return Ok(undefined);
            }
            return Ok(
                obj!("type"=>l!("renderDetail"),"rowId"=>g!(g!(*state,"detail"),"rowId"),"token"=>g!(g!(*state,"detail"),"token")),
            );
        }
        ("currentRow", [state]) => {
            return Ok(c!(
                "at",
                g!(*state, "rows"),
                fallback!(
                    c!("at", g!(*state, "filtered"), g!(*state, "cursor")),
                    minus_one
                )
            ));
        }
        ("actionSource", [state, action]) => {
            return Ok(fallback!(
                opt!(
                    m!(g!(*state, "actionState"), "get", g!(*action, "id")),
                    "source"
                ),
                l!("row")
            ));
        }
        ("selectedRows", [state]) => {
            if !truth!(g!(*state, "multiSelect")) || eq!(g!(g!(*state, "selected"), "size"), zero) {
                let row = r!("currentRow", *state);
                return Ok(if eq!(row, undefined) {
                    c!("array")
                } else {
                    c!("array", row)
                });
            }
            return Ok(c!("filter1", g!(*state, "rows"), l!("selectedRow"), *state));
        }
        ("paletteEntries", [state]) => {
            let query = if kind!(*state, "palette") {
                m!(g!(g!(*state, "modal"), "query"), "toLocaleLowerCase")
            } else {
                l!("")
            };
            let entries = c!("array");
            c!(
                "walkEntries",
                m!(g!(*state, "actionState"), "entries"),
                l!("paletteEntry"),
                query,
                entries
            );
            return Ok(entries);
        }
        ("paletteEntry", [id, entry, query, entries]) => {
            if !eq!(g!(*entry, "available"), yes)
                || eq!(g!(*entry, "running"), yes)
                || eq!(g!(*entry, "action"), undefined)
            {
                return Ok(undefined);
            }
            if !eq!(*query, l!(""))
                && !truth!(m!(
                    m!(g!(*entry, "label"), "toLocaleLowerCase"),
                    "includes",
                    *query
                ))
            {
                return Ok(undefined);
            }
            m!(
                *entries,
                "push",
                obj!("id"=>*id,"label"=>g!(*entry,"label"))
            );
        }
        ("setModal", [state, modal]) => {
            return Ok(result!(
                clone!(*state,"modal"=>*modal,"dirty"=>d!("modal","footer"))
            ));
        }
        ("mark", [state, dirty]) => return Ok(result!(r!("markDirty", *state, *dirty))),
        ("markDirty", [state, dirty]) => {
            return Ok(if eq!(g!(*state, "dirty"), *dirty) {
                *state
            } else {
                clone!(*state,"dirty"=>*dirty)
            });
        }
        ("pageSize", [state]) => {
            return Ok(c!(
                "max",
                one,
                c!(
                    "floor",
                    c!("divide", g!(g!(*state, "size"), "rows"), n!(2.))
                )
            ));
        }
        ("pruneSelection", [selected, rows]) => {
            let ids = c!("setFrom", c!("map1", *rows, l!("id")));
            return Ok(c!(
                "setFrom",
                c!("filter1", c!("spreadArray", *selected), l!("setHas"), ids)
            ));
        }
        ("modalStillValid", [modal, rows]) => {
            if !eq!(opt!(*modal, "kind"), l!("confirm")) {
                return Ok(*modal);
            }
            if eq!(g!(*modal, "rows"), undefined) {
                return Ok(*modal);
            }
            let ids = c!("setFrom", c!("map1", *rows, l!("id")));
            return Ok(
                if truth!(c!("every1", g!(*modal, "rows"), l!("rowInSet"), ids)) {
                    *modal
                } else {
                    null
                },
            );
        }
        ("normalizeSize", [value]) => {
            return Ok(if p!("finite", *value) {
                c!("max", zero, c!("floor", *value))
            } else {
                zero
            });
        }
        ("createMatchPositions", [matches]) => {
            return Ok(c!("mapFrom", c!("map1", *matches, l!("matchPair"))));
        }
        ("setsEqual", [left, right]) => {
            if !eq!(g!(*left, "size"), g!(*right, "size")) {
                return Ok(no);
            }
            return Ok(c!("allValues", *left, l!("setHas"), *right));
        }
        ("isPrintable", [key]) => {
            return Ok(boolean!(
                !eq!(g!(*key, "ch"), undefined)
                    && !truth!(g!(*key, "ctrl"))
                    && !truth!(g!(*key, "meta"))
            ));
        }
        ("isBackspace", [key]) => {
            return Ok(boolean!(
                eq!(g!(*key, "name"), l!("backspace")) || eq!(g!(*key, "name"), l!("delete"))
            ));
        }
        ("isSelectionSpace", [key]) => {
            return Ok(boolean!(
                eq!(g!(*key, "name"), l!("space")) || eq!(g!(*key, "ch"), l!(" "))
            ));
        }
        ("isConfirmYes", [key]) => {
            return Ok(boolean!(
                eq!(g!(*key, "ch"), l!("y")) || eq!(g!(*key, "ch"), l!("Y"))
            ));
        }
        ("isConfirmNo", [key]) => {
            return Ok(boolean!(
                eq!(g!(*key, "ch"), l!("n")) || eq!(g!(*key, "ch"), l!("N"))
            ));
        }
        ("removeLast", [text]) => {
            return Ok(m!(
                m!(c!("graphemes", *text), "slice", zero, minus_one),
                "join",
                l!("")
            ));
        }
        ("validateRow", [row, ids]) => {
            if truth!(m!(*ids, "has", g!(*row, "id"))) {
                c!(
                    "error",
                    c!(
                        "template",
                        l!("Duplicate explorer row id: "),
                        g!(*row, "id"),
                        l!("")
                    )
                );
            }
            m!(*ids, "add", g!(*row, "id"));
        }
        ("matchIndex", [value]) => return host.get(*value, "index"),
        ("matchPair", [value]) => {
            return Ok(c!("array", g!(*value, "index"), g!(*value, "positions")));
        }
        ("identityRow", [index, rows, previous]) => {
            return Ok(c!("same", opt!(c!("at", *rows, *index), "id"), *previous));
        }
        ("renderedItem", [item, index, target, content]) => {
            return Ok(if eq!(*index, *target) {
                clone!(*item,"renderedContent"=>*content)
            } else {
                *item
            });
        }
        ("hasTitle", [item]) => return Ok(boolean!(!eq!(g!(*item, "title"), undefined))),
        ("detailRow", [item]) => {
            return Ok(
                obj!("id"=>g!(*item,"id"),"title"=>fallback!(g!(*item,"title"),g!(*item,"id")),"subtitle"=>g!(*item,"subtitle")),
            );
        }
        ("matchedItem", [matched, items]) => return Ok(c!("at", *items, g!(*matched, "index"))),
        ("defined", [item]) => return Ok(boolean!(!eq!(*item, undefined))),
        ("availableIdle", [entry]) => {
            let available = g!(*entry, "available");
            return Ok(if truth!(available) {
                boolean!(!eq!(g!(*entry, "running"), yes))
            } else {
                available
            });
        }
        ("selectIndex", [index, state, selected]) => {
            let row = c!("at", g!(*state, "rows"), *index);
            if !eq!(row, undefined) {
                m!(*selected, "add", g!(row, "id"));
            }
        }
        ("index", [_, index]) => return Ok(*index),
        ("id", [row]) => return host.get(*row, "id"),
        ("selectedRow", [row, state]) => {
            return Ok(m!(g!(*state, "selected"), "has", g!(*row, "id")));
        }
        ("setHas", [id, set]) => return Ok(m!(*set, "has", *id)),
        ("rowInSet", [row, set]) => return Ok(m!(*set, "has", g!(*row, "id"))),
        _ => return host.call("invalidOperation", vec![]),
    }
    Ok(undefined)
}
