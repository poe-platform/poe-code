//! Ordered project/user skill lookup with exact UTF16 names and alias admission.
use crate::{
    Catalog, SupportStatus,
    paths::{self, PathPlan, Scope},
    u,
};
use mcp_protocol_rust::strings::trim_ecmascript;
#[derive(Clone, Debug, PartialEq)]
pub enum Resolution {
    Malformed {
        reference: Vec<u16>,
    },
    UnknownAgent {
        reference: Vec<u16>,
        agent_input: Vec<u16>,
    },
    NotFound {
        reference: Vec<u16>,
        searched_paths: Vec<Vec<u16>>,
    },
    Resolved {
        reference: Vec<u16>,
        name: Vec<u16>,
        source_agent_id: Option<Vec<u16>>,
        source_path: Vec<u16>,
        scope: Scope,
    },
}
#[derive(Debug, PartialEq)]
pub enum StatError<E> {
    NoEntry(E),
    Other(E),
}
pub trait Host {
    type Error;
    fn resolve(&mut self, parts: &[&[u16]]) -> std::result::Result<Vec<u16>, Self::Error>;
    fn join(
        &mut self,
        directory: &[u16],
        path: &[u16],
    ) -> std::result::Result<Vec<u16>, Self::Error>;
    fn is_directory(&mut self, path: &[u16]) -> std::result::Result<bool, StatError<Self::Error>>;
}
fn malformed(segment: &[u16]) -> bool {
    segment.is_empty()
        || segment != trim_ecmascript(segment)
        || segment == [46]
        || segment == [46, 46]
        || segment.contains(&10)
        || segment.contains(&13)
}
pub(crate) fn execute<H: Host>(
    plan: PathPlan,
    host: &mut H,
) -> std::result::Result<Vec<u16>, H::Error> {
    match plan {
        PathPlan::Resolve(path) => host.resolve(&[&path]),
        PathPlan::Join { directory, path } => host
            .join(&directory, &path)
            .and_then(|path| host.resolve(&[&path])),
        PathPlan::From { directory, path } => host.resolve(&[&directory, &path]),
    }
}
pub fn resolve_skill_reference<H: Host>(
    catalog: &Catalog,
    reference: &[u16],
    cwd: &[u16],
    home: &[u16],
    host: &mut H,
) -> std::result::Result<Resolution, H::Error> {
    let bad = || Resolution::Malformed {
        reference: reference.to_vec(),
    };
    let split = reference.iter().position(|unit| *unit == 47);
    if reference.is_empty()
        || reference != trim_ecmascript(reference)
        || split.is_some_and(|split| reference[split + 1..].contains(&47))
    {
        return Ok(bad());
    }
    let (name, id, tiers) = if let Some(split) = split {
        let agent = &reference[..split];
        let name = &reference[split + 1..];
        if malformed(agent) || malformed(name) {
            return Ok(bad());
        }
        let support = catalog.resolve(agent);
        if support.status != SupportStatus::Supported {
            return Ok(Resolution::UnknownAgent {
                reference: reference.to_vec(),
                agent_input: agent.to_vec(),
            });
        }
        let config = support.config.unwrap();
        let project = execute(paths::plan_skill_dir(config, Scope::Local, cwd, home), host)?;
        let project = host.resolve(&[&project, name])?;
        let user = execute(
            paths::plan_skill_dir(config, Scope::Global, cwd, home),
            host,
        )?;
        let user = host.resolve(&[&user, name])?;
        (
            name,
            support.id,
            vec![(Scope::Local, project), (Scope::Global, user)],
        )
    } else {
        if malformed(reference) {
            return Ok(bad());
        }
        let project = host.resolve(&[cwd, &u(".poe-code/skills"), reference])?;
        let user = host.resolve(&[home, &u(".poe-code/skills"), reference])?;
        (
            reference,
            None,
            vec![(Scope::Local, project), (Scope::Global, user)],
        )
    };
    for (scope, path) in &tiers {
        match host.is_directory(path) {
            Ok(true) => {
                return Ok(Resolution::Resolved {
                    reference: reference.to_vec(),
                    name: name.to_vec(),
                    source_agent_id: id,
                    source_path: path.clone(),
                    scope: *scope,
                });
            }
            Ok(false) | Err(StatError::NoEntry(_)) => {}
            Err(StatError::Other(error)) => return Err(error),
        }
    }
    Ok(Resolution::NotFound {
        reference: reference.to_vec(),
        searched_paths: tiers.into_iter().map(|(_, path)| path).collect(),
    })
}
