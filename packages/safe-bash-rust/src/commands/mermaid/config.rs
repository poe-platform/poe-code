use mcp_protocol_rust::json::{self, Value};
use std::collections::BTreeMap;

#[derive(Default)]
pub(in super::super) struct Config {
    pub theme: Option<String>,
    overrides: [Vec<(String, Value)>; 2],
    palette: Vec<(&'static [&'static str], Value)>,
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
                for (i, name) in ["light", "dark"].into_iter().enumerate() {
                    if let Some(value) = t.get(name) {
                        let Value::Object(pairs) = value else {
                            return Err(format!("Theme configuration '{name}' must be an object"));
                        };
                        config.overrides[i].extend(
                            pairs
                                .iter()
                                .map(|(k, v)| (String::from_utf16_lossy(k), v.clone())),
                        );
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
                let keys: &[&str] = match key.as_str() {
                    "primaryColor" => &["surface", "surfaceAccent", "accentSurface"],
                    "primaryTextColor" => &["text", "accentText"],
                    "primaryBorderColor" => &["border", "accentBorder"],
                    "lineColor" => &["edge"],
                    "textColor" => &["text"],
                    "background" => &["canvas"],
                    "noteBkgColor" => &["noteSurface"],
                    "noteTextColor" => &["noteText"],
                    "noteBorderColor" => &["noteBorder"],
                    _ if source => continue,
                    _ => return Err(format!("Unsupported theme variable '{key}'")),
                };
                if !matches!(val, Value::String(_)) {
                    return Err(format!("Theme variable '{key}' must be a color string"));
                }
                config.palette.push((keys, val.clone()));
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

pub(in super::super) struct Theme<'a> {
    mode: &'a str,
    pub numbers: BTreeMap<&'a str, f64>,
    colors: BTreeMap<&'a str, (String, [u8; 4])>,
    pub font: String,
}

impl Theme<'_> {
    pub fn color(&self, key: &str) -> (&str, [u8; 4]) {
        if let Some((raw, rgba)) = self.colors.get(key) {
            return (raw, *rgba);
        }
        let base = |light, dark| if self.mode == "dark" { dark } else { light };
        let value = match key {
            "surface" | "edgeLabelBackground" => base("#ffffff", "#1e293b"),
            "text" => base("#0f172a", "#f8fafc"),
            "border" | "groupBorder" => base("#cbd5e1", "#334155"),
            "edge" => base("#64748b", "#94a3b8"),
            "shadowColor" => base("rgba(15, 23, 42, 0.06)", "rgba(0, 0, 0, 0.35)"),
            "groupSurface" => base("#f1f5f980", "#0f172a99"),
            "groupHeaderSurface" => base("#e2e8f080", "#1e293b"),
            "edgeLabelBorder" => base("#e2e8f0", "#334155"),
            "accent" => match self.mode {
                "dark" => "#60a5fa",
                "forest" => "#15803d",
                "neutral" => "#475569",
                _ => "#2563eb",
            },
            "surfaceAccent" => match self.mode {
                "dark" => "#172554",
                "forest" => "#f0fdf4",
                "neutral" => "#f1f5f9",
                _ => "#eff6ff",
            },
            "accentBorder" => match self.mode {
                "dark" => "#3b82f6",
                "forest" => "#4ade80",
                "neutral" => "#94a3b8",
                _ => "#60a5fa",
            },
            "accentText" => match self.mode {
                "dark" => "#dbeafe",
                "forest" => "#166534",
                "neutral" => "#334155",
                _ => "#1e3a8a",
            },
            _ => unreachable!("missing default color {key}"),
        };
        super::css_color(value).unwrap()
    }
}

/// Bound repeated SVG attributes before constructing the element. Count the strings
/// actually painted so unused overrides cannot reject a small output.
pub(super) fn charge_attributes(budget: &mut usize, attrs: &[(&str, usize)]) -> Result<(), String> {
    for (value, count) in attrs {
        *budget = budget
            .checked_sub(value.len().saturating_mul(*count))
            .ok_or("mmdc: E_LIMIT: Render work budget exceeded\n")?;
    }
    Ok(())
}

/// Apply object-spread precedence before validating: an overwritten invalid token is unobservable.
pub(in super::super) fn theme_tokens<'a>(
    source: &'a Config,
    file: &'a Config,
    mode: &'a str,
) -> Result<Theme<'a>, String> {
    let index = usize::from(mode == "dark");
    let mut values = BTreeMap::new();
    let mut order = Vec::new();
    for config in [source, file] {
        let overrides = config.overrides[index].iter().map(|(k, v)| (k.as_str(), v));
        let variables = config
            .palette
            .iter()
            .flat_map(|(keys, v)| keys.iter().map(move |&k| (k, v)));
        for (key, value) in overrides.chain(variables) {
            if values.insert(key, value).is_none() {
                order.push(key);
            }
        }
    }
    // Object.keys visits canonical array indices first, then other keys in insertion order.
    order.sort_by_key(|key| {
        key.parse::<u32>()
            .ok()
            .filter(|n| n.to_string() == *key)
            .unwrap_or(u32::MAX)
    });
    let mut theme = Theme {
        mode,
        colors: BTreeMap::new(),
        numbers: BTreeMap::new(),
        font: super::FONT.into(),
    };
    for key in order {
        let val = values[key];
        let invalid = |msg: &str| format!("mmdc: E_CONFIG: Theme token '{key}' must be {msg}\n");
        match key {
            "canvas"
            | "surface"
            | "surfaceElevated"
            | "surfaceAccent"
            | "text"
            | "mutedText"
            | "border"
            | "borderStrong"
            | "edge"
            | "edgeLabelBackground"
            | "edgeLabelBorder"
            | "accent"
            | "accentSurface"
            | "accentBorder"
            | "accentText"
            | "groupSurface"
            | "groupHeaderSurface"
            | "groupBorder"
            | "noteSurface"
            | "noteBorder"
            | "noteText"
            | "activationSurface"
            | "shadowColor" => {
                let Value::String(value) = val else {
                    return Err(invalid("a valid color string"));
                };
                let raw = String::from_utf16_lossy(value);
                let rgba = super::css_color(&raw)?.1;
                theme.colors.insert(key, (raw, rgba));
            }
            "fontSize" | "secondaryFontSize" | "lineHeight" | "strokeWidth" | "edgeStrokeWidth"
            | "cornerRadius" | "elbowRadius" | "rankGap" | "nodeGap" | "wrappingWidth"
            | "padding" => {
                if let Value::Number(n) = val
                    && n.is_finite()
                    && *n > 0.
                {
                    theme.numbers.insert(key, *n);
                } else {
                    return Err(invalid("a positive finite number"));
                }
            }
            "fontFamily" | "monospaceFontFamily" => {
                let Value::String(v) = val else {
                    return Err(invalid("a non-empty string"));
                };
                let font = String::from_utf16_lossy(v);
                if font.trim().is_empty() {
                    return Err(invalid("a non-empty string"));
                }
                if key == "fontFamily" {
                    theme.font = super::esc(&font);
                }
            }
            // Inherited Object properties are present in the default JS token object,
            // but they do not designate mutable theme tokens.
            "constructor"
            | "toString"
            | "valueOf"
            | "hasOwnProperty"
            | "isPrototypeOf"
            | "propertyIsEnumerable"
            | "toLocaleString"
            | "__proto__"
            | "__defineGetter__"
            | "__defineSetter__"
            | "__lookupGetter__"
            | "__lookupSetter__" => (),
            _ => return Err(format!("mmdc: E_CONFIG: Unknown theme token '{key}'\n")),
        }
    }
    Ok(theme)
}
