//! Dashboard lifecycle, scheduling, input and render policy. Host values preserve
//! live JavaScript objects; streams, timers and promise continuations stay in Node.
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
    let state = c!("state");
    let undefined = c!("undefined");
    macro_rules! s {
        ($key:expr) => {
            g!(state, $key)
        };
    }
    macro_rules! put {
        ($key:expr,$value:expr) => {
            set!(state, $key, $value)
        };
    }
    macro_rules! call { ($name:expr $(,$arg:expr)*) => {{let args=vec![$($arg),*];run(host,$name,&args)?}}; }
    macro_rules! store {
        () => {{
            if p!("same", s!("store"), undefined) {
                put!("store", c!("store"));
            }
            s!("store")
        }};
    }
    macro_rules! render {
        () => {
            call!("render")
        };
    }
    macro_rules! schedule {
        () => {
            if p!("nullish", s!("renderTimer")) {
                put!("renderTimer", c!("renderTimer"));
            }
        };
    }
    macro_rules! monitor { ($method:expr $(,$arg:expr)*) => {method!(s!("performanceMonitor"),$method $(,$arg)*)}; }
    macro_rules! draft_error {
        ($draft:expr) => {{
            let draft = $draft;
            method!(
                s!("fallbackLogger"),
                "error",
                c!(
                    "draftError",
                    g!(draft, "kind"),
                    c!("plainTerminalText", g!(draft, "error"))
                )
            );
        }};
    }
    let opts = s!("opts");
    match operation {
        "isPlan" => return Ok(c!("same", g!(args[0], "kind"), l!("plan"))),
        "submitFinally" => {
            put!("submitting", c!("false"));
            render!();
        }
        "create" => {
            put!("stdin", fallback!(g!(opts, "stdin"), c!("stdin")));
            put!("stdout", fallback!(g!(opts, "stdout"), c!("stdout")));
            put!("resolveCommand", c!("keymap", g!(opts, "keymap")));
            put!("footerHints", fallback!(g!(opts, "hints"), c!("hints")));
            put!("title", fallback!(g!(opts, "title"), l!("Output")));
            put!("statsTitle", fallback!(g!(opts, "statsTitle"), l!("Stats")));
            put!(
                "rightPaneWidth",
                fallback!(g!(opts, "rightPaneWidth"), n!(25.))
            );
            let conversation = p!("same", g!(opts, "appearance"), l!("conversation"))
                || !p!("same", g!(opts, "onSubmit"), undefined);
            put!(
                "conversation",
                c!(if conversation { "true" } else { "false" })
            );
            put!("commandHandlers", c!("set"));
            put!("fallbackLogger", c!("logger", s!("stdout")));
            put!("previousBuffer", c!("buffer", n!(0.), n!(0.)));
            put!("started", c!("false"));
            put!("destroyed", c!("false"));
            put!("performanceMonitor", c!("monitor"));
            put!("showPerformance", c!("false"));
            put!("scrollOffset", n!(0.));
            put!("outputViewportHeight", n!(0.));
            put!(
                "composer",
                if p!("truthy", g!(opts, "onSubmit")) {
                    c!("composer", l!("message"))
                } else {
                    undefined
                }
            );
            put!("otherDraft", c!("composer", l!("plan")));
            put!("submitting", c!("false"));
            put!("showQueue", c!("false"));
            put!("workOffset", n!(0.));
            put!("showDetails", c!("false"));
        }
        "append" => {
            if !p!("truthy", s!("destroyed")) {
                if p!("same", c!("format"), l!("terminal")) {
                    method!(store!(), "appendOutput", args[0]);
                } else {
                    call!("fallback", args[0]);
                }
            }
        }
        "update" => {
            if !p!("truthy", s!("destroyed")) && p!("same", c!("format"), l!("terminal")) {
                method!(store!(), "updateStats", args[0]);
            }
        }
        "fallback" => {
            let item = args[0];
            let method = if p!("same", g!(item, "kind"), l!("success")) {
                "success"
            } else if p!("same", g!(item, "kind"), l!("error")) {
                "error"
            } else if p!("same", g!(item, "kind"), l!("tool")) {
                "message"
            } else {
                "info"
            };
            method!(s!("fallbackLogger"), method, g!(item, "text"));
        }
        "start" => {
            if p!("truthy", s!("destroyed"))
                || p!("truthy", s!("started"))
                || !p!("same", c!("format"), l!("terminal"))
            {
                return Ok(undefined);
            }
            put!(
                "driver",
                c!("driver", obj!("stdin"=>s!("stdin"),"stdout"=>s!("stdout")))
            );
            put!("started", c!("true"));
            put!("previousBuffer", c!("buffer", n!(0.), n!(0.)));
            for method in [
                "enterRawMode",
                "enterAltScreen",
                "disableLineWrap",
                "hideCursor",
            ] {
                method!(s!("driver"), method);
            }
            if p!("truthy", g!(opts, "onSubmit")) {
                method!(s!("driver"), "write", l!("\u{1b}[?2004h"));
            }
            render!();
            let active_store = store!();
            let subscription = obj!("previousStats"=>g!(method!(active_store,"getState"),"stats"),"lastStatsPaint"=>c!("negativeInfinity"));
            set!(subscription, "store", active_store);
            put!(
                "unsubscribeStore",
                c!("subscribeStore", active_store, subscription)
            );
            put!("unsubscribeKeypress", c!("subscribeKeypress", s!("driver")));
            put!("unsubscribeResize", c!("subscribeResize", s!("driver")));
        }
        "storeChange" => {
            let subscription = args[0];
            monitor!("request", l!("update"));
            let stats = g!(method!(g!(subscription, "store"), "getState"), "stats");
            if !p!("same", stats, g!(subscription, "previousStats")) {
                let status_changed = !p!(
                    "same",
                    g!(stats, "status"),
                    g!(g!(subscription, "previousStats"), "status")
                );
                set!(subscription, "previousStats", stats);
                if status_changed
                    || p!(
                        "ge",
                        c!("sub", c!("now"), g!(subscription, "lastStatsPaint")),
                        n!(16.)
                    )
                {
                    set!(subscription, "lastStatsPaint", c!("now"));
                    render!();
                } else {
                    schedule!();
                }
            } else if p!("same", s!("heldOutput"), undefined)
                && p!("same", s!("renderTimer"), undefined)
            {
                put!("renderTimer", c!("renderTimer"));
            }
        }
        "resize" => {
            monitor!("request", l!("resize"));
            put!("previousBuffer", c!("buffer", n!(0.), n!(0.)));
            if !p!("nullish", s!("driver")) {
                method!(s!("driver"), "write", l!("\u{1b}[2J"));
            }
            render!();
        }
        "stop" => {
            c!("clearTimeout", s!("renderTimer"));
            put!("renderTimer", undefined);
            for key in [
                "unsubscribeStore",
                "unsubscribeKeypress",
                "unsubscribeResize",
            ] {
                let callback = s!(key);
                if !p!("nullish", callback) {
                    c!("invoke", callback, undefined);
                }
            }
            for key in [
                "unsubscribeStore",
                "unsubscribeKeypress",
                "unsubscribeResize",
            ] {
                put!(key, undefined);
            }
            if !p!("same", s!("driver"), undefined) {
                if p!("truthy", g!(opts, "onSubmit")) {
                    method!(s!("driver"), "write", l!("\u{1b}[?2004l"));
                }
                method!(s!("driver"), "destroy");
                put!("driver", undefined);
                put!("previousBuffer", c!("buffer", n!(0.), n!(0.)));
            }
            put!("started", c!("false"));
        }
        "onCommand" => {
            if !p!("truthy", s!("destroyed")) {
                method!(s!("commandHandlers"), "add", args[0]);
            }
        }
        "destroy" => {
            if p!("truthy", s!("destroyed")) {
                return Ok(undefined);
            }
            call!("stop");
            let drafts = [s!("composer"), s!("otherDraft")];
            for draft in drafts {
                if p!("truthy", opt!(draft, "error")) {
                    draft_error!(draft);
                }
            }
            method!(s!("commandHandlers"), "clear");
            put!("store", undefined);
            put!("destroyed", c!("true"));
        }
        "submitSuccess" => {
            let submission = args[0];
            let run = if p!("nullish", s!("store")) {
                undefined
            } else {
                g!(g!(method!(s!("store"), "getState"), "stats"), "run")
            };
            let active_index = fallback!(
                c!("index", opt!(run, "queue"), c!("activeId", run)),
                n!(-1.)
            );
            let target_index = fallback!(
                c!("index", opt!(run, "queue"), c!("submissionId", submission)),
                n!(-1.)
            );
            let target = if p!("lt", target_index, active_index) {
                opt!(run, "activePlanId")
            } else {
                g!(submission, "afterPlanId")
            };
            put!("composer", c!("composer", g!(submission, "kind"), target));
            let plans = c!("plans", opt!(run, "queue"));
            let number = c!(
                "add",
                fallback!(c!("index", plans, c!("submissionId", submission)), n!(-1.)),
                n!(1.)
            );
            put!(
                "feedback",
                if p!("same", g!(submission, "kind"), l!("plan")) {
                    l!("Plan queued")
                } else {
                    c!("queued", number)
                }
            );
        }
        "submitError" => {
            let message = c!("errorMessage", args[1]);
            let composer = c!("spread", s!("composer"));
            set!(composer, "error", message);
            put!("composer", composer);
            if p!("truthy", s!("destroyed")) {
                method!(
                    s!("fallbackLogger"),
                    "error",
                    c!(
                        "draftError",
                        g!(args[0], "kind"),
                        c!("plainTerminalText", message)
                    )
                );
            }
        }
        "keypress" => {
            let event = args[0];
            monitor!("request", l!("input"));
            if p!("truthy", s!("composer"))
                && !(p!("truthy", g!(event, "ctrl")) && p!("same", g!(event, "name"), l!("c")))
            {
                if p!("truthy", s!("submitting")) {
                    return Ok(undefined);
                }
                if p!("truthy", g!(event, "ctrl")) && p!("same", g!(event, "name"), l!("p")) {
                    put!("feedback", undefined);
                    let composer = s!("composer");
                    put!("composer", s!("otherDraft"));
                    put!("otherDraft", composer);
                    set!(s!("composer"), "focused", c!("true"));
                    render!();
                    return Ok(undefined);
                }
                if p!("truthy", g!(s!("composer"), "focused"))
                    && p!("truthy", g!(event, "meta"))
                    && (p!("same", g!(event, "name"), l!("up"))
                        || p!("same", g!(event, "name"), l!("down")))
                {
                    put!("feedback", undefined);
                    let run = g!(g!(method!(store!(), "getState"), "stats"), "run");
                    let plans = fallback!(c!("plans", opt!(run, "queue")), c!("array"));
                    let active_index = c!("max", n!(0.), c!("index", plans, c!("activeId", run)));
                    let available = method!(plans, "slice", active_index);
                    if p!("gt", g!(available, "length"), n!(0.)) {
                        let index = c!("index", available, c!("composerId"));
                        let next = if p!("lt", index, n!(0.)) {
                            n!(0.)
                        } else {
                            let direction = if p!("same", g!(event, "name"), l!("up")) {
                                n!(-1.)
                            } else {
                                n!(1.)
                            };
                            c!(
                                "mod",
                                c!("add", c!("add", index, direction), g!(available, "length")),
                                g!(available, "length")
                            )
                        };
                        let composer = c!("spread", s!("composer"));
                        set!(composer, "afterPlanId", g!(c!("at", available, next), "id"));
                        put!("composer", composer);
                        render!();
                    }
                    return Ok(undefined);
                }
                if !p!("truthy", g!(s!("composer"), "focused"))
                    && (p!("same", g!(event, "ch"), l!("i"))
                        || p!("same", g!(event, "ch"), l!("p"))
                        || p!("same", g!(event, "name"), l!("return")))
                {
                    put!("feedback", undefined);
                    let kind = if p!("same", g!(event, "ch"), l!("p")) {
                        l!("plan")
                    } else {
                        l!("message")
                    };
                    if !p!("same", g!(s!("composer"), "kind"), kind) {
                        let composer = s!("composer");
                        put!("composer", s!("otherDraft"));
                        put!("otherDraft", composer);
                    }
                    set!(s!("composer"), "focused", c!("true"));
                    render!();
                    return Ok(undefined);
                }
                let edit = c!(
                    "editComposer",
                    s!("composer"),
                    event,
                    c!(
                        "max",
                        n!(1.),
                        c!(
                            "sub",
                            fallback!(opt!(s!("outputRect"), "width"), n!(80.)),
                            n!(3.)
                        )
                    )
                );
                if p!("truthy", g!(edit, "handled")) {
                    put!("feedback", undefined);
                    put!("composer", g!(edit, "state"));
                    if p!("truthy", g!(edit, "submit")) {
                        let submission = g!(edit, "submit");
                        put!("submitting", c!("true"));
                        render!();
                        c!("submit", submission);
                    } else {
                        schedule!();
                    }
                    return Ok(undefined);
                }
            }
            if p!("truthy", s!("conversation"))
                && !p!("truthy", opt!(s!("composer"), "focused"))
                && (p!("same", g!(event, "ch"), l!("v")) || p!("same", g!(event, "ch"), l!("d")))
            {
                if p!("same", g!(event, "ch"), l!("v")) {
                    put!(
                        "showQueue",
                        c!(if p!("truthy", s!("showQueue")) {
                            "false"
                        } else {
                            "true"
                        })
                    );
                    if p!("truthy", s!("showQueue")) {
                        put!("workOffset", undefined);
                    }
                } else {
                    put!(
                        "showDetails",
                        c!(if p!("truthy", s!("showDetails")) {
                            "false"
                        } else {
                            "true"
                        })
                    );
                }
                render!();
                return Ok(undefined);
            }
            if p!("truthy", s!("showQueue"))
                && !p!("truthy", opt!(s!("composer"), "focused"))
                && p!("same", g!(event, "name"), l!("home"))
            {
                put!("workOffset", n!(0.));
                render!();
                return Ok(undefined);
            }
            let command = c!("invoke", s!("resolveCommand"), undefined, event);
            if p!("same", command, undefined) {
                return Ok(undefined);
            }
            if p!("same", command, l!("render-stats")) {
                put!(
                    "showPerformance",
                    c!(if p!("truthy", s!("showPerformance")) {
                        "false"
                    } else {
                        "true"
                    })
                );
                render!();
                return Ok(undefined);
            }
            if p!("same", command, l!("follow")) {
                if p!("truthy", s!("showQueue")) {
                    put!(
                        "workOffset",
                        if p!("same", g!(event, "name"), l!("end")) {
                            n!(9007199254740991.)
                        } else {
                            undefined
                        }
                    );
                    render!();
                    return Ok(undefined);
                }
                put!("heldOutput", undefined);
                put!("heldAt", undefined);
                put!("scrollOffset", n!(0.));
                render!();
                return Ok(undefined);
            }
            if p!("same", command, l!("scroll-up"))
                || p!("same", command, l!("scroll-down"))
                || p!("same", command, l!("page-up"))
                || p!("same", command, l!("page-down"))
            {
                let page = c!(
                    "max",
                    n!(1.),
                    fallback!(opt!(s!("outputRect"), "height"), s!("outputViewportHeight"))
                );
                let amount =
                    if p!("same", command, l!("page-up")) || p!("same", command, l!("page-down")) {
                        page
                    } else {
                        n!(1.)
                    };
                let direction =
                    if p!("same", command, l!("scroll-up")) || p!("same", command, l!("page-up")) {
                        n!(1.)
                    } else {
                        n!(-1.)
                    };
                if p!("truthy", s!("showQueue")) {
                    put!(
                        "workOffset",
                        c!(
                            "max",
                            n!(0.),
                            c!(
                                "sub",
                                fallback!(s!("workOffset"), n!(0.)),
                                c!("mul", amount, direction)
                            )
                        )
                    );
                    schedule!();
                    return Ok(undefined);
                }
                if p!("gt", direction, n!(0.)) && p!("same", s!("heldOutput"), undefined) {
                    put!("heldOutput", g!(method!(store!(), "getState"), "output"));
                    put!("heldAt", c!("now"));
                }
                put!(
                    "scrollOffset",
                    c!(
                        "max",
                        n!(0.),
                        c!("add", s!("scrollOffset"), c!("mul", amount, direction))
                    )
                );
                if p!("same", s!("scrollOffset"), n!(0.)) {
                    put!("heldOutput", undefined);
                    put!("heldAt", undefined);
                }
                schedule!();
                return Ok(undefined);
            }
            c!("emit", s!("commandHandlers"), command);
        }
        "render" => {
            c!("clearTimeout", s!("renderTimer"));
            put!("renderTimer", undefined);
            if p!("same", s!("driver"), undefined) {
                return Ok(undefined);
            }
            let started_at = monitor!("begin");
            let size = method!(s!("driver"), "getSize");
            let cols = g!(size, "cols");
            let rows = g!(size, "rows");
            let view_state = method!(store!(), "getState");
            let layout = c!(
                "layout",
                obj!("totalWidth"=>cols,"totalHeight"=>rows,"rightPaneWidth"=>s!("rightPaneWidth"),"footerHeight"=>if p!("truthy",g!(g!(view_state,"stats"),"session")){n!(2.)}else{n!(1.)})
            );
            let buffer = c!("buffer", cols, rows);
            let mut cursor = undefined;
            if p!("truthy", s!("conversation")) {
                let active_id = opt!(g!(g!(view_state, "stats"), "run"), "activePlanId");
                if !p!("same", active_id, s!("lastActivePlanId")) {
                    put!("feedback", undefined);
                }
                for key in ["composer", "otherDraft"] {
                    let draft = s!(key);
                    if (key == "otherDraft" || p!("truthy", draft))
                        && (p!("same", g!(draft, "afterPlanId"), undefined)
                            || (p!("same", g!(g!(draft, "text"), "length"), n!(0.))
                                && p!("same", g!(draft, "afterPlanId"), s!("lastActivePlanId"))))
                    {
                        let draft = c!("spread", draft);
                        set!(draft, "afterPlanId", active_id);
                        put!(key, draft);
                    }
                }
                put!("lastActivePlanId", active_id);
                let options = obj!("title"=>s!("title"),"stats"=>g!(view_state,"stats"),"output"=>fallback!(s!("heldOutput"),g!(view_state,"output")),"scrollOffset"=>s!("scrollOffset"),"composer"=>s!("composer"),"submitting"=>s!("submitting"),"showQueue"=>s!("showQueue"),"showDetails"=>s!("showDetails"),"workOffset"=>s!("workOffset"),"feedback"=>s!("feedback"),"hints"=>g!(opts,"hints"),"now"=>if p!("same",s!("heldOutput"),undefined){c!("now")}else{s!("heldAt")});
                let view = c!("runView", buffer, options);
                for key in ["scrollOffset", "workOffset", "outputRect"] {
                    put!(key, g!(view, key));
                }
                cursor = g!(view, "cursor");
            } else {
                c!(
                    "border",
                    buffer,
                    layout,
                    obj!("leftTitle"=>s!("title"),"rightTitle"=>s!("statsTitle"),"style"=>obj!("dim"=>c!("true")))
                );
                if p!(
                    "truthy",
                    opt!(g!(g!(view_state, "stats"), "context"), "length")
                ) {
                    let rect = fallback!(g!(layout, "summary"), g!(layout, "leftPane"));
                    let remaining = c!(
                        "context",
                        buffer,
                        obj!("x"=>g!(rect,"x"),"y"=>g!(rect,"y"),"width"=>c!("max",n!(0.),c!("sub",cols,n!(2.))),"height"=>if p!("truthy",g!(layout,"summary")){c!("add",g!(g!(layout,"summary"),"height"),g!(g!(layout,"leftPane"),"height"))}else{g!(g!(layout,"leftPane"),"height")}),
                        g!(g!(view_state, "stats"), "context")
                    );
                    let height = c!("sub", g!(remaining, "y"), g!(rect, "y"));
                    if p!("truthy", g!(layout, "summary")) {
                        let summary = g!(layout, "summary");
                        let left = g!(layout, "leftPane");
                        set!(summary, "y", g!(remaining, "y"));
                        set!(
                            summary,
                            "height",
                            c!("min", g!(summary, "height"), g!(remaining, "height"))
                        );
                        set!(
                            left,
                            "y",
                            c!("add", g!(summary, "y"), g!(summary, "height"))
                        );
                        set!(
                            left,
                            "height",
                            c!(
                                "max",
                                n!(0.),
                                c!("sub", g!(remaining, "height"), g!(summary, "height"))
                            )
                        );
                    } else {
                        for key in ["leftPane", "rightPane"] {
                            let pane = g!(layout, key);
                            set!(pane, "y", c!("add", g!(pane, "y"), height));
                            set!(pane, "height", c!("sub", g!(pane, "height"), height));
                        }
                    }
                }
                put!(
                    "outputViewportHeight",
                    c!(
                        "max",
                        n!(0.),
                        c!(
                            "sub",
                            g!(g!(layout, "leftPane"), "height"),
                            if p!("truthy", s!("showPerformance")) {
                                n!(1.)
                            } else {
                                n!(0.)
                            }
                        )
                    )
                );
                let rect = c!("spread", g!(layout, "leftPane"));
                set!(rect, "height", s!("outputViewportHeight"));
                put!(
                    "scrollOffset",
                    c!(
                        "output",
                        buffer,
                        rect,
                        fallback!(s!("heldOutput"), g!(view_state, "output")),
                        s!("scrollOffset")
                    )
                );
                if p!("same", s!("scrollOffset"), n!(0.)) {
                    put!("heldOutput", undefined);
                }
                c!(
                    "stats",
                    buffer,
                    g!(layout, "rightPane"),
                    g!(view_state, "stats")
                );
                if p!("truthy", g!(layout, "summary")) {
                    c!(
                        "compactStats",
                        buffer,
                        g!(layout, "summary"),
                        g!(view_state, "stats")
                    );
                }
                c!(
                    "footer",
                    buffer,
                    g!(layout, "footer"),
                    s!("footerHints"),
                    g!(g!(view_state, "stats"), "session")
                );
            }
            if p!("same", s!("scrollOffset"), n!(0.)) {
                put!("heldOutput", undefined);
                put!("heldAt", undefined);
            }
            let rect = fallback!(s!("outputRect"), g!(layout, "leftPane"));
            if p!("truthy", s!("showPerformance")) && p!("gt", g!(rect, "height"), n!(0.)) {
                method!(
                    buffer,
                    "putInRect",
                    rect,
                    c!("sub", g!(rect, "height"), n!(1.)),
                    c!("formatPerformance", monitor!("snapshot"), g!(rect, "width")),
                    obj!("dim"=>c!("true"))
                );
            }
            let changes = c!("diff", s!("previousBuffer"), buffer);
            method!(s!("driver"), "flush", changes);
            if p!("truthy", cursor) {
                method!(s!("driver"), "moveTo", g!(cursor, "x"), g!(cursor, "y"));
                method!(s!("driver"), "showCursor");
            } else {
                method!(s!("driver"), "hideCursor");
            }
            monitor!(
                "end",
                started_at,
                obj!("changedCells"=>g!(changes,"length"))
            );
            let callback = g!(opts, "onPerformance");
            if !p!("nullish", callback) {
                c!("invoke", callback, opts, monitor!("snapshot"));
            }
            put!("previousBuffer", buffer);
        }
        _ => return host.call("invalidOperation", vec![]),
    }
    Ok(undefined)
}
