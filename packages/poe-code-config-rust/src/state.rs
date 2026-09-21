//! Registry validation over lazy foreign properties and array hooks.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Undefined,
    Record,
    String,
    Number,
    Array,
    Other,
}
pub trait Host {
    type Value: Copy;
    type Error;
    fn is_record(&mut self, value: Self::Value) -> Result<bool, Self::Error>;
    fn is_array(&mut self, value: Self::Value) -> Result<bool, Self::Error>;
    fn kind(&mut self, value: Self::Value) -> Result<Kind, Self::Error>;
    fn read(&mut self, value: Self::Value, key: &str) -> Result<Self::Value, Self::Error>;
    fn text(&mut self, value: Self::Value) -> Result<Vec<u16>, Self::Error>;
    fn number(&mut self, value: Self::Value) -> Result<f64, Self::Error>;
    fn all_strings(&mut self, value: Self::Value) -> Result<bool, Self::Error>;
    fn entries(
        &mut self,
        value: Self::Value,
    ) -> Result<crate::document::Entries<Self::Value>, Self::Error>;
}
pub fn safe_job_id(id: &[u16], absolute: bool) -> bool {
    !id.is_empty()
        && id != [46]
        && id != [46, 46]
        && !absolute
        && !id.iter().any(|unit| matches!(unit, 0 | 47 | 92))
}
pub fn job_status(value: &[u16]) -> bool {
    ["pending", "running", "exited", "killed", "lost"]
        .iter()
        .any(|name| value.iter().copied().eq(name.encode_utf16()))
}
pub fn integer_exit_code(value: f64) -> bool {
    value.is_finite() && value.fract() == 0.0
}
fn string_field<H: Host>(host: &mut H, value: H::Value, key: &str) -> Result<bool, H::Error> {
    let field = host.read(value, key)?;
    Ok(host.kind(field)? == Kind::String)
}
fn optional<H: Host>(
    host: &mut H,
    value: H::Value,
    key: &str,
    kind: Kind,
) -> Result<bool, H::Error> {
    let first = host.read(value, key)?;
    if host.kind(first)? == Kind::Undefined {
        return Ok(true);
    }
    let next = host.read(value, key)?;
    if kind == Kind::Record {
        host.is_record(next)
    } else {
        Ok(host.kind(next)? == kind)
    }
}
pub fn valid_job<H: Host>(host: &mut H, value: H::Value) -> Result<bool, H::Error> {
    if !host.is_record(value)? {
        return Ok(false);
    }
    for key in ["id", "env_id", "env_kind", "tool"] {
        if !string_field(host, value, key)? {
            return Ok(false);
        }
    }
    let argv = host.read(value, "argv")?;
    if !host.is_array(argv)? {
        return Ok(false);
    }
    let argv = host.read(value, "argv")?;
    if !host.all_strings(argv)? {
        return Ok(false);
    }
    for key in ["cwd", "started_at"] {
        if !string_field(host, value, key)? {
            return Ok(false);
        }
    }
    let status = host.read(value, "status")?;
    if host.kind(status)? != Kind::String || !job_status(&host.text(status)?) {
        return Ok(false);
    }
    let exit = host.read(value, "exit_code")?;
    if host.kind(exit)? != Kind::Undefined {
        let exit = host.read(value, "exit_code")?;
        if host.kind(exit)? != Kind::Number {
            return Ok(false);
        }
        let exit = host.read(value, "exit_code")?;
        if !integer_exit_code(host.number(exit)?) {
            return Ok(false);
        }
    }
    for key in ["exited_at", "log_file"] {
        if !optional(host, value, key, Kind::String)? {
            return Ok(false);
        }
    }
    optional(host, value, "reattach_context", Kind::Record)
}
pub fn valid_template<H: Host>(host: &mut H, value: H::Value) -> Result<bool, H::Error> {
    if !host.is_record(value)? {
        return Ok(false);
    }
    for key in ["hash", "runtime_type", "dockerfile_path", "built_at"] {
        if !string_field(host, value, key)? {
            return Ok(false);
        }
    }
    for key in ["template_id", "image"] {
        if !optional(host, value, key, Kind::String)? {
            return Ok(false);
        }
    }
    Ok(true)
}
pub fn templates<H: Host>(
    host: &mut H,
    value: H::Value,
) -> Result<crate::document::Entries<H::Value>, H::Error> {
    if !host.is_record(value)? {
        return Ok(vec![]);
    }
    let docker = host.read(value, "docker")?;
    if !host.is_record(docker)? {
        return Ok(vec![]);
    }
    let mut output = vec![];
    for (hash, entry) in host.entries(docker)? {
        if valid_template(host, entry)? {
            let next = host.read(entry, "hash")?;
            if host.kind(next)? == Kind::String && host.text(next)? == hash {
                output.push((hash, entry));
            }
        }
    }
    Ok(output)
}
