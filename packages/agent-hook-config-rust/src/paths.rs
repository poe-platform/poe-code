//! Scope/home decisions are portable; adapters execute these plans with platform paths.
use crate::{Config, u};
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scope {
    Global,
    Local,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PathPlan {
    Resolve(Vec<u16>),
    Join { directory: Vec<u16>, path: Vec<u16> },
    ResolveFrom { directory: Vec<u16>, path: Vec<u16> },
}
pub fn plan_hook_path(
    config: &Config,
    scope: Scope,
    cwd: &[u16],
    home: &[u16],
) -> Option<PathPlan> {
    if scope == Scope::Local {
        return config
            .local_path
            .as_ref()
            .filter(|path| !path.is_empty())
            .map(|path| PathPlan::ResolveFrom {
                directory: cwd.to_vec(),
                path: path.clone(),
            });
    }
    let path = &config.global_path;
    if path.first() != Some(&126) {
        return Some(PathPlan::Resolve(path.clone()));
    }
    let adjusted = if path.starts_with(&u("~./")) {
        let mut output = u("~/.");
        output.extend(&path[3..]);
        output
    } else {
        path.clone()
    };
    let mut remainder = &adjusted[1..];
    if matches!(remainder.first(), Some(47 | 92)) {
        remainder = &remainder[1..];
    } else if remainder.first() == Some(&46) {
        remainder = &remainder[1..];
        if matches!(remainder.first(), Some(47 | 92)) {
            remainder = &remainder[1..];
        }
    }
    Some(if remainder.is_empty() {
        PathPlan::Resolve(home.to_vec())
    } else {
        PathPlan::Join {
            directory: home.to_vec(),
            path: remainder.to_vec(),
        }
    })
}
