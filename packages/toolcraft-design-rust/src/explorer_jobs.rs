//! Detail loading, cancellation and cleanup policy; promises and timers stay on the host.
use crate::feedback::Host;

pub const LOADING_INDICATOR_MS: u32 = 150;
pub const DETAIL_DEBOUNCE_MS: u32 = 30;

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
        ($value:expr) => {
            host.literal($value)?
        };
    }
    macro_rules! n {
        ($value:expr) => {
            host.number($value)?
        };
    }
    macro_rules! p { ($name:expr $(,$arg:expr)*) => {{let value=c!($name $(,$arg)*);host.is_true(value)?}}; }
    macro_rules! set {
        ($value:expr,$key:expr,$item:expr) => {
            c!("assign", $value, l!($key), $item)
        };
    }
    macro_rules! obj { ($($key:expr => $value:expr),* $(,)?) => {{let object=c!("object");$(set!(object,$key,$value);)*object}}; }
    let undefined = c!("undefined");
    match operation {
        "create" => Ok(
            obj!("lastScheduleAt"=>n!(0.),"current"=>c!("null"),"abortedTokens"=>c!("set"),"emit"=>args[0]),
        ),
        "start" => {
            let state = args[0];
            if !p!("isNull", g!(state, "current")) {
                c!("abortController", g!(g!(state, "current"), "controller"));
                c!("clear", g!(g!(state, "current"), "loadingTimer"));
            }
            let now = c!("now");
            let debounce = c!(
                "debounce",
                now,
                g!(state, "lastScheduleAt"),
                n!(DETAIL_DEBOUNCE_MS as f64)
            );
            set!(state, "lastScheduleAt", now);
            let controller = c!("controller");
            let job = obj!("controller"=>controller,"finished"=>c!("false"),"rowId"=>args[1],"token"=>args[2],"debounce"=>debounce);
            let timer = c!("loadingTimer", state, job, n!(LOADING_INDICATOR_MS as f64));
            set!(job, "loadingTimer", timer);
            set!(state, "current", job);
            Ok(job)
        }
        "skip" => {
            let aborted = g!(g!(g!(args[1], "controller"), "signal"), "aborted");
            let skip = p!("truthy", aborted)
                || !p!(
                    "same",
                    c!("optionalToken", g!(args[0], "current")),
                    g!(args[1], "token")
                );
            Ok(c!(if skip { "true" } else { "false" }))
        }
        "context" => {
            let context = c!("spread", args[0]);
            set!(context, "signal", g!(g!(args[1], "controller"), "signal"));
            Ok(context)
        }
        "loading" | "loaded" | "error" => {
            let state = args[0];
            let job = args[1];
            if operation == "loading" {
                if p!("truthy", g!(job, "finished")) {
                    return Ok(undefined);
                }
            } else {
                set!(job, "finished", c!("true"));
            }
            if !p!("has", g!(state, "abortedTokens"), g!(job, "token")) {
                let event = obj!("type"=>l!(match operation {"loading"=>"detailLoading","loaded"=>"detailLoaded",_=>"detailError"}),"rowId"=>g!(job,"rowId"),"token"=>g!(job,"token"));
                if operation == "loaded" {
                    set!(event, "items", args[2]);
                } else if operation == "error" {
                    set!(event, "error", c!("toError", args[2]));
                }
                c!("emit", g!(state, "emit"), event);
            }
            Ok(undefined)
        }
        "finish" => {
            let state = args[0];
            let job = args[1];
            set!(job, "finished", c!("true"));
            c!("clear", g!(job, "loadingTimer"));
            c!("delete", g!(state, "abortedTokens"), g!(job, "token"));
            if p!(
                "same",
                c!("optionalController", g!(state, "current")),
                g!(job, "controller")
            ) {
                set!(state, "current", c!("null"));
            }
            Ok(undefined)
        }
        "abort" => {
            let state = args[0];
            if !p!("isNull", g!(state, "current")) {
                c!("abortController", g!(g!(state, "current"), "controller"));
                c!("clear", g!(g!(state, "current"), "loadingTimer"));
                c!(
                    "add",
                    g!(state, "abortedTokens"),
                    g!(g!(state, "current"), "token")
                );
                set!(state, "current", c!("null"));
            }
            Ok(undefined)
        }
        "waitStart" => {
            let signal = args[0];
            if p!("truthy", g!(signal, "aborted")) {
                c!("resolve", args[1]);
            } else {
                let wait = obj!("signal"=>signal,"resolve"=>args[1]);
                set!(wait, "onAbort", c!("onAbort", wait));
                set!(
                    wait,
                    "timer",
                    c!("waitTimer", wait, n!(DETAIL_DEBOUNCE_MS as f64))
                );
                c!("listen", signal, g!(wait, "onAbort"));
            }
            Ok(undefined)
        }
        "waitAbort" | "waitElapsed" => {
            let wait = args[0];
            if operation == "waitAbort" {
                c!("clear", g!(wait, "timer"));
            } else {
                c!("unlisten", g!(wait, "signal"), g!(wait, "onAbort"));
            }
            c!("resolve", g!(wait, "resolve"));
            Ok(undefined)
        }
        _ => Ok(c!("invalidOperation")),
    }
}
