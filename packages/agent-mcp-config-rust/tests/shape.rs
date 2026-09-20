use agent_mcp_config_rust::shape::{FieldMode, Request, Response, Shape, Style, Transition, Value};
fn run(
    style: Style,
    enabled: bool,
    stdio: bool,
    args: bool,
    env: bool,
    headers: bool,
) -> Vec<Request> {
    let mut shape = Shape::new(style);
    let mut requests = vec![];
    loop {
        let request = shape.request();
        requests.push(request.clone());
        let response = match request {
            Request::Enabled => Response::Flag(enabled),
            Request::Transport => Response::Flag(stdio),
            Request::ArgsCheck { .. } => Response::Flag(args),
            Request::EnvCheck { .. } => Response::Flag(env),
            Request::HeadersCheck => Response::Flag(headers),
            Request::Command { .. }
            | Request::Args { .. }
            | Request::Env { .. }
            | Request::Url
            | Request::Headers
            | Request::Spread { .. } => Response::Value(7),
            Request::Done(_) => break,
            _ => Response::Unit,
        };
        shape.respond(response).unwrap();
    }
    requests
}
#[test]
fn disabled_shapes_keep_distinct_sdk_access_order() {
    assert_eq!(
        run(Style::Goose, false, true, false, false, false),
        [Request::Enabled, Request::Done(false)]
    );
    assert_eq!(
        run(Style::Standard, false, true, false, false, false),
        [
            Request::Enabled,
            Request::Transport,
            Request::Cache,
            Request::Done(false)
        ]
    );
    assert_eq!(
        run(Style::Standard, false, false, false, false, false),
        [Request::Enabled, Request::Transport, Request::Done(false)]
    );
    assert!(
        run(Style::Opencode, false, true, false, false, false).contains(&Request::Emit {
            key: "enabled",
            value: Value::Bool(false),
            mode: FieldMode::Literal
        })
    );
}
#[test]
fn stdio_assignments_happen_before_later_optional_field_admission() {
    let requests = run(Style::Standard, true, true, true, true, false);
    let args = requests
        .iter()
        .position(|request| {
            matches!(
                request,
                Request::Emit {
                    key: "args",
                    mode: FieldMode::Assign,
                    ..
                }
            )
        })
        .unwrap();
    let env = requests
        .iter()
        .position(|request| matches!(request, Request::EnvCheck { .. }))
        .unwrap();
    assert!(args < env);
    assert!(requests.contains(&Request::Command { cached: true }));
    assert!(
        run(Style::Goose, true, true, false, false, false)
            .contains(&Request::Command { cached: false })
    );
}
#[test]
fn opencode_checks_args_before_command_and_headers_use_correct_assignment_mode() {
    let requests = run(Style::Opencode, true, true, true, true, false);
    let args = requests
        .iter()
        .position(|request| matches!(request, Request::ArgsCheck { .. }))
        .unwrap();
    let command = requests
        .iter()
        .position(|request| matches!(request, Request::Command { .. }))
        .unwrap();
    assert!(args < command);
    assert!(requests.contains(&Request::Spread { args: true }));
    for (style, mode) in [
        (Style::Standard, FieldMode::Literal),
        (Style::Opencode, FieldMode::Literal),
        (Style::Goose, FieldMode::Assign),
    ] {
        assert!(
            run(style, true, false, false, false, true).contains(&Request::Emit {
                key: "headers",
                value: Value::Reference(7),
                mode
            })
        );
    }
}
#[test]
fn wrong_response_and_terminal_response_leave_machine_unchanged() {
    let mut shape = Shape::new(Style::Goose);
    assert!(shape.respond(Response::Unit).is_err());
    assert_eq!(shape.request(), Request::Enabled);
    shape.respond(Response::Flag(false)).unwrap();
    assert!(shape.respond(Response::Unit).is_err());
    assert_eq!(shape.request(), Request::Done(false));
}
#[test]
fn compiled_policy_preserves_every_shape_capability_trace() {
    for style in [Style::Standard, Style::Opencode, Style::Goose] {
        let states = Shape::policy(style);
        assert!(states.len() < 128);
        for bits in 0..32 {
            let flags = [0, 1, 2, 3, 4].map(|bit| bits & (1 << bit) != 0);
            let mut index = 0;
            let mut trace = vec![];
            loop {
                let state = &states[index];
                let mut request = state.request.clone();
                if let Request::Emit {
                    value: Value::Reference(reference),
                    ..
                } = &mut request
                {
                    *reference = 7;
                }
                trace.push(request.clone());
                index = match state.transition {
                    Transition::Terminal => break,
                    Transition::Advance(next) => next,
                    Transition::Flag { yes, no } => {
                        let accepted = match request {
                            Request::Enabled => flags[0],
                            Request::Transport => flags[1],
                            Request::ArgsCheck { .. } => flags[2],
                            Request::EnvCheck { .. } => flags[3],
                            Request::HeadersCheck => flags[4],
                            _ => panic!("Wrong flag request"),
                        };
                        if accepted { yes } else { no }
                    }
                };
            }
            assert_eq!(
                trace,
                run(style, flags[0], flags[1], flags[2], flags[3], flags[4])
            );
        }
    }
}
