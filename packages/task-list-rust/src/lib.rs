//! Dependency-free state machines with exact UTF-16 task identities.
use std::collections::{HashSet, VecDeque};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Event {
    pub name: Vec<u16>,
    /// None denotes a wildcard source, which excludes the target itself.
    pub from: Option<Vec<Vec<u16>>>,
    pub to: Vec<u16>,
}
impl Event {
    pub fn can_fire(&self, state: &[u16]) -> bool {
        can_fire(self.from.as_deref(), &self.to, state)
    }
}
pub fn can_fire(from: Option<&[Vec<u16>]>, to: &[u16], state: &[u16]) -> bool {
    from.map_or_else(|| to != state, |states| states.iter().any(|s| s == state))
}
#[derive(Clone, Debug)]
pub struct Machine {
    pub initial: Vec<u16>,
    pub states: Vec<Vec<u16>>,
    pub events: Vec<Event>,
}
impl Machine {
    pub fn validate(&self) -> Result<(), String> {
        if self.states.iter().any(|s| !visible_name(s)) {
            return Err("State names must not be empty.".into());
        }
        let states: HashSet<&[u16]> = self.states.iter().map(Vec::as_slice).collect();
        if !states.contains(self.initial.as_slice()) {
            return Err(format!(
                "Initial state \"{}\" is not declared.",
                String::from_utf16_lossy(&self.initial)
            ));
        }
        for event in &self.events {
            if !visible_name(&event.name) {
                return Err("Event names must not be empty.".into());
            }
            let name = String::from_utf16_lossy(&event.name);
            if !states.contains(event.to.as_slice()) {
                return Err(format!(
                    "Event \"{name}\" references unknown target state \"{}\".",
                    String::from_utf16_lossy(&event.to)
                ));
            }
            if let Some(from) = &event.from {
                for state in from {
                    if !states.contains(state.as_slice()) {
                        return Err(format!(
                            "Event \"{name}\" references unknown source state \"{}\".",
                            String::from_utf16_lossy(state)
                        ));
                    }
                }
            }
        }
        Ok(())
    }
    pub fn events_from(&self, state: &[u16]) -> Vec<usize> {
        self.events
            .iter()
            .enumerate()
            .filter_map(|(i, e)| e.can_fire(state).then_some(i))
            .collect()
    }
    pub fn find_event(&self, state: &[u16], name: &[u16]) -> Option<usize> {
        self.events
            .iter()
            .position(|e| e.name == name && e.can_fire(state))
    }
    pub fn can_transition(&self, from: &[u16], to: &[u16], legacy: bool) -> bool {
        if self.events.iter().any(|e| e.to == to && e.can_fire(from)) {
            return true;
        }
        if !legacy {
            return false;
        }
        let terminal = self
            .events
            .iter()
            .find(|e| e.name == "archive".encode_utf16().collect::<Vec<_>>())
            .map(|e| e.to.as_slice());
        let active: Vec<_> = self
            .states
            .iter()
            .filter(|s| Some(s.as_slice()) != terminal)
            .collect();
        active
            .windows(2)
            .any(|pair| pair[1].as_slice() == from && pair[0].as_slice() == to)
    }
    /// Event indices on the first shortest reachable path; guards are host effects.
    pub fn path(&self, from: &[u16], to: &[u16]) -> Option<Vec<usize>> {
        let mut seen = HashSet::from([from.to_vec()]);
        let mut queue = VecDeque::from([(from.to_vec(), Vec::new())]);
        while let Some((state, path)) = queue.pop_front() {
            if state == to {
                return Some(path);
            }
            for (index, event) in self.events.iter().enumerate() {
                if event.can_fire(&state) && seen.insert(event.to.clone()) {
                    let mut next = path.clone();
                    next.push(index);
                    queue.push_back((event.to.clone(), next));
                }
            }
        }
        None
    }
}
fn whitespace(unit: u16) -> bool {
    matches!(unit,0x0009..=0x000d|0x0020|0x00a0|0x1680|0x2000..=0x200a|0x2028|0x2029|0x202f|0x205f|0x3000|0xfeff)
}
pub fn visible_name(value: &[u16]) -> bool {
    value.iter().any(|u| !whitespace(*u))
}
pub fn printable_identifier(value: &[u16]) -> bool {
    !value.is_empty()
        && !whitespace(value[0])
        && !whitespace(value[value.len() - 1])
        && !value.iter().any(|u| *u < 32 || *u == 127)
}
pub fn task_id(value: &[u16]) -> bool {
    printable_identifier(value)
        && value[0] != 46
        && !value.iter().any(|u| *u == 47 || *u == 92)
        && !value.windows(2).any(|p| p == [46, 46])
}
pub mod markdown;
