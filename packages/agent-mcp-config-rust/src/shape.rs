//! Shape policy requests retain foreign host values as opaque references.
use std::collections::VecDeque;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Style {
    Standard,
    Opencode,
    Goose,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FieldMode {
    Literal,
    Assign,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Value {
    Reference(u32),
    String(&'static str),
    Bool(bool),
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Request {
    Enabled,
    Transport,
    Cache,
    Command {
        cached: bool,
    },
    ArgsCheck {
        cached: bool,
    },
    Args {
        cached: bool,
    },
    Spread {
        args: bool,
    },
    EnvCheck {
        cached: bool,
    },
    Env {
        cached: bool,
    },
    Url,
    HeadersCheck,
    Headers,
    Emit {
        key: &'static str,
        value: Value,
        mode: FieldMode,
    },
    Done(bool),
}
pub enum Response {
    Flag(bool),
    Value(u32),
    Unit,
}
#[derive(Clone, PartialEq, Eq)]
pub struct Shape {
    style: Style,
    enabled: bool,
    args: bool,
    current: Request,
    pending: VecDeque<Request>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Transition {
    Flag { yes: usize, no: usize },
    Advance(usize),
    Terminal,
}
pub struct PolicyState {
    pub request: Request,
    pub transition: Transition,
}
impl Shape {
    /// Compile the finite Rust machine into a host-readable capability graph.
    /// Value requests use the current host value register (reference zero).
    pub fn policy(style: Style) -> Vec<PolicyState> {
        fn intern(states: &mut Vec<Shape>, state: Shape) -> usize {
            if let Some(index) = states.iter().position(|existing| *existing == state) {
                index
            } else {
                let index = states.len();
                states.push(state);
                index
            }
        }
        let mut machines = vec![Self::new(style)];
        let mut output = vec![];
        while output.len() < machines.len() {
            let machine = machines[output.len()].clone();
            let request = machine.request();
            let transition = match request {
                Request::Done(_) => Transition::Terminal,
                Request::Enabled
                | Request::Transport
                | Request::ArgsCheck { .. }
                | Request::EnvCheck { .. }
                | Request::HeadersCheck => {
                    let mut yes = machine.clone();
                    yes.respond(Response::Flag(true))
                        .expect("Valid policy flag");
                    let mut no = machine;
                    no.respond(Response::Flag(false))
                        .expect("Valid policy flag");
                    Transition::Flag {
                        yes: intern(&mut machines, yes),
                        no: intern(&mut machines, no),
                    }
                }
                _ => {
                    let response = match request {
                        Request::Command { .. }
                        | Request::Args { .. }
                        | Request::Spread { .. }
                        | Request::Env { .. }
                        | Request::Url
                        | Request::Headers => Response::Value(0),
                        _ => Response::Unit,
                    };
                    let mut next = machine;
                    next.respond(response).expect("Valid policy response");
                    Transition::Advance(intern(&mut machines, next))
                }
            };
            output.push(PolicyState {
                request,
                transition,
            });
        }
        output
    }
    pub fn new(style: Style) -> Self {
        Self {
            style,
            enabled: true,
            args: false,
            current: Request::Enabled,
            pending: VecDeque::new(),
        }
    }
    pub fn request(&self) -> Request {
        self.current.clone()
    }
    fn cached(&self) -> bool {
        self.style != Style::Goose
    }
    fn emit(&mut self, key: &'static str, value: Value, mode: FieldMode) {
        self.pending.push_back(Request::Emit { key, value, mode });
    }
    fn literal(&mut self, key: &'static str, value: &'static str) {
        self.emit(key, Value::String(value), FieldMode::Literal);
    }
    pub fn respond(&mut self, response: Response) -> Result<(), &'static str> {
        let cached = self.cached();
        match (&self.current, &response) {
            (Request::Enabled, Response::Flag(flag)) => {
                self.enabled = *flag;
                self.pending
                    .push_back(if self.style == Style::Goose && !flag {
                        Request::Done(false)
                    } else {
                        Request::Transport
                    });
            }
            (Request::Transport, Response::Flag(stdio)) => self.pending.push_back(if *stdio {
                if cached {
                    Request::Cache
                } else {
                    Request::Command { cached }
                }
            } else if self.style == Style::Standard && !self.enabled {
                Request::Done(false)
            } else {
                Request::Url
            }),
            (Request::Cache, Response::Unit) => {
                self.pending
                    .push_back(if self.style == Style::Standard && !self.enabled {
                        Request::Done(false)
                    } else if self.style == Style::Opencode {
                        Request::ArgsCheck { cached }
                    } else {
                        Request::Command { cached }
                    })
            }
            (Request::Command { .. }, Response::Value(reference)) => {
                if self.style == Style::Opencode {
                    self.pending.push_back(Request::Spread { args: self.args });
                } else {
                    if self.style == Style::Goose {
                        self.literal("type", "stdio");
                    }
                    self.emit(
                        if self.style == Style::Goose {
                            "cmd"
                        } else {
                            "command"
                        },
                        Value::Reference(*reference),
                        FieldMode::Literal,
                    );
                    self.pending.push_back(Request::ArgsCheck { cached });
                }
            }
            (Request::ArgsCheck { .. }, Response::Flag(flag)) => {
                self.args = *flag;
                self.pending.push_back(if self.style == Style::Opencode {
                    Request::Command { cached }
                } else if *flag {
                    Request::Args { cached }
                } else {
                    Request::EnvCheck { cached }
                });
            }
            (Request::Args { .. }, Response::Value(reference)) => {
                self.emit("args", Value::Reference(*reference), FieldMode::Assign);
                self.pending.push_back(Request::EnvCheck { cached });
            }
            (Request::Spread { .. }, Response::Value(reference)) => {
                self.literal("type", "local");
                self.emit("command", Value::Reference(*reference), FieldMode::Literal);
                self.emit("enabled", Value::Bool(self.enabled), FieldMode::Literal);
                self.pending.push_back(Request::EnvCheck { cached });
            }
            (Request::EnvCheck { .. }, Response::Flag(flag)) => self.pending.push_back(if *flag {
                Request::Env { cached }
            } else {
                Request::Done(true)
            }),
            (Request::Env { .. }, Response::Value(reference)) => {
                self.emit(
                    if self.style == Style::Goose {
                        "envs"
                    } else {
                        "env"
                    },
                    Value::Reference(*reference),
                    FieldMode::Assign,
                );
                self.pending.push_back(Request::Done(true));
            }
            (Request::Url, Response::Value(reference)) => {
                self.literal(
                    "type",
                    if self.style == Style::Opencode {
                        "remote"
                    } else {
                        "http"
                    },
                );
                self.emit("url", Value::Reference(*reference), FieldMode::Literal);
                if self.style == Style::Opencode {
                    self.emit("enabled", Value::Bool(self.enabled), FieldMode::Literal);
                }
                self.pending.push_back(Request::HeadersCheck);
            }
            (Request::HeadersCheck, Response::Flag(flag)) => self.pending.push_back(if *flag {
                Request::Headers
            } else {
                Request::Done(true)
            }),
            (Request::Headers, Response::Value(reference)) => {
                self.emit(
                    "headers",
                    Value::Reference(*reference),
                    if self.style == Style::Goose {
                        FieldMode::Assign
                    } else {
                        FieldMode::Literal
                    },
                );
                self.pending.push_back(Request::Done(true));
            }
            (Request::Emit { .. }, Response::Unit) => {}
            _ => return Err("Invalid shape response"),
        }
        self.current = self
            .pending
            .pop_front()
            .expect("Shape response schedules continuation");
        Ok(())
    }
}
