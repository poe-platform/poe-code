//! Run dashboard hierarchy, queue/task windows, composer placement and controls.
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
    macro_rules! r { ($op:expr $(,$arg:expr)* $(,)?) => {{let args=[$($arg),*];run(host,$op,&args)?}}; }
    macro_rules! l {
        ($text:expr) => {{
            let text = $text;
            host.literal(text)?
        }};
    }
    macro_rules! n {
        ($value:expr) => {
            host.number($value as f64)?
        };
    }
    macro_rules! o {
        ($value:expr,$key:expr) => {{
            let value = $value;
            if p!("nullish", value) {
                c!("undefined")
            } else {
                g!(value, $key)
            }
        }};
    }
    macro_rules! fallback {
        ($value:expr,$other:expr) => {{
            let value = $value;
            if p!("nullish", value) { $other } else { value }
        }};
    }
    macro_rules! set {
        ($value:expr,$key:expr,$item:expr) => {
            c!("set", $value, l!($key), $item)
        };
    }
    macro_rules! text { ($first:expr $(,$rest:expr)* $(,)?) => {{let value=c!("concat",l!(""),$first);$(let value=c!("concat",value,$rest);)*value}}; }
    macro_rules! filter { ($array:expr,$op:expr $(,$arg:expr)* $(,)?) => {c!("filter",$array,l!($op) $(,$arg)*)}; }
    macro_rules! find_index { ($array:expr,$op:expr $(,$arg:expr)* $(,)?) => {c!("findIndex",$array,l!($op) $(,$arg)*)}; }
    macro_rules! find { ($array:expr,$op:expr $(,$arg:expr)* $(,)?) => {c!("find",$array,l!($op) $(,$arg)*)}; }
    let zero = n!(0);
    let one = n!(1);
    let two = n!(2);
    let three = n!(3);
    let undefined = c!("undefined");
    let empty = l!("");
    match (operation, args) {
        ("put", [buffer, rect, row, text, style]) => {
            if p!("lt", *row, zero)
                || p!("ge", *row, g!(*rect, "height"))
                || p!("ge", c!("add", g!(*rect, "y"), *row), g!(*buffer, "height"))
            {
                return Ok(undefined);
            }
            c!(
                "invoke",
                g!(*buffer, "putInRect"),
                *buffer,
                *rect,
                *row,
                c!(
                    "truncateToWidth",
                    c!("plainTerminalText", *text),
                    g!(*rect, "width")
                ),
                *style
            );
        }
        ("marker", [status]) => return Ok(c!("at", c!("markers"), *status)),
        ("tone", [status]) => {
            let theme = g!(c!("getTheme"), "styles");
            return Ok(if p!("same", *status, l!("running")) {
                c!("boldStyle", g!(theme, "info"))
            } else if p!("same", *status, l!("failed")) {
                g!(theme, "error")
            } else {
                g!(theme, "muted")
            });
        }
        ("basename", [value]) => {
            return Ok(fallback!(c!("last", c!("split", *value, l!("/"))), *value));
        }
        ("path", [value, cwd]) => {
            if !p!("truthy", *cwd) {
                return Ok(*value);
            }
            let prefix = if p!("endsWith", *cwd, l!("/")) {
                *cwd
            } else {
                text!(*cwd, l!("/"))
            };
            return Ok(if p!("startsWith", *value, prefix) {
                c!("slice", *value, g!(prefix, "length"))
            } else {
                *value
            });
        }
        ("plan", [item]) => return Ok(c!("same", g!(*item, "kind"), l!("plan"))),
        ("completed", [item]) => return Ok(c!("same", g!(*item, "status"), l!("completed"))),
        ("pendingTask", [item]) => {
            return Ok(c!(
                "same",
                c!("same", g!(*item, "status"), l!("completed")),
                c!("lt", one, zero)
            ));
        }
        ("running", [item]) => return Ok(c!("same", g!(*item, "status"), l!("running"))),
        ("activeMessage", [item]) => {
            return Ok(if p!("same", g!(*item, "kind"), l!("message")) {
                c!("same", g!(*item, "status"), l!("running"))
            } else {
                c!("lt", one, zero)
            });
        }
        ("pendingMessage", [item]) => {
            return Ok(if p!("same", g!(*item, "kind"), l!("message")) {
                c!("same", g!(*item, "status"), l!("pending"))
            } else {
                c!("lt", one, zero)
            });
        }
        ("runPlan", [item, run]) => {
            return Ok(c!("same", g!(*item, "id"), o!(*run, "activePlanId")));
        }
        ("statsPlan", [item, stats]) => {
            return Ok(c!(
                "same",
                g!(*item, "id"),
                o!(g!(*stats, "run"), "activePlanId")
            ));
        }
        ("statsTask", [item, stats]) => {
            return Ok(c!(
                "same",
                g!(*item, "id"),
                o!(g!(*stats, "run"), "activeTaskId")
            ));
        }
        ("statsStep", [item, stats]) => {
            return Ok(c!(
                "same",
                g!(*item, "name"),
                o!(g!(*stats, "run"), "activeStep")
            ));
        }
        ("afterPlan", [item, target]) => {
            return Ok(c!("same", g!(*item, "id"), g!(*target, "afterPlanId")));
        }
        ("sameId", [item, target]) => return Ok(c!("same", g!(*item, "id"), g!(*target, "id"))),
        ("messageForRun", [item, run]) => {
            return Ok(if p!("same", g!(*item, "kind"), l!("message")) {
                c!("same", g!(*item, "afterPlanId"), o!(*run, "activePlanId"))
            } else {
                c!("lt", one, zero)
            });
        }
        ("hint", [hint]) => return Ok(text!(g!(*hint, "key"), l!(" "), g!(*hint, "label"))),
        ("footerPart", [part, lines, width]) => {
            let previous = c!("last", *lines);
            if p!("truthy", previous)
                && p!(
                    "gt",
                    c!("displayWidth", text!(previous, l!("  "), *part)),
                    *width
                )
            {
                c!("push", *lines, *part);
            } else {
                let text = if p!("truthy", previous) {
                    text!(previous, l!("  "), *part)
                } else {
                    *part
                };
                c!(
                    "set",
                    *lines,
                    c!("subtract", g!(*lines, "length"), one),
                    text
                );
            }
        }
        ("footerRow", [index, line, buffer, x, y, width, theme]) => {
            r!(
                "put",
                *buffer,
                c!("rect", *x, c!("add", *y, *index), *width, one),
                zero,
                *line,
                g!(*theme, "muted")
            );
        }
        ("render", [buffer, options]) => {
            let stats = g!(*options, "stats");
            let composer = if p!("truthy", g!(*options, "showQueue"))
                && !p!("truthy", o!(g!(*options, "composer"), "focused"))
            {
                undefined
            } else {
                g!(*options, "composer")
            };
            let run = g!(stats, "run");
            let theme = g!(c!("getTheme"), "styles");
            let compact = p!("lt", g!(*buffer, "height"), n!(20));
            let tight =
                p!("lt", g!(*buffer, "height"), n!(12)) || p!("lt", g!(*buffer, "width"), n!(40));
            let width = c!(
                "max",
                zero,
                c!("min", n!(164), c!("subtract", g!(*buffer, "width"), n!(4)))
            );
            let x = c!(
                "max",
                zero,
                c!(
                    "floor",
                    c!("divide", c!("subtract", g!(*buffer, "width"), width), two)
                )
            );
            let sidebar =
                if !compact && !p!("truthy", g!(*options, "showQueue")) && p!("ge", width, n!(106))
                {
                    c!("min", n!(40), c!("floor", c!("multiply", width, n!(0.29))))
                } else {
                    zero
                };
            let transcript = c!(
                "max",
                zero,
                c!(
                    "subtract",
                    width,
                    if p!("gt", sidebar, zero) {
                        c!("add", sidebar, three)
                    } else {
                        zero
                    }
                )
            );
            let queue = fallback!(o!(run, "queue"), c!("array"));
            let plans = filter!(queue, "plan");
            let active_index = c!("max", zero, find_index!(plans, "runPlan", run));
            let active_plan = c!("at", plans, active_index);
            let next_plan = c!("at", plans, c!("add", active_index, one));
            let progress = if p!("gt", g!(plans, "length"), zero) {
                text!(
                    l!(" · Plan "),
                    c!("add", active_index, one),
                    l!("/"),
                    g!(plans, "length")
                )
            } else {
                empty
            };
            r!(
                "put",
                *buffer,
                c!("rect", x, zero, width, one),
                zero,
                text!(g!(*options, "title"), progress),
                c!("bold")
            );
            let agent = o!(run, "agent");
            let model = fallback!(
                o!(run, "model"),
                if p!("truthy", o!(run, "agent")) {
                    l!("default model")
                } else {
                    undefined
                }
            );
            let context = c!("filterJoin", agent, model, o!(run, "cwd"));
            let draft = if p!("truthy", composer) {
                c!(
                    "layoutComposer",
                    composer,
                    c!("max", one, c!("subtract", transcript, three))
                )
            } else {
                undefined
            };
            let input_lines = if p!("truthy", draft) {
                c!(
                    "min",
                    if compact { one } else { three },
                    g!(g!(draft, "lines"), "length")
                )
            } else {
                zero
            };
            let input_row = if compact { one } else { two };
            let composer_height = if p!("truthy", composer) {
                c!(
                    "add",
                    c!("add", input_lines, input_row),
                    if !compact
                        || p!("truthy", g!(composer, "error"))
                        || p!("truthy", g!(*options, "feedback"))
                    {
                        one
                    } else {
                        zero
                    }
                )
            } else {
                zero
            };
            let hint = if tight {
                if p!("truthy", o!(composer, "focused")) {
                    l!("Enter Queue  Esc Browse")
                } else {
                    l!("i Message  v Tasks  q Quit")
                }
            } else if p!("truthy", o!(composer, "focused")) {
                if p!("same", g!(composer, "kind"), l!("plan")) {
                    l!("Enter Queue plan  Ctrl+P Message  Esc Browse")
                } else {
                    l!("Enter Queue  Alt+Enter Newline  Ctrl+P Plan  Alt+↑↓ Target  Esc Browse")
                }
            } else if p!("truthy", g!(*options, "showQueue")) {
                l!(
                    "↑↓ Scroll  PgUp/PgDn Page  Home/End Jump  f Current  v Activity  i Message  q Quit"
                )
            } else if p!("truthy", g!(*options, "hints")) {
                c!(
                    "join",
                    c!("map", g!(*options, "hints"), l!("hint")),
                    l!("  ")
                )
            } else if p!("lt", width, n!(100)) {
                l!("i Message  p Plan  v Tasks  d Details  ↑↓ Scroll  f Follow  q Quit")
            } else {
                l!("i Message  p Add plan  v Tasks & plans  d Details  ↑↓ Scroll  f Follow  q Quit")
            };
            let footer_lines = c!("array");
            c!("push", footer_lines, empty);
            c!(
                "walk",
                l!("footerPart"),
                c!("split", c!("plainTerminalText", hint), l!("  ")),
                footer_lines,
                width
            );
            let footer_y = c!(
                "max",
                zero,
                c!(
                    "subtract",
                    g!(*buffer, "height"),
                    g!(footer_lines, "length")
                )
            );
            let composer_y = c!("max", zero, c!("subtract", footer_y, composer_height));
            let bottom = if p!("truthy", composer) {
                c!("subtract", composer_y, one)
            } else {
                c!("subtract", footer_y, one)
            };
            let show_context = !tight && (!compact || p!("ge", bottom, n!(6)));
            if show_context {
                r!(
                    "put",
                    *buffer,
                    c!("rect", x, one, width, one),
                    zero,
                    context,
                    g!(theme, "muted")
                );
            }
            let mut output_y = if compact {
                if show_context { two } else { one }
            } else {
                three
            };
            if p!("same", sidebar, zero) {
                if p!("same", o!(active_plan, "kind"), l!("plan")) && !tight {
                    let rect = c!("rect", x, output_y, width, one);
                    output_y = c!("add", output_y, one);
                    r!(
                        "put",
                        *buffer,
                        rect,
                        zero,
                        text!(
                            r!("marker", g!(active_plan, "status")),
                            l!(" "),
                            c!("add", active_index, one),
                            l!(". "),
                            r!("basename", g!(active_plan, "path"))
                        ),
                        c!("bold")
                    );
                }
                if p!("same", o!(next_plan, "kind"), l!("plan"))
                    && !p!("truthy", g!(*options, "showQueue"))
                    && !compact
                {
                    let rect = c!("rect", x, output_y, width, one);
                    output_y = c!("add", output_y, one);
                    r!(
                        "put",
                        *buffer,
                        rect,
                        zero,
                        text!(
                            l!("○ "),
                            c!("add", active_index, two),
                            l!(". "),
                            r!("basename", g!(next_plan, "path")),
                            l!(" · next")
                        ),
                        g!(theme, "muted")
                    );
                }
            }
            let tasks = fallback!(o!(run, "tasks"), c!("array"));
            let completed = g!(filter!(tasks, "completed"), "length");
            let count = if p!("gt", g!(tasks, "length"), zero) {
                text!(completed, l!("/"), g!(tasks, "length"), l!(" tasks"))
            } else {
                text!(
                    fallback!(g!(stats, "iterationsLabel"), l!("Iterations")),
                    l!(" "),
                    g!(stats, "iterations")
                )
            };
            let step = if p!("truthy", o!(run, "activeStep")) {
                c!(
                    "truncateToWidth",
                    c!("plainTerminalText", g!(run, "activeStep")),
                    c!(
                        "max",
                        zero,
                        c!(
                            "min",
                            c!("max", n!(8), c!("floor", c!("divide", transcript, n!(4)))),
                            c!(
                                "subtract",
                                c!("subtract", transcript, c!("displayWidth", count)),
                                n!(12)
                            )
                        )
                    )
                )
            } else {
                undefined
            };
            let progress_label = c!("filterJoin", step, count);
            let mut phase_label = fallback!(
                o!(run, "phase"),
                fallback!(g!(stats, "currentAction"), g!(stats, "status"))
            );
            if p!("same", phase_label, l!("Follow-up")) {
                let messages = filter!(queue, "messageForRun", run);
                let active = find_index!(messages, "running");
                if p!("ge", active, zero) {
                    phase_label = c!(
                        "add",
                        phase_label,
                        text!(
                            l!(" "),
                            c!("add", active, one),
                            l!("/"),
                            g!(messages, "length")
                        )
                    );
                }
            }
            let phase = c!(
                "truncateToWidth",
                c!("plainTerminalText", phase_label),
                c!(
                    "max",
                    zero,
                    c!(
                        "subtract",
                        c!("subtract", transcript, c!("displayWidth", progress_label)),
                        n!(7)
                    )
                )
            );
            let status_marker = c!("at", c!("statusMarkers"), g!(stats, "status"));
            let rect = c!("rect", x, output_y, transcript, one);
            output_y = c!("add", output_y, one);
            let status_text = text!(
                status_marker,
                l!(" "),
                phase,
                l!(" · "),
                progress_label,
                if p!("truthy", o!(run, "activity")) {
                    text!(l!(" · "), g!(run, "activity"))
                } else {
                    empty
                }
            );
            r!(
                "put",
                *buffer,
                rect,
                zero,
                status_text,
                if p!("same", g!(stats, "status"), l!("error")) {
                    g!(theme, "error")
                } else {
                    c!("bold")
                }
            );
            if !compact {
                output_y = c!("add", output_y, one);
            }
            let output_rect = c!(
                "rect",
                x,
                output_y,
                transcript,
                c!("max", zero, c!("subtract", bottom, output_y))
            );
            let mut scroll = g!(*options, "scrollOffset");
            let mut work = fallback!(g!(*options, "workOffset"), zero);
            if p!("truthy", g!(*options, "showQueue")) {
                work = r!(
                    "workList",
                    *buffer,
                    output_rect,
                    stats,
                    g!(*options, "workOffset")
                );
            } else {
                scroll = c!(
                    "renderOutputPane",
                    *buffer,
                    output_rect,
                    g!(*options, "output"),
                    g!(*options, "scrollOffset"),
                    c!(
                        "outputOptions",
                        g!(*options, "showDetails"),
                        if p!("same", g!(stats, "status"), l!("running")) {
                            g!(*options, "now")
                        } else {
                            undefined
                        }
                    )
                );
            }
            if p!("gt", sidebar, zero) {
                let sx = c!("add", c!("add", x, transcript), three);
                let sh = c!("max", zero, c!("subtract", bottom, three));
                let mut row = three;
                while p!("lt", row, bottom) {
                    c!(
                        "invoke",
                        g!(*buffer, "put"),
                        *buffer,
                        c!("subtract", sx, two),
                        row,
                        l!("│"),
                        g!(theme, "muted")
                    );
                    row = c!("add", row, one);
                }
                r!(
                    "workPanel",
                    *buffer,
                    c!("rect", sx, three, sidebar, sh),
                    stats
                );
            }
            let usage = if p!("same", g!(stats, "usageAvailable"), c!("lt", one, zero))
                || (p!("same", g!(stats, "usageAvailable"), undefined)
                    && p!(
                        "same",
                        c!("add", g!(stats, "tokensIn"), g!(stats, "tokensOut")),
                        zero
                    )) {
                l!("Usage unavailable")
            } else {
                text!(
                    c!(
                        "formatNumber",
                        c!("add", g!(stats, "tokensIn"), g!(stats, "tokensOut"))
                    ),
                    l!(" tokens")
                )
            };
            let pending = g!(filter!(queue, "pendingMessage"), "length");
            let metrics = text!(
                c!("formatElapsed", g!(stats, "elapsedMs")),
                l!(" · "),
                usage,
                if p!("truthy", pending) {
                    text!(
                        l!(" · "),
                        pending,
                        l!(" message"),
                        if p!("same", pending, one) {
                            empty
                        } else {
                            l!("s")
                        },
                        l!(" queued")
                    )
                } else {
                    empty
                },
                if p!("gt", scroll, zero) && !p!("truthy", g!(*options, "showQueue")) {
                    l!(" · History paused")
                } else {
                    empty
                }
            );
            r!(
                "put",
                *buffer,
                c!("rect", x, bottom, transcript, one),
                zero,
                metrics,
                g!(theme, "muted")
            );
            let mut cursor = undefined;
            if p!("truthy", composer) && p!("truthy", draft) {
                let rect = c!("rect", x, composer_y, transcript, composer_height);
                let target = fallback!(find!(plans, "afterPlan", composer), active_plan);
                let label = if p!("same", g!(composer, "kind"), l!("plan")) {
                    l!("ADD PLAN · joins the end of the queue")
                } else {
                    text!(
                        l!("AFTER "),
                        if p!("same", o!(target, "kind"), l!("plan")) {
                            r!("basename", g!(target, "path"))
                        } else {
                            l!("CURRENT PLAN")
                        }
                    )
                };
                if !compact {
                    r!(
                        "put",
                        *buffer,
                        rect,
                        zero,
                        c!("repeat", l!("─"), transcript),
                        g!(theme, "muted")
                    );
                }
                r!(
                    "put",
                    *buffer,
                    rect,
                    c!("subtract", input_row, one),
                    if p!("truthy", g!(*options, "submitting")) {
                        l!("Adding to queue…")
                    } else {
                        label
                    },
                    g!(theme, "muted")
                );
                let start = c!(
                    "max",
                    zero,
                    c!(
                        "min",
                        c!(
                            "add",
                            c!("subtract", g!(g!(draft, "cursor"), "y"), input_lines),
                            one
                        ),
                        c!("subtract", g!(g!(draft, "lines"), "length"), input_lines)
                    )
                );
                let mut index = zero;
                while p!("lt", index, input_lines) {
                    let line = if p!("same", g!(g!(composer, "text"), "length"), zero) {
                        if p!("same", g!(composer, "kind"), l!("plan")) {
                            l!("docs/plans/next-plan.md")
                        } else {
                            l!("Queue a message for this plan…")
                        }
                    } else {
                        fallback!(c!("at", g!(draft, "lines"), c!("add", start, index)), empty)
                    };
                    r!(
                        "put",
                        *buffer,
                        rect,
                        c!("add", index, input_row),
                        text!(
                            if p!("same", index, zero) {
                                l!("›")
                            } else {
                                l!(" ")
                            },
                            l!("  "),
                            line
                        ),
                        if p!("same", g!(g!(composer, "text"), "length"), zero) {
                            g!(theme, "muted")
                        } else {
                            c!("object")
                        }
                    );
                    index = c!("add", index, one);
                }
                if p!("truthy", g!(composer, "error")) {
                    r!(
                        "put",
                        *buffer,
                        rect,
                        c!("subtract", composer_height, one),
                        g!(composer, "error"),
                        g!(theme, "error")
                    );
                } else if p!("truthy", g!(*options, "feedback")) {
                    r!(
                        "put",
                        *buffer,
                        rect,
                        c!("subtract", composer_height, one),
                        g!(*options, "feedback"),
                        g!(theme, "success")
                    );
                }
                if p!("truthy", g!(composer, "focused"))
                    && !p!("truthy", g!(*options, "submitting"))
                {
                    cursor = c!(
                        "point",
                        c!(
                            "min",
                            c!("subtract", g!(*buffer, "width"), one),
                            c!("add", c!("add", x, three), g!(g!(draft, "cursor"), "x"))
                        ),
                        c!(
                            "max",
                            zero,
                            c!(
                                "min",
                                c!("subtract", footer_y, one),
                                c!(
                                    "subtract",
                                    c!(
                                        "add",
                                        c!("add", composer_y, input_row),
                                        g!(g!(draft, "cursor"), "y")
                                    ),
                                    start
                                )
                            )
                        )
                    );
                }
            }
            c!(
                "entries",
                l!("footerRow"),
                footer_lines,
                *buffer,
                x,
                footer_y,
                width,
                theme
            );
            return Ok(c!("result", scroll, work, output_rect, cursor));
        }
        ("workList", [buffer, rect, stats, requested]) => {
            let theme = g!(c!("getTheme"), "styles");
            let queue = fallback!(o!(g!(*stats, "run"), "queue"), c!("array"));
            let tasks = fallback!(o!(g!(*stats, "run"), "tasks"), c!("array"));
            let active = find_index!(queue, "activeMessage");
            let current = c!(
                "add",
                one,
                if p!("ge", active, zero) {
                    active
                } else {
                    find_index!(queue, "statsPlan", *stats)
                }
            );
            let state = c!("object");
            set!(state, "current", current);
            set!(state, "total", c!("add", g!(queue, "length"), three));
            set!(state, "completed", zero);
            c!(
                "walk",
                l!("countTask"),
                tasks,
                *requested,
                active,
                *stats,
                state
            );
            let capacity = c!("max", zero, c!("subtract", g!(*rect, "height"), two));
            let offset = c!(
                "max",
                zero,
                c!(
                    "min",
                    fallback!(
                        *requested,
                        c!("max", zero, c!("subtract", g!(state, "current"), one))
                    ),
                    c!("subtract", g!(state, "total"), capacity)
                )
            );
            let end = c!("add", offset, capacity);
            set!(state, "offset", offset);
            set!(state, "end", end);
            r!(
                "paint",
                *buffer,
                *rect,
                state,
                zero,
                text!(l!("PLANS · "), g!(filter!(queue, "plan"), "length")),
                c!("bold")
            );
            let mut plan_number = zero;
            let mut parent_plan = undefined;
            let mut index = zero;
            while p!(
                "lt",
                index,
                c!("min", g!(queue, "length"), c!("subtract", end, one))
            ) {
                let item = c!("at", queue, index);
                if p!("same", g!(item, "kind"), l!("plan")) {
                    plan_number = c!("add", plan_number, one);
                    parent_plan = g!(item, "path");
                }
                if !p!("lt", c!("add", index, one), offset) {
                    let text = if p!("same", g!(item, "kind"), l!("plan")) {
                        text!(
                            plan_number,
                            l!(". "),
                            r!("path", g!(item, "path"), o!(g!(*stats, "run"), "cwd"))
                        )
                    } else {
                        text!(l!("  └ "), g!(item, "text"))
                    };
                    r!(
                        "paint",
                        *buffer,
                        *rect,
                        state,
                        c!("add", index, one),
                        text!(r!("marker", g!(item, "status")), l!(" "), text),
                        r!("tone", g!(item, "status"))
                    );
                    if p!("same", c!("add", index, one), offset)
                        && p!("same", g!(item, "kind"), l!("message"))
                        && p!("truthy", parent_plan)
                    {
                        set!(
                            state,
                            "parent",
                            text!(
                                l!("After "),
                                r!("path", parent_plan, o!(g!(*stats, "run"), "cwd"))
                            )
                        );
                    }
                }
                index = c!("add", index, one);
            }
            r!(
                "paint",
                *buffer,
                *rect,
                state,
                c!("add", g!(queue, "length"), two),
                text!(
                    l!("TASKS · "),
                    g!(state, "completed"),
                    l!("/"),
                    g!(tasks, "length")
                ),
                c!("bold")
            );
            set!(state, "line", c!("add", g!(queue, "length"), three));
            c!(
                "entries",
                l!("taskRow"),
                tasks,
                *buffer,
                *rect,
                *stats,
                state
            );
            if p!("gt", offset, zero) {
                r!(
                    "put",
                    *buffer,
                    *rect,
                    zero,
                    text!(
                        l!("↑ earlier · "),
                        fallback!(g!(state, "parent"), l!("tasks and plans"))
                    ),
                    g!(theme, "muted")
                );
            }
            if p!("lt", end, g!(state, "total")) {
                r!(
                    "put",
                    *buffer,
                    *rect,
                    c!("subtract", g!(*rect, "height"), one),
                    l!("↓ more tasks and plans"),
                    g!(theme, "muted")
                );
            }
            return Ok(offset);
        }
        ("countTask", [task, requested, active, stats, state]) => {
            if p!("same", g!(*task, "status"), l!("completed")) {
                set!(*state, "completed", c!("add", g!(*state, "completed"), one));
            }
            if p!("same", *requested, undefined)
                && p!("lt", *active, zero)
                && p!(
                    "same",
                    g!(*task, "id"),
                    o!(g!(*stats, "run"), "activeTaskId")
                )
            {
                let steps = g!(*task, "steps");
                let step = if p!("nullish", steps) {
                    n!(-1)
                } else {
                    fallback!(find_index!(steps, "statsStep", *stats), n!(-1))
                };
                set!(
                    *state,
                    "current",
                    c!(
                        "add",
                        g!(*state, "total"),
                        if p!("ge", step, zero) {
                            c!("add", step, one)
                        } else {
                            zero
                        }
                    )
                );
            }
            set!(
                *state,
                "total",
                c!(
                    "add",
                    g!(*state, "total"),
                    c!(
                        "add",
                        one,
                        fallback!(o!(g!(*task, "steps"), "length"), zero)
                    )
                )
            );
        }
        ("paint", [buffer, rect, state, line, text, style]) => {
            if p!("ge", *line, g!(*state, "offset")) && p!("lt", *line, g!(*state, "end")) {
                r!(
                    "put",
                    *buffer,
                    *rect,
                    c!("add", c!("subtract", *line, g!(*state, "offset")), one),
                    *text,
                    *style
                );
            }
        }
        ("taskRow", [index, task, buffer, rect, stats, state]) => {
            let line = g!(*state, "line");
            let end = g!(*state, "end");
            let offset = g!(*state, "offset");
            if p!("ge", line, end) {
                return Ok(c!("gt", one, zero));
            }
            let next = c!(
                "add",
                c!("add", line, one),
                fallback!(o!(g!(*task, "steps"), "length"), zero)
            );
            if p!("le", next, offset) {
                set!(*state, "line", next);
                return Ok(undefined);
            }
            let title = text!(c!("add", *index, one), l!(". "), g!(*task, "title"));
            let active = p!(
                "same",
                g!(*task, "id"),
                o!(g!(*stats, "run"), "activeTaskId")
            ) && p!("same", g!(*stats, "status"), l!("running"));
            let status = if active {
                l!("running")
            } else {
                g!(*task, "status")
            };
            r!(
                "paint",
                *buffer,
                *rect,
                *state,
                line,
                text!(r!("marker", status), l!(" "), title),
                r!("tone", status)
            );
            let mut step_index = c!(
                "max",
                zero,
                c!("subtract", c!("subtract", offset, line), one)
            );
            while p!(
                "lt",
                step_index,
                fallback!(o!(g!(*task, "steps"), "length"), zero)
            ) && p!("lt", c!("add", c!("add", line, step_index), one), end)
            {
                let step = c!("at", g!(*task, "steps"), step_index);
                let name = g!(step, "name");
                let status = if active && p!("same", name, o!(g!(*stats, "run"), "activeStep")) {
                    l!("running")
                } else {
                    g!(step, "status")
                };
                r!(
                    "paint",
                    *buffer,
                    *rect,
                    *state,
                    c!("add", c!("add", line, step_index), one),
                    text!(l!("    "), r!("marker", status), l!(" "), name),
                    r!("tone", status)
                );
                if p!("same", c!("add", c!("add", line, step_index), one), offset) {
                    set!(*state, "parent", title);
                }
                step_index = c!("add", step_index, one);
            }
            set!(*state, "line", next);
        }
        ("panelStep", [step, stats]) => {
            return Ok(text!(
                if p!(
                    "same",
                    g!(*step, "name"),
                    o!(g!(*stats, "run"), "activeStep")
                ) {
                    l!("›")
                } else {
                    r!("marker", g!(*step, "status"))
                },
                l!(" "),
                g!(*step, "name")
            ));
        }
        ("workPanel", [buffer, rect, stats]) => {
            let theme = g!(c!("getTheme"), "styles");
            let queue = fallback!(o!(g!(*stats, "run"), "queue"), c!("array"));
            let tasks = fallback!(o!(g!(*stats, "run"), "tasks"), c!("array"));
            let plans = filter!(queue, "plan");
            let plan_index = c!("max", zero, find_index!(plans, "statsPlan", *stats));
            let mut row = zero;
            let current = row;
            row = c!("add", row, one);
            r!(
                "put",
                *buffer,
                *rect,
                current,
                text!(
                    l!("PLANS · "),
                    if p!("gt", g!(plans, "length"), zero) {
                        c!("add", plan_index, one)
                    } else {
                        zero
                    },
                    l!("/"),
                    g!(plans, "length")
                ),
                c!("bold")
            );
            let plan_rows = c!(
                "min",
                c!(
                    "max",
                    three,
                    c!("floor", c!("multiply", g!(*rect, "height"), n!(0.4)))
                ),
                c!("max", zero, c!("subtract", g!(*rect, "height"), n!(4)))
            );
            let running = find_index!(queue, "running");
            let active = c!(
                "max",
                zero,
                if p!("ge", running, zero) {
                    running
                } else {
                    find_index!(queue, "statsPlan", *stats)
                }
            );
            let queue_start = c!(
                "max",
                zero,
                c!(
                    "min",
                    active,
                    c!(
                        "subtract",
                        g!(queue, "length"),
                        c!("max", one, c!("subtract", plan_rows, two))
                    )
                )
            );
            if p!("gt", queue_start, zero) {
                let first = c!("at", queue, queue_start);
                let parent = if p!("same", o!(first, "kind"), l!("message")) {
                    find!(plans, "afterPlan", first)
                } else {
                    undefined
                };
                let current = row;
                row = c!("add", row, one);
                r!(
                    "put",
                    *buffer,
                    *rect,
                    current,
                    if p!("truthy", parent) {
                        text!(l!("↑ After "), r!("basename", g!(parent, "path")))
                    } else {
                        text!(l!("↑ "), queue_start, l!(" earlier"))
                    },
                    g!(theme, "muted")
                );
            }
            let mut queue_index = queue_start;
            while p!("lt", queue_index, g!(queue, "length")) && p!("lt", row, plan_rows) {
                let item = c!("at", queue, queue_index);
                let number = if p!("same", g!(item, "kind"), l!("plan")) {
                    c!("add", find_index!(plans, "sameId", item), one)
                } else {
                    undefined
                };
                let text = if p!("same", g!(item, "kind"), l!("plan")) {
                    text!(number, l!(". "), r!("basename", g!(item, "path")))
                } else {
                    text!(l!("  └ "), g!(item, "text"))
                };
                let current = row;
                row = c!("add", row, one);
                r!(
                    "put",
                    *buffer,
                    *rect,
                    current,
                    text!(r!("marker", g!(item, "status")), l!(" "), text),
                    r!("tone", g!(item, "status"))
                );
                queue_index = c!("add", queue_index, one);
            }
            if p!("lt", queue_index, g!(queue, "length")) {
                let current = row;
                row = c!("add", row, one);
                r!(
                    "put",
                    *buffer,
                    *rect,
                    current,
                    l!("  ↓ more queued work"),
                    g!(theme, "muted")
                );
            }
            row = c!("add", row, one);
            if p!("same", g!(tasks, "length"), zero) {
                let current = row;
                row = c!("add", row, one);
                r!("put", *buffer, *rect, current, l!("TASKS"), c!("bold"));
                r!(
                    "put",
                    *buffer,
                    *rect,
                    row,
                    l!("Waiting for plan details…"),
                    g!(theme, "muted")
                );
                return Ok(undefined);
            }
            let done = g!(filter!(tasks, "completed"), "length");
            let current = row;
            row = c!("add", row, one);
            r!(
                "put",
                *buffer,
                *rect,
                current,
                text!(l!("TASKS · "), done, l!("/"), g!(tasks, "length")),
                c!("bold")
            );
            let active = find_index!(tasks, "statsTask", *stats);
            let pending = find_index!(tasks, "pendingTask");
            let focus = if p!("ge", active, zero) {
                active
            } else {
                c!("max", zero, pending)
            };
            let capacity = c!(
                "max",
                one,
                c!("subtract", c!("subtract", g!(*rect, "height"), row), one)
            );
            let start = c!(
                "max",
                zero,
                c!(
                    "min",
                    c!("subtract", focus, one),
                    c!("subtract", g!(tasks, "length"), capacity)
                )
            );
            if p!("gt", start, zero) {
                let current = row;
                row = c!("add", row, one);
                r!(
                    "put",
                    *buffer,
                    *rect,
                    current,
                    text!(l!("  ↑ "), start, l!(" earlier tasks")),
                    g!(theme, "muted")
                );
            }
            let mut index = start;
            while p!("lt", index, g!(tasks, "length")) && p!("lt", row, g!(*rect, "height")) {
                if p!("same", row, c!("subtract", g!(*rect, "height"), one))
                    && p!("lt", index, c!("subtract", g!(tasks, "length"), one))
                {
                    r!(
                        "put",
                        *buffer,
                        *rect,
                        row,
                        l!("  ↓ more tasks · v View all"),
                        g!(theme, "muted")
                    );
                    break;
                }
                let task = c!("at", tasks, index);
                let is_active = p!(
                    "same",
                    g!(task, "id"),
                    o!(g!(*stats, "run"), "activeTaskId")
                );
                let status = if is_active && p!("same", g!(*stats, "status"), l!("running")) {
                    l!("running")
                } else {
                    g!(task, "status")
                };
                let current = row;
                row = c!("add", row, one);
                r!(
                    "put",
                    *buffer,
                    *rect,
                    current,
                    text!(
                        r!("marker", status),
                        l!(" "),
                        c!("add", index, one),
                        l!(". "),
                        g!(task, "title")
                    ),
                    r!("tone", status)
                );
                if is_active
                    && p!("truthy", g!(task, "steps"))
                    && p!(
                        "lt",
                        row,
                        c!(
                            "subtract",
                            g!(*rect, "height"),
                            if p!("lt", index, c!("subtract", g!(tasks, "length"), one)) {
                                one
                            } else {
                                zero
                            }
                        )
                    )
                {
                    let steps = c!(
                        "join",
                        c!("map", g!(task, "steps"), l!("panelStep"), *stats),
                        l!("  ")
                    );
                    let current = row;
                    row = c!("add", row, one);
                    r!(
                        "put",
                        *buffer,
                        *rect,
                        current,
                        text!(l!("  "), steps),
                        g!(theme, "muted")
                    );
                }
                index = c!("add", index, one);
            }
        }
        _ => return host.call("invalidOperation", vec![]),
    }
    Ok(undefined)
}
