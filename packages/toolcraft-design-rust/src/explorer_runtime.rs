//! Explorer lifecycle and effect policy. The host retains promises, callbacks and I/O.
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
    macro_rules! p { ($name:expr $(,$arg:expr)* $(,)?) => {{let value=c!($name $(,$arg)*);host.is_true(value)?}}; }
    macro_rules! r { ($op:expr $(,$arg:expr)* $(,)?) => {{let args=[$($arg),*];run(host,$op,&args)?}}; }
    macro_rules! set {
        ($value:expr,$key:expr,$item:expr) => {
            c!("assign", $value, l!($key), $item)
        };
    }
    macro_rules! obj { ($($key:expr=>$value:expr),* $(,)?) => {{let object=c!("object");$(set!(object,$key,$value);)*object}}; }
    macro_rules! clone { ($value:expr $(,$key:expr=>$item:expr)* $(,)?) => {{let object=c!("spread",$value);$(set!(object,$key,$item);)*object}}; }
    macro_rules! m { ($value:expr,$key:expr $(,$arg:expr)* $(,)?) => {{let receiver=$value;c!("invoke",g!(receiver,$key),receiver $(,$arg)*)}}; }
    let undefined = c!("undefined");
    let null = c!("null");
    let yes = c!("true");
    let no = c!("false");
    let runtime = args[0];
    macro_rules! s {
        () => {
            g!(runtime, "state")
        };
    }
    macro_rules! dispatch {
        ($event:expr) => {
            r!("dispatch", runtime, $event)
        };
    }
    macro_rules! eq {
        ($a:expr,$b:expr) => {
            p!("same", $a, $b)
        };
    }
    macro_rules! truth {
        ($a:expr) => {
            p!("truthy", $a)
        };
    }
    macro_rules! fallback {
        ($value:expr,$other:expr) => {{
            let value = $value;
            if p!("nullish", value) { $other } else { value }
        }};
    }
    macro_rules! optional_call {
        ($name:expr) => {{
            let callback = g!(runtime, $name);
            if !p!("nullish", callback) {
                c!("invoke", callback, runtime);
            }
        }};
    }
    match operation {
        "create" => {
            set!(runtime, "config", c!("normalize", args[1]));
            set!(
                runtime,
                "state",
                c!(
                    "initial",
                    g!(runtime, "config"),
                    m!(g!(runtime, "driver"), "getSize")
                )
            );
            set!(
                runtime,
                "screen",
                c!("screen", m!(g!(runtime, "driver"), "getSize"))
            );
            set!(runtime, "detailJobs", c!("jobs"));
            set!(runtime, "runtimeHandles", c!("handles"));
        }
        "run" => {
            m!(g!(runtime, "driver"), "start");
            r!("subscribe", runtime);
            set!(
                runtime,
                "unsubscribeResize",
                c!("subscribeResize", g!(runtime, "driver"))
            );
            let config = g!(runtime, "config");
            if !eq!(g!(config, "initialRows"), undefined)
                && p!("gt", g!(g!(config, "initialRows"), "length"), n!(0.))
            {
                dispatch!(obj!("type"=>l!("rowsLoaded"),"rows"=>g!(config,"initialRows")));
            }
            r!("render", runtime);
            c!("initialLoad");
        }
        "subscribe" => {
            if eq!(g!(runtime, "unsubscribeKeypress"), undefined) {
                set!(
                    runtime,
                    "unsubscribeKeypress",
                    c!("subscribeKey", g!(runtime, "driver"))
                );
            }
        }
        "input" => {
            let event = args[1];
            c!("trace", l!("input"), obj!("event"=>event));
            if eq!(g!(event, "type"), l!("paste")) {
                c!("paste", g!(event, "text"));
            } else if eq!(g!(event, "type"), l!("wheel")) {
                dispatch!(
                    obj!("type"=>l!("key"),"key"=>obj!("name"=>g!(event,"direction"),"ctrl"=>no,"meta"=>no,"shift"=>no))
                );
            } else {
                dispatch!(
                    obj!("type"=>l!("key"),"key"=>obj!("name"=>g!(event,"name"),"ch"=>g!(event,"ch"),"ctrl"=>g!(event,"ctrl"),"meta"=>g!(event,"alt"),"shift"=>g!(event,"shift")))
                );
            }
        }
        "pasteChar" => {
            dispatch!(
                obj!("type"=>l!("key"),"key"=>obj!("ch"=>args[1],"name"=>args[1],"ctrl"=>no,"meta"=>no,"shift"=>no))
            );
        }
        "resize" => {
            dispatch!(
                obj!("type"=>l!("resize"),"cols"=>g!(args[1],"cols"),"rows"=>g!(args[1],"rows"))
            );
        }
        "rowsLoaded" => {
            if eq!(args[1], g!(runtime, "rowsRequestToken")) {
                dispatch!(obj!("type"=>l!("rowsLoaded"),"rows"=>args[2]));
            }
        }
        "dispatch" => {
            if truth!(g!(runtime, "stopped")) {
                return Ok(undefined);
            }
            let previous = s!();
            let next = c!("step", s!(), args[1], g!(runtime, "runtimeHandles"));
            set!(runtime, "state", g!(next, "state"));
            r!("schedule", runtime);
            c!("effects", g!(next, "effects"), previous);
        }
        "effect" => {
            let effect = args[1];
            if eq!(g!(effect, "type"), l!("renderDetail")) {
                r!(
                    "renderDetail",
                    runtime,
                    g!(effect, "rowId"),
                    g!(effect, "token")
                );
            } else if eq!(g!(effect, "type"), l!("persistOrder")) {
                let moved = g!(effect, "movedId");
                let ids = g!(effect, "orderedIds");
                let previous = g!(args[2], "rows");
                let token = c!("add", g!(runtime, "reorderToken"), n!(1.));
                set!(runtime, "reorderToken", token);
                c!("track", c!("persistOrder", moved, ids, previous, token));
            } else if eq!(g!(effect, "type"), l!("suspend")) {
                c!("track", c!("action", effect));
            } else if eq!(g!(effect, "type"), l!("exit")) {
                r!("exit", runtime, g!(effect, "result"), g!(effect, "after"));
            }
        }
        "layout" => {
            let cols = g!(g!(s!(), "size"), "cols");
            let rows = g!(g!(s!(), "size"), "rows");
            let hidden = eq!(g!(s!(), "layout"), l!("narrow-list-only"))
                || eq!(g!(s!(), "layout"), l!("too-narrow"));
            return Ok(c!(
                "layout",
                obj!("cols"=>cols,"rows"=>rows,"detailHidden"=>if hidden{yes}else{no},"focused"=>g!(s!(),"focused"))
            ));
        }
        "renderDetail" => {
            let row = c!("findRow", g!(s!(), "rows"), args[1]);
            if eq!(row, undefined) {
                return Ok(undefined);
            }
            let layout = r!("layout", runtime);
            let reload = c!("detailCallback", args[1]);
            m!(
                g!(runtime, "detailJobs"),
                "schedule",
                args[1],
                args[2],
                c!("detailItems", row, reload),
                obj!("width"=>g!(g!(layout,"detail"),"width"),"height"=>g!(g!(layout,"detail"),"height"),"row"=>row,"signal"=>c!("signal"),"reloadDetail"=>reload)
            );
        }
        "reload" => {
            let focused = g!(g!(s!(), "detail"), "rowId");
            if eq!(focused, null) {
                return Ok(undefined);
            }
            if !eq!(args[1], undefined) && !eq!(args[1], focused) {
                return Ok(undefined);
            }
            let token = c!("add", g!(g!(s!(), "detail"), "token"), n!(1.));
            set!(
                runtime,
                "state",
                clone!(s!(),"detail"=>clone!(g!(s!(),"detail"),"token"=>token))
            );
            r!("renderDetail", runtime, focused, token);
        }
        "detailEvent" => {
            let event = args[1];
            if eq!(g!(event, "type"), l!("detailLoaded")) {
                r!(
                    "loadDetail",
                    runtime,
                    g!(event, "rowId"),
                    g!(event, "token"),
                    g!(event, "items")
                );
            } else {
                dispatch!(event);
            }
        }
        "loadDetail" => {
            let row = c!("findRow", g!(s!(), "rows"), args[1]);
            if eq!(row, undefined) {
                return Ok(undefined);
            }
            let layout = r!("layout", runtime);
            let context = obj!("width"=>g!(g!(layout,"detail"),"width"),"height"=>g!(g!(layout,"detail"),"height"),"row"=>row,"signal"=>c!("signal"));
            let items = c!("prepareItems", args[3], context, args[1], args[2]);
            dispatch!(
                obj!("type"=>l!("detailLoaded"),"rowId"=>args[1],"token"=>args[2],"items"=>items)
            );
        }
        "prepareItem" => {
            let content = c!("renderItem", args[1], args[2]);
            if p!("isString", content) {
                return Ok(clone!(args[1],"renderedContent"=>content));
            }
            c!(
                "track",
                c!("awaitContent", content, args[3], args[4], args[5])
            );
            return Ok(clone!(args[1],"renderedContent"=>l!("Loading detail...")));
        }
        "itemRendered" => {
            dispatch!(
                obj!("type"=>l!("detailItemRendered"),"rowId"=>args[1],"token"=>args[2],"itemIndex"=>args[3],"content"=>args[4])
            );
        }
        "persistError" => {
            r!("toast", runtime, args[3], l!("error"));
            if eq!(args[2], g!(runtime, "reorderToken")) {
                dispatch!(obj!("type"=>l!("rowsLoaded"),"rows"=>args[1]));
            }
        }
        "suspend" => {
            optional_call!("unsubscribeKeypress");
            set!(runtime, "unsubscribeKeypress", undefined);
            set!(runtime, "state", clone!(s!(),"suspended"=>yes));
            m!(g!(runtime, "driver"), "stop");
        }
        "resume" => {
            if !truth!(g!(runtime, "stopped")) {
                m!(g!(runtime, "driver"), "start");
                set!(runtime, "state", clone!(s!(),"suspended"=>no));
                r!("subscribe", runtime);
                let size = m!(g!(runtime, "driver"), "getSize");
                dispatch!(
                    obj!("type"=>l!("suspendResumed"),"value"=>null,"emit"=>obj!("type"=>l!("resize"),"cols"=>g!(size,"cols"),"rows"=>g!(size,"rows")))
                );
            }
        }
        "confirm" | "promptText" => {
            let options = if operation == "confirm" && p!("isString", args[1]) {
                obj!("title"=>l!("Confirm"),"message"=>args[1])
            } else {
                args[1]
            };
            // Spread the current state before evaluating the modal's observable properties.
            let state = c!("spread", s!());
            let modal = if operation == "confirm" {
                obj!("kind"=>l!("confirm"),"title"=>g!(options,"title"),"message"=>g!(options,"message"),"confirmLabel"=>fallback!(g!(options,"confirmLabel"),l!("Yes")),"cancelLabel"=>fallback!(g!(options,"cancelLabel"),l!("No")),"destructive"=>fallback!(g!(options,"destructive"),no),"resolver"=>args[2])
            } else {
                obj!("kind"=>l!("input"),"title"=>g!(options,"title"),"label"=>g!(options,"label"),"value"=>fallback!(g!(options,"initialValue"),l!("")),"placeholder"=>g!(options,"placeholder"),"resolver"=>args[2])
            };
            set!(state, "modal", modal);
            set!(
                state,
                "dirty",
                c!("or", c!("flag", l!("modal")), c!("flag", l!("footer")))
            );
            set!(runtime, "state", state);
            r!("schedule", runtime);
        }
        "openModal" => {
            dispatch!(
                obj!("type"=>l!("modalOpened"),"title"=>g!(args[1],"title"),"content"=>g!(args[1],"content"))
            );
        }
        "toast" => {
            if truth!(g!(runtime, "stopped")) {
                return Ok(undefined);
            }
            if !eq!(g!(runtime, "toastTimer"), undefined) {
                c!("clearTimeout", g!(runtime, "toastTimer"));
            }
            let tone = if eq!(args[2], undefined) {
                l!("info")
            } else {
                args[2]
            };
            set!(
                runtime,
                "state",
                clone!(s!(),"toast"=>obj!("message"=>args[1],"tone"=>tone,"expiresAt"=>c!("add",c!("now"),n!(2500.))),"dirty"=>c!("flag",l!("toast")))
            );
            r!("schedule", runtime);
            set!(runtime, "toastTimer", c!("toastTimer", n!(2500.)));
        }
        "schedule" => {
            if truth!(g!(runtime, "stopped"))
                || truth!(g!(s!(), "suspended"))
                || truth!(g!(runtime, "renderScheduled"))
            {
                return Ok(undefined);
            }
            set!(runtime, "renderScheduled", yes);
            c!("immediate");
        }
        "renderScheduled" => {
            set!(runtime, "renderScheduled", no);
            r!("render", runtime);
        }
        "render" => {
            if truth!(g!(runtime, "stopped")) || truth!(g!(s!(), "suspended")) {
                return Ok(undefined);
            }
            let size = m!(g!(runtime, "driver"), "getSize");
            if !eq!(g!(size, "cols"), g!(g!(s!(), "size"), "cols"))
                || !eq!(g!(size, "rows"), g!(g!(s!(), "size"), "rows"))
            {
                set!(
                    runtime,
                    "state",
                    g!(
                        c!(
                            "step",
                            s!(),
                            obj!("type"=>l!("resize"),"cols"=>g!(size,"cols"),"rows"=>g!(size,"rows")),
                            g!(runtime, "runtimeHandles")
                        ),
                        "state"
                    )
                );
            }
            let screen = g!(runtime, "screen");
            if !eq!(g!(screen, "width"), g!(g!(s!(), "size"), "cols"))
                || !eq!(g!(screen, "height"), g!(g!(s!(), "size"), "rows"))
            {
                m!(screen, "resize", g!(s!(), "size"));
            }
            c!("render", clone!(s!(),"dirty"=>c!("flag",l!("all"))), screen);
            let frame = m!(screen, "flush");
            m!(g!(runtime, "driver"), "writeFrame", frame);
            c!(
                "trace",
                l!("frame"),
                obj!("bytes"=>c!("bytes",frame),"cols"=>g!(g!(s!(),"size"),"cols"),"rows"=>g!(g!(s!(),"size"),"rows"))
            );
            set!(runtime, "state", clone!(s!(),"dirty"=>n!(0.)));
        }
        "track" => {
            c!("track", args[1]);
        }
        "exit" => {
            if truth!(g!(runtime, "stopped")) {
                return Ok(undefined);
            }
            set!(runtime, "stopped", yes);
            optional_call!("unsubscribeKeypress");
            optional_call!("unsubscribeResize");
            m!(g!(runtime, "detailJobs"), "abort");
            if !eq!(g!(runtime, "toastTimer"), undefined) {
                c!("clearTimeout", g!(runtime, "toastTimer"));
            }
            m!(g!(runtime, "driver"), "stop");
            c!("settle", args[1], args[2]);
        }
        "fail" => {
            if !truth!(g!(runtime, "stopped")) {
                set!(runtime, "stopped", yes);
                m!(g!(runtime, "driver"), "stop");
            }
            c!("reject", args[1]);
        }
        _ => {
            c!("invalidOperation");
        }
    }
    Ok(undefined)
}
