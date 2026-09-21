//! Named terminal runtime admission and lookup. Promise/session handles stay with the host.
fn blank(text: &[u16]) -> bool {
    text.iter().all(|c|matches!(*c,9..=13|32|0xa0|0x1680|0x2000..=0x200a|0x2028|0x2029|0x202f|0x205f|0x3000|0xfeff))
}
pub fn command(text: &[u16]) -> Result<(), String> {
    if blank(text) {
        Err("Command must not be empty.".into())
    } else {
        Ok(())
    }
}
pub fn requested(name: Option<&[u16]>) -> Result<(), String> {
    if name.is_some_and(blank) {
        Err("Session name must not be empty.".into())
    } else {
        Ok(())
    }
}
struct Entry {
    name: Vec<u16>,
    id: Vec<u16>,
    active: bool,
}
#[derive(Default)]
pub struct Names {
    entries: Vec<Entry>,
    pending: Vec<Vec<u16>>,
    closing: bool,
}
impl Names {
    pub fn retained(&self) -> bool {
        !self.entries.is_empty() || !self.pending.is_empty()
    }
    pub fn id_for(&self, name: &[u16]) -> Option<Vec<u16>> {
        self.entries
            .iter()
            .find(|e| e.name == name)
            .map(|e| e.id.clone())
    }
    pub fn reserve(
        &mut self,
        cmd: &[u16],
        name: Option<&[u16]>,
    ) -> Result<(Vec<u16>, Option<Vec<u16>>), String> {
        command(cmd)?;
        requested(name)?;
        if self.closing {
            return Err("Terminal runtime is closing.".into());
        }
        let name = if let Some(name) = name {
            name.to_vec()
        } else {
            let mut i = 1usize;
            loop {
                let name = format!("s{i}").encode_utf16().collect::<Vec<_>>();
                if !self.entries.iter().any(|e| e.name == name) && !self.pending.contains(&name) {
                    break name;
                }
                i = i.checked_add(1).ok_or("Session name space exhausted.")?;
            }
        };
        if self.pending.contains(&name) || self.entries.iter().any(|e| e.name == name && e.active) {
            return Err(format!(
                "Session \"{}\" already exists.",
                String::from_utf16_lossy(&name)
            ));
        }
        let replaced = self.id_for(&name);
        self.entries.retain(|e| e.name != name);
        self.pending.push(name.clone());
        Ok((name, replaced))
    }
    pub fn release(&mut self, name: &[u16]) {
        self.pending.retain(|n| n != name);
    }
    pub fn commit(&mut self, name: &[u16], id: Vec<u16>, active: bool) -> Result<(), String> {
        if !self.pending.iter().any(|n| n == name) {
            return Err("Session creation reservation has expired.".into());
        }
        if self.entries.iter().any(|e| e.id == id) {
            return Err("Session ID already exists.".into());
        }
        self.release(name);
        self.entries.push(Entry {
            name: name.to_vec(),
            id,
            active,
        });
        Ok(())
    }
    pub fn set_active(&mut self, id: &[u16], active: bool) {
        if let Some(e) = self.entries.iter_mut().find(|e| e.id == id) {
            e.active = active;
        }
    }
    pub fn synchronize(&mut self, ids: &[Vec<u16>]) {
        for e in &mut self.entries {
            e.active = ids.contains(&e.id);
        }
    }
    pub fn names_for(&self, ids: &[Vec<u16>]) -> Vec<Option<Vec<u16>>> {
        ids.iter()
            .map(|id| {
                self.entries
                    .iter()
                    .find(|e| e.id == *id)
                    .map(|e| e.name.clone())
            })
            .collect()
    }
    pub fn forget(&mut self, name: &[u16], id: &[u16]) {
        self.entries.retain(|e| e.name != name || e.id != id);
    }
    fn available(&self) -> String {
        let names = self
            .entries
            .iter()
            .filter(|e| e.active)
            .map(|e| String::from_utf16_lossy(&e.name))
            .collect::<Vec<_>>();
        if names.is_empty() {
            "No active sessions are available.".into()
        } else {
            format!("Available sessions: {}.", names.join(", "))
        }
    }
    pub fn not_found(&self, name: &[u16]) -> String {
        format!(
            "Session \"{}\" was not found. {}",
            String::from_utf16_lossy(name),
            self.available()
        )
    }
    pub fn resolve(&self, name: Option<&[u16]>) -> Result<(Vec<u16>, Vec<u16>), String> {
        requested(name)?;
        if let Some(name) = name {
            return self
                .entries
                .iter()
                .find(|e| e.name == name)
                .map(|e| (e.name.clone(), e.id.clone()))
                .ok_or_else(|| self.not_found(name));
        }
        let mut active = self.entries.iter().filter(|e| e.active);
        let first = active
            .next()
            .ok_or("No active sessions. Create one with create-session.")?;
        if active.next().is_some() {
            return Err(format!(
                "Multiple active sessions require an explicit session name. Pass --session or set TERMINAL_PILOT_SESSION. {}",
                self.available()
            ));
        }
        Ok((first.name.clone(), first.id.clone()))
    }
    pub fn begin_shutdown(&mut self) {
        self.closing = true;
    }
    pub fn end_shutdown(&mut self, success: bool) {
        self.closing = false;
        if success {
            self.entries = Vec::new();
            self.pending = Vec::new();
        }
    }
    pub fn retained_bytes(&self) -> usize {
        std::mem::size_of::<Self>()
            + self.entries.capacity() * std::mem::size_of::<Entry>()
            + self
                .entries
                .iter()
                .map(|e| (e.name.capacity() + e.id.capacity()) * 2)
                .sum::<usize>()
            + self.pending.capacity() * std::mem::size_of::<Vec<u16>>()
            + self.pending.iter().map(|n| n.capacity() * 2).sum::<usize>()
    }
}
