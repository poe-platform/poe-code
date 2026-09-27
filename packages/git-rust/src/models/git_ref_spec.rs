#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitRefSpec {
    pub remote_path: String,
    pub local_path: String,
    pub force: bool,
    pub match_prefix: bool,
}

impl GitRefSpec {
    pub fn from(refspec: &str) -> Option<Self> {
        let (force, rest) = if let Some(stripped) = refspec.strip_prefix('+') {
            (true, stripped)
        } else {
            (false, refspec)
        };
        let (remote_raw, local_raw) = match rest.find(':') {
            Some(colon) => (&rest[..colon], &rest[colon + 1..]),
            None => (rest, rest),
        };
        let remote_star = remote_raw.ends_with('*');
        let local_star = local_raw.ends_with('*');
        if remote_star != local_star {
            return None;
        }
        let remote_path = remote_raw.strip_suffix('*').unwrap_or(remote_raw).to_string();
        let local_path = local_raw.strip_suffix('*').unwrap_or(local_raw).to_string();
        Some(Self {
            remote_path,
            local_path,
            force,
            match_prefix: remote_star,
        })
    }

    pub fn translate(&self, remote_branch: &str) -> Option<String> {
        if self.match_prefix {
            if let Some(suffix) = remote_branch.strip_prefix(&self.remote_path) {
                return Some(format!("{}{suffix}", self.local_path));
            }
        } else if remote_branch == self.remote_path {
            return Some(self.local_path.clone());
        }
        None
    }

    pub fn reverse_translate(&self, local_branch: &str) -> Option<String> {
        if self.match_prefix {
            if let Some(suffix) = local_branch.strip_prefix(&self.local_path) {
                return Some(format!("{}{suffix}", self.remote_path));
            }
        } else if local_branch == self.local_path {
            return Some(self.remote_path.clone());
        }
        None
    }
}

#[derive(Debug, Clone, Default)]
pub struct GitRefSpecSet {
    pub rules: Vec<GitRefSpec>,
}

impl GitRefSpecSet {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from(specs: &[&str]) -> Self {
        let mut set = Self::new();
        for s in specs {
            set.add(s);
        }
        set
    }

    pub fn add(&mut self, spec: &str) {
        if let Some(rule) = GitRefSpec::from(spec) {
            self.rules.push(rule);
        }
    }

    pub fn translate(&self, remote_refs: &[&str]) -> Vec<(String, String)> {
        let mut out = Vec::new();
        for rule in &self.rules {
            for &r in remote_refs {
                if let Some(local) = rule.translate(r) {
                    out.push((r.to_string(), local));
                }
            }
        }
        out
    }

    pub fn translate_one(&self, remote_ref: &str) -> Option<String> {
        let mut result = None;
        for rule in &self.rules {
            if let Some(local) = rule.translate(remote_ref) {
                result = Some(local);
            }
        }
        result
    }

    pub fn local_names(&self, remote_refs: &[&str]) -> Vec<String> {
        self.translate(remote_refs)
            .into_iter()
            .map(|(_, local)| local)
            .collect()
    }
}
