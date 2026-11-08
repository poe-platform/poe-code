//! Dashboard snapshot defaults, component orchestration and ANSI serialization.
use crate::feedback::Host;

pub fn run<H: Host>(host: &mut H, args: &[H::Value]) -> Result<H::Value, H::Error> {
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
        ($number:expr) => {
            host.number($number)?
        };
    }
    macro_rules! set {
        ($value:expr,$key:expr,$item:expr) => {
            c!("set", $value, l!($key), $item)
        };
    }
    macro_rules! fallback {
        ($opts:expr,$key:expr,$default:expr) => {{
            let value = g!($opts, $key);
            if p!("nullish", value) {
                $default
            } else {
                value
            }
        }};
    }

    let [opts] = args else {
        return host.call("invalidOperation", vec![]);
    };
    let width = fallback!(*opts, "width", n!(80.));
    let height = fallback!(*opts, "height", n!(20.));
    let title = fallback!(*opts, "title", l!("Agent Output"));
    let stats_title = fallback!(*opts, "statsTitle", l!("Stats"));
    let items = fallback!(*opts, "items", {
        let now = c!("now");
        let items = c!("array");
        for (index, (kind, text)) in [
            ("info", "Analyzing repository state"),
            ("tool", "Running npm test -- --runInBand"),
            ("success", "Generated provider config"),
            ("status", "Streaming model response"),
            ("info", "Inspecting agent configuration"),
            ("tool", "Executing npm run lint:types"),
            ("error", "Retrying transient network request"),
            ("success", "Updated dashboard layout"),
            ("info", "Collecting recent command output"),
            ("status", "Waiting for follow-up task"),
        ]
        .into_iter()
        .enumerate()
        {
            let item = c!("object");
            set!(item, "kind", l!(kind));
            set!(item, "text", l!(text));
            set!(
                item,
                "ts",
                if index == 0 {
                    now
                } else {
                    c!("add", now, n!(index as f64 * 500.))
                }
            );
            c!("push", items, item);
        }
        items
    });
    let stats = fallback!(*opts, "stats", {
        let stats = c!("object");
        set!(stats, "status", l!("running"));
        for (key, value) in [
            ("iterations", 5.),
            ("tokensIn", 685.),
            ("tokensOut", 445.),
            ("elapsedMs", 5000.),
        ] {
            set!(stats, key, n!(value));
        }
        set!(stats, "currentAction", l!("Executing tool call"));
        stats
    });
    let options = c!("object");
    set!(options, "totalWidth", width);
    set!(options, "totalHeight", height);
    set!(options, "rightPaneWidth", n!(25.));
    let layout = c!("layout", options);
    let buffer = c!("buffer", width, height);
    let border = c!("object");
    set!(border, "leftTitle", title);
    set!(border, "rightTitle", stats_title);
    let style = c!("object");
    set!(style, "dim", c!("true"));
    set!(border, "style", style);
    c!("border", buffer, layout, border);
    c!("output", buffer, g!(layout, "leftPane"), items);
    c!("stats", buffer, g!(layout, "rightPane"), stats);
    if p!("truthy", g!(layout, "summary")) {
        c!("compactStats", buffer, g!(layout, "summary"), stats);
    }
    c!("footer", buffer, g!(layout, "footer"), c!("hints"));
    let lines = c!("array");
    let zero = n!(0.);
    let one = n!(1.);
    let mut y = zero;
    while p!("lt", y, g!(buffer, "height")) {
        let mut line = l!("");
        let mut x = zero;
        while p!("lt", x, g!(buffer, "width")) {
            let cell = c!("invoke", g!(buffer, "get"), buffer, x, y);
            line = c!("add", line, c!("cellToAnsi", cell));
            x = c!("add", x, one);
        }
        c!("push", lines, line);
        y = c!("add", y, one);
    }
    Ok(c!("join", lines, l!("\n")))
}
