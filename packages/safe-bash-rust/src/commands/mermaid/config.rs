use mcp_protocol_rust::json::{self, Value};

#[derive(Default)]
pub(in super::super) struct Config {
    pub theme: Option<String>,
    pub background: Option<String>,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub scale: Option<f64>,
    pub rank_gap: Option<f64>,
    pub node_gap: Option<f64>,
    pub padding: Option<f64>,
    pub wrapping_width: Option<f64>,
}

fn js_string(value: &Value) -> String {
    match value {
        Value::String(s) => String::from_utf16_lossy(s),
        Value::Object(_) => "[object Object]".into(),
        Value::Array(items) => items
            .iter()
            .map(|v| {
                if *v == Value::Null {
                    String::new()
                } else {
                    js_string(v)
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        v => json::stringify(v),
    }
}

impl Config {
    pub fn parse(v: &Value, source: bool) -> Result<Self, String> {
        let Value::Object(fields) = v else {
            return Err("Configuration file must contain a JSON object".into());
        };
        for (key, _) in fields {
            let key = String::from_utf16_lossy(key);
            if !source
                && !matches!(
                    key.as_str(),
                    "theme"
                        | "rankGap"
                        | "nodeGap"
                        | "padding"
                        | "width"
                        | "height"
                        | "scale"
                        | "backgroundColor"
                        | "flowchart"
                        | "themeVariables"
                )
            {
                return Err(format!("Unknown configuration key '{key}'"));
            }
        }
        let mut config = Self::default();
        match v.get("theme") {
            None => (),
            Some(Value::String(s)) => {
                let theme = String::from_utf16_lossy(s);
                if !super::super::is_valid_mmdc_theme(&theme) {
                    return Err(format!("Unsupported theme '{theme}' in config file"));
                }
                config.theme = Some(theme);
            }
            Some(t @ Value::Object(pairs)) => {
                for (key, _) in pairs {
                    let key = String::from_utf16_lossy(key);
                    if !matches!(key.as_str(), "mode" | "light" | "dark") {
                        return Err(format!("Unknown theme configuration key '{key}'"));
                    }
                }
                if let Some(mode) = t.get("mode") {
                    let name = js_string(mode);
                    if !matches!(mode, Value::String(_))
                        || !super::super::is_valid_mmdc_theme(&name)
                    {
                        return Err(format!("Unsupported theme mode '{name}'"));
                    }
                    config.theme = Some(name);
                }
                for name in ["light", "dark"] {
                    if t.get(name).is_some_and(|v| !matches!(v, Value::Object(_))) {
                        return Err(format!("Theme configuration '{name}' must be an object"));
                    }
                }
            }
            _ => return Err("Invalid 'theme' value in configuration file".into()),
        }
        if let Some(bg) = v.get("backgroundColor") {
            let Value::String(s) = bg else {
                return Err("Configuration 'backgroundColor' must be a string".into());
            };
            config.background = Some(String::from_utf16_lossy(s));
        }
        let number = |key: &str, v: &Value| match v {
            Value::Number(n) if n.is_finite() && *n > 0. => Ok(*n),
            _ => Err(format!("Configuration '{key}' must be a positive number")),
        };
        if let Some(flow) = v
            .get("flowchart")
            .filter(|v| **v != Value::Null && !(source && matches!(v, Value::Array(_))))
        {
            let Value::Object(pairs) = flow else {
                return Err("Configuration 'flowchart' must be an object".into());
            };
            for (key, val) in pairs {
                let key = String::from_utf16_lossy(key);
                let slot = match key.as_str() {
                    "rankSpacing" => &mut config.rank_gap,
                    "nodeSpacing" => &mut config.node_gap,
                    "wrappingWidth" => &mut config.wrapping_width,
                    _ if source && key != "padding" => continue,
                    _ => return Err(format!("Unsupported flowchart configuration '{key}'")),
                };
                *slot = Some(number(&format!("flowchart.{key}"), val)?);
            }
        }
        if let Some(vars) = v
            .get("themeVariables")
            .filter(|v| **v != Value::Null && !(source && matches!(v, Value::Array(_))))
        {
            let Value::Object(pairs) = vars else {
                return Err("Configuration 'themeVariables' must be an object".into());
            };
            for (key, val) in pairs {
                let key = String::from_utf16_lossy(key);
                if !matches!(
                    key.as_str(),
                    "primaryColor"
                        | "primaryTextColor"
                        | "primaryBorderColor"
                        | "lineColor"
                        | "textColor"
                        | "background"
                        | "noteBkgColor"
                        | "noteTextColor"
                        | "noteBorderColor"
                ) {
                    if source {
                        continue;
                    }
                    return Err(format!("Unsupported theme variable '{key}'"));
                }
                if !matches!(val, Value::String(_)) {
                    return Err(format!("Theme variable '{key}' must be a color string"));
                }
            }
        }
        for (key, slot) in [
            ("rankGap", &mut config.rank_gap),
            ("nodeGap", &mut config.node_gap),
            ("padding", &mut config.padding),
            ("width", &mut config.width),
            ("height", &mut config.height),
            ("scale", &mut config.scale),
        ] {
            if let Some(val) = v.get(key) {
                *slot = Some(number(key, val)?);
            }
        }
        Ok(config)
    }
}
