//! Configuration/install preflight policies, independent of the host filesystem.
use crate::{Catalog, SupportStatus, u};
use mcp_protocol_rust::{json::Value, strings::trim_ecmascript};
#[derive(Clone, Debug, PartialEq)]
pub enum Operation {
    Configure,
    Unconfigure,
    Install { name: Vec<u16>, content: Vec<u16> },
}
pub struct Options {
    pub cwd: Vec<u16>,
    pub home: Vec<u16>,
    pub global: Option<bool>,
    pub force: bool,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Plan {
    pub home: Vec<u16>,
    pub mutations: Vec<Value>,
    pub template: Option<Vec<u16>>,
    pub result: Option<Value>,
}
#[derive(Clone, Debug, PartialEq)]
pub enum Request {
    Stat(Vec<u16>),
    Read(Vec<u16>),
    Template(Vec<u16>),
    Done(Plan),
}
pub enum Response {
    Exists(bool),
    Content(Vec<u16>),
    Template(Vec<u16>),
}
#[derive(Debug)]
pub struct Error {
    pub message: Vec<u16>,
    pub user: bool,
    pub unsupported: bool,
}
impl Error {
    fn plain(message: Vec<u16>) -> Self {
        Self {
            message,
            user: false,
            unsupported: false,
        }
    }
}
#[derive(Clone, Copy, PartialEq)]
enum Stage {
    Ready,
    Stat,
    Read,
    Template,
    Done,
}
pub struct Machine {
    operation: Operation,
    force: bool,
    directory: Vec<u16>,
    display_directory: Vec<u16>,
    home: Vec<u16>,
    target: Vec<u16>,
    display_target: Vec<u16>,
    absolute_target: Vec<u16>,
    stage: Stage,
    existing: Vec<u16>,
}
fn concat(parts: &[&[u16]]) -> Vec<u16> {
    parts.concat()
}
fn mutation(kind: &str, fields: Vec<(&str, Vec<u16>)>) -> Value {
    Value::Object(
        std::iter::once((u("kind"), Value::String(u(kind))))
            .chain(
                fields
                    .into_iter()
                    .map(|(key, value)| (u(key), Value::String(value))),
            )
            .collect(),
    )
}
impl Machine {
    pub fn new(
        catalog: &Catalog,
        agent: &[u16],
        operation: Operation,
        options: Options,
    ) -> Result<Self, Error> {
        let support = catalog.resolve(agent);
        if support.status != SupportStatus::Supported {
            return Err(Error {
                message: concat(&[&u("Unsupported agent: "), agent]),
                user: false,
                unsupported: true,
            });
        }
        let config = support.config.expect("supported skill config");
        if let Operation::Install { name, .. } = &operation
            && (name.is_empty()
                || name != trim_ecmascript(name)
                || name == &u(".")
                || name == &u("..")
                || name.iter().any(|unit| [47, 92, 10, 13].contains(unit)))
        {
            return Err(Error::plain(concat(&[&u("Invalid skill name: "), name])));
        }
        let global = options
            .global
            .unwrap_or(!matches!(operation, Operation::Install { .. }));
        let (directory, display_directory, home) = if global {
            (
                config.global_dir.clone(),
                config.global_dir.clone(),
                options.home,
            )
        } else {
            let local = &config.local_dir;
            let relative = if local.starts_with(&u("~/")) || local == &u("~") {
                local.clone()
            } else {
                concat(&[
                    &u("~/"),
                    if local.starts_with(&u("./")) {
                        &local[2..]
                    } else {
                        local
                    },
                ])
            };
            (relative, local.clone(), options.cwd)
        };
        let suffix = match &operation {
            Operation::Install { name, .. } => concat(&[&u("/"), name, &u("/SKILL.md")]),
            _ => u("/poe-generate.md"),
        };
        let target = concat(&[&directory, &suffix]);
        let display_target = concat(&[&display_directory, &suffix]);
        let absolute_target = concat(&[&home, &u("/"), &target[2.min(target.len())..]]);
        Ok(Self {
            operation,
            force: options.force,
            directory,
            display_directory,
            home,
            target,
            display_target,
            absolute_target,
            stage: Stage::Ready,
            existing: vec![],
        })
    }
    pub fn start(&mut self) -> Result<Request, Error> {
        if self.stage != Stage::Ready {
            return Err(Error::plain(u("Skill preflight already started")));
        }
        if matches!(self.operation, Operation::Install { .. }) && self.force {
            self.stage = Stage::Done;
            return Ok(Request::Done(self.plan(true)));
        }
        self.stage = Stage::Stat;
        Ok(Request::Stat(self.absolute_target.clone()))
    }
    pub fn respond(&mut self, response: Response) -> Result<Request, Error> {
        match (self.stage, response) {
            (Stage::Stat, Response::Exists(false)) => {
                self.stage = Stage::Done;
                Ok(Request::Done(self.plan(false)))
            }
            (Stage::Stat, Response::Exists(true)) => {
                if matches!(self.operation, Operation::Install { .. }) {
                    return Err(Error {
                        message: concat(&[
                            &u("Skill already exists: "),
                            &self.display_target,
                            &u("\nRe-run with --force to overwrite it, or remove it first."),
                        ]),
                        user: true,
                        unsupported: false,
                    });
                }
                self.stage = Stage::Read;
                Ok(Request::Read(self.absolute_target.clone()))
            }
            (Stage::Read, Response::Content(content)) => {
                if self.operation == Operation::Unconfigure && self.force {
                    self.stage = Stage::Done;
                    return Ok(Request::Done(self.plan(true)));
                }
                self.existing = content;
                self.stage = Stage::Template;
                Ok(Request::Template(u("poe-generate.md")))
            }
            (Stage::Template, Response::Template(expected)) => {
                let matches = self.existing == expected;
                if self.operation == Operation::Configure && !matches {
                    return Err(Error {
                        message: concat(&[
                            &u(
                                "Skill already exists and differs from the bundled poe-generate.md: ",
                            ),
                            &self.absolute_target,
                            &u(
                                "\nMove or delete it, then re-run this command to install the poe-code version.",
                            ),
                        ]),
                        user: true,
                        unsupported: false,
                    });
                }
                self.stage = Stage::Done;
                Ok(Request::Done(self.plan(matches || self.force)))
            }
            _ => Err(Error::plain(u("Unexpected skill preflight response"))),
        }
    }
    fn plan(&self, remove: bool) -> Plan {
        let (mutations, template, result) = match &self.operation {
            Operation::Configure => (
                vec![
                    mutation(
                        "ensureDirectory",
                        vec![
                            ("path", self.directory.clone()),
                            ("label", concat(&[&u("Ensure directory "), &self.directory])),
                        ],
                    ),
                    mutation(
                        "templateWrite",
                        vec![
                            ("target", self.target.clone()),
                            ("templateId", u("poe-generate.md")),
                            (
                                "label",
                                concat(&[
                                    &u("Write bundled skill poe-generate.md to "),
                                    &self.directory,
                                ]),
                            ),
                        ],
                    ),
                ],
                None,
                None,
            ),
            Operation::Unconfigure => {
                let mut mutations = vec![];
                if remove {
                    mutations.push(mutation(
                        "removeFile",
                        vec![
                            ("target", self.target.clone()),
                            (
                                "label",
                                concat(&[
                                    &u("Remove bundled skill poe-generate.md from "),
                                    &self.display_directory,
                                ]),
                            ),
                        ],
                    ));
                }
                mutations.push(mutation(
                    "removeDirectory",
                    vec![
                        ("path", self.directory.clone()),
                        (
                            "label",
                            concat(&[
                                &u("Remove empty skills directory "),
                                &self.display_directory,
                            ]),
                        ),
                    ],
                ));
                (mutations, None, None)
            }
            Operation::Install { name, content } => {
                let folder = concat(&[&self.directory, &u("/"), name]);
                (
                    vec![
                        mutation(
                            "ensureDirectory",
                            vec![
                                ("path", folder),
                                ("label", concat(&[&u("Ensure skill directory "), name])),
                            ],
                        ),
                        mutation(
                            "templateWrite",
                            vec![
                                ("target", self.target.clone()),
                                ("templateId", u("__skill_content__")),
                                ("label", concat(&[&u("Write skill "), name])),
                            ],
                        ),
                    ],
                    Some(content.clone()),
                    Some(Value::Object(vec![
                        (u("skillPath"), Value::String(self.absolute_target.clone())),
                        (u("displayPath"), Value::String(self.display_target.clone())),
                    ])),
                )
            }
        };
        Plan {
            home: self.home.clone(),
            mutations,
            template,
            result,
        }
    }
}
