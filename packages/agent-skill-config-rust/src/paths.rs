//! Scope and home expansion decisions; hosts execute platform path primitives.
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
    From { directory: Vec<u16>, path: Vec<u16> },
}
pub fn plan_skill_dir(config: &Config, scope: Scope, cwd: &[u16], home: &[u16]) -> PathPlan {
    if scope == Scope::Local {
        return PathPlan::From {
            directory: cwd.to_vec(),
            path: config.local_dir.clone(),
        };
    }
    let path = &config.global_dir;
    if path.first() != Some(&126) {
        return PathPlan::Resolve(path.clone());
    }
    let adjusted = if path.starts_with(&u("~./")) {
        [u("~/."), path[3..].to_vec()].concat()
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
    if remainder.is_empty() {
        PathPlan::Resolve(home.to_vec())
    } else {
        PathPlan::Join {
            directory: home.to_vec(),
            path: remainder.to_vec(),
        }
    }
}
