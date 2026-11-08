//! Command diagnostics, preserving host observation order around styled text.
pub trait Host {
    type Value: Copy;
    type Error;
    fn get(&mut self, value: Self::Value, key: &str) -> Result<Self::Value, Self::Error>;
    fn call(&mut self, operation: &str, args: Vec<Self::Value>)
    -> Result<Self::Value, Self::Error>;
    fn literal(&mut self, value: &[u16]) -> Result<Self::Value, Self::Error>;
    fn stringify(&mut self, value: Self::Value) -> Result<Vec<u16>, Self::Error>;
    fn is_nullish(&self, value: Self::Value) -> Result<bool, Self::Error>;
    fn is_true(&self, value: Self::Value) -> Result<bool, Self::Error>;
}

fn styled<H: Host>(host: &mut H, style: &str, text: &str) -> Result<Vec<u16>, H::Error> {
    let value = host.literal(&text.encode_utf16().collect::<Vec<_>>())?;
    let value = host.call(style, vec![value])?;
    host.stringify(value)
}

fn message<H: Host>(host: &mut H, input: H::Value) -> Result<(Vec<u16>, Vec<u16>), H::Error> {
    let unknown = host.get(input, "unknownCommand")?;
    let unknown = host.call("flatten", vec![unknown])?;
    let length = host.call("positiveLength", vec![unknown])?;
    let unknown = if host.is_true(length)? {
        unknown
    } else {
        host.literal(&"<command>".encode_utf16().collect::<Vec<_>>())?
    };
    let suggestions = host.get(input, "suggestions")?;
    let suggestions = if host.is_nullish(suggestions)? {
        host.call("array", vec![])?
    } else {
        suggestions
    };
    let length = host.call("positiveLength", vec![suggestions])?;
    let mut did_you_mean = Vec::new();
    if host.is_true(length)? {
        did_you_mean.push(b'\n' as u16);
        did_you_mean.extend(styled(host, "muted", "Did you mean:")?);
        did_you_mean.push(b' ' as u16);
        let comma = host.literal(&", ".encode_utf16().collect::<Vec<_>>())?;
        let joined = host.call("suggestions", vec![suggestions, comma])?;
        did_you_mean.extend(host.stringify(joined)?);
        did_you_mean.extend(styled(host, "muted", "?")?);
    }
    let mut label = styled(host, "bold", "Unknown command:")?;
    label.push(b' ' as u16);
    let command = host.call("command", vec![unknown])?;
    label.extend(host.stringify(command)?);
    label.extend(did_you_mean);

    let mut hint = styled(host, "muted", "Run")?;
    hint.push(b' ' as u16);
    // The host captures text.usageCommand before observing input.helpCommand.
    let usage = host.call("usage", vec![input])?;
    hint.extend(host.stringify(usage)?);
    hint.push(b' ' as u16);
    hint.extend(styled(host, "muted", "for available commands.")?);
    Ok((label, hint))
}

pub fn render<H: Host>(host: &mut H, input: H::Value, panel: bool) -> Result<H::Value, H::Error> {
    let message_input = if panel {
        let unknown = host.get(input, "unknownCommand")?;
        let help = host.get(input, "helpCommand")?;
        let suggestions = host.get(input, "suggestions")?;
        host.call("input", vec![unknown, help, suggestions])?
    } else {
        input
    };
    let (label, hint) = message(host, message_input)?;
    if panel {
        let title = host.get(input, "title")?;
        let title = if host.is_nullish(title)? {
            host.literal(&"command not found".encode_utf16().collect::<Vec<_>>())?
        } else {
            title
        };
        let label = host.literal(&label)?;
        let hint = host.literal(&hint)?;
        host.call("panel", vec![title, label, hint])
    } else {
        let label = host.literal(&label)?;
        let hint = host.literal(&hint)?;
        host.call("message", vec![label, hint])
    }
}
