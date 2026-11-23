//! Conditional appearance is derived; authored cell values/styles stay intact.
//! Evaluation adapted from IronCalc f936620 (MIT, LICENSE.IronCalc).
//! Priority uses SpreadsheetML ordering: lower numbers take precedence.
use super::{Spreadsheet, Style, formulas};
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ValueOperator {
    Equal,
    NotEqual,
    GreaterThan,
    GreaterThanOrEqual,
    LessThan,
    LessThanOrEqual,
    Between,
    NotBetween,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TextOperator {
    Contains,
    DoesNotContain,
    BeginsWith,
    EndsWith,
    Equals,
}
#[derive(Clone, PartialEq)]
pub enum ConditionalValue {
    Min,
    Max,
    Number(f64),
    Percent(f64),
    Percentile(f64),
    Formula(String),
}
impl ConditionalValue {
    fn formula_mut(&mut self) -> Option<&mut String> {
        if let Self::Formula(source) = self {
            Some(source)
        } else {
            None
        }
    }
    fn validate(&self, work: &mut usize) -> Result<(), String> {
        *work = work
            .checked_sub(128)
            .ok_or("Conditional formatting exceeds its limit")?;
        match self {
            Self::Number(n) if !n.is_finite() => Err("Invalid conditional threshold value".into()),
            Self::Percent(n) | Self::Percentile(n)
                if !n.is_finite() || !(0.0..=100.0).contains(n) =>
            {
                Err("Invalid conditional threshold percentage".into())
            }
            Self::Formula(source) => {
                *work = work
                    .checked_sub(source.len())
                    .ok_or("Conditional formatting exceeds its limit")?;
                if source.trim().trim_start_matches('=').trim().is_empty() {
                    Err("Conditional threshold needs a formula".into())
                } else {
                    Ok(())
                }
            }
            _ => Ok(()),
        }
    }
}
#[derive(Clone, PartialEq)]
pub struct DataBar {
    /// SpreadsheetML tokens: context/leftToRight/rightToLeft and automatic/middle/none.
    pub direction: String,
    pub axis: String,
    /// None uses automatic bounds, including zero in the observed range.
    pub min: Option<ConditionalValue>,
    pub max: Option<ConditionalValue>,
    pub positive_color: String,
    /// None follows the positive color, as in Excel’s same-as-positive flag.
    pub negative_color: Option<String>,
    pub border_color: Option<String>,
    pub negative_border_color: Option<String>,
    pub axis_color: String,
    pub is_gradient: bool,
    pub show_value: bool,
    /// SpreadsheetML percentages of the available cell width.
    pub min_length: usize,
    pub max_length: usize,
}
#[derive(Clone, Debug, PartialEq)]
pub struct DataBarAppearance {
    pub right_to_left: bool,
    pub axis_hidden: bool,
    /// Original value, retaining sign and zero after threshold clamping.
    pub number: f64,
    pub positive_color: String,
    pub negative_color: String,
    pub border_color: Option<String>,
    pub negative_border_color: Option<String>,
    pub axis_color: String,
    pub is_gradient: bool,
    pub show_value: bool,
    /// Normalized endpoint and zero-axis position, before cell-width limits.
    pub value: f64,
    pub axis_position: f64,
    pub min_length: usize,
    pub max_length: usize,
}
/// SpreadsheetML names and lowest-to-highest icon indices remain intact in JSON.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConditionalIcon {
    pub set: String,
    pub index: usize,
}
pub fn icon_set_size(name: &str) -> Option<usize> {
    Some(match name {
        "3Arrows" | "3ArrowsGray" | "3Flags" | "3TrafficLights1" | "3TrafficLights2" | "3Signs"
        | "3Symbols" | "3Symbols2" | "3Stars" | "3Triangles" => 3,
        "4Arrows" | "4ArrowsGray" | "4RedToBlack" | "4Rating" | "4TrafficLights" => 4,
        "5Arrows" | "5ArrowsGray" | "5Rating" | "5Quarters" | "5Boxes" => 5,
        _ => return None,
    })
}
#[derive(Clone, PartialEq)]
pub struct IconThreshold {
    pub value: ConditionalValue,
    pub greater_equal: bool,
}
#[derive(Clone, PartialEq)]
pub struct IconSet {
    pub name: String,
    pub thresholds: Vec<IconThreshold>,
    pub reverse: bool,
    pub show_value: bool,
    /// Empty means the named preset. Custom entries include Excel's NoIcons.
    pub custom: Vec<ConditionalIcon>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct IconAppearance {
    pub icon: ConditionalIcon,
    pub show_value: bool,
}
#[derive(Clone, PartialEq)]
pub struct ColorScaleThreshold {
    pub value: ConditionalValue,
    /// Resolved ARGB color, as used by ordinary cell styles.
    pub color: String,
}
#[derive(Clone, PartialEq)]
pub enum ConditionalRule {
    /// SpreadsheetML timePeriod token; dates and current time use UTC.
    TimePeriod {
        period: String,
    },
    IconSet(IconSet),
    DataBar(DataBar),
    ColorScale {
        thresholds: Vec<ColorScaleThreshold>,
    },
    Formula(String),
    Text {
        operator: TextOperator,
        value: String,
    },
    DuplicateValues,
    UniqueValues,
    AboveAverage,
    BelowAverage,
    AboveOrEqualAverage,
    BelowOrEqualAverage,
    AverageDeviation {
        above: bool,
        equal: bool,
        deviations: usize,
    },
    Top {
        rank: usize,
        percent: bool,
        bottom: bool,
    },
    Blanks,
    NotBlanks,
    Errors,
    NoErrors,
    CellIs {
        operator: ValueOperator,
        formula: String,
        formula2: Option<String>,
    },
}
impl ConditionalRule {
    pub(super) fn formulas_mut(&mut self) -> impl Iterator<Item = &mut String> {
        let (formulas, thresholds, icons) = match self {
            Self::Formula(source) => ([Some(source), None], None, None),
            Self::CellIs {
                formula, formula2, ..
            } => ([Some(formula), formula2.as_mut()], None, None),
            Self::ColorScale { thresholds } => {
                ([None, None], Some(thresholds.as_mut_slice()), None)
            }
            Self::DataBar(bar) => (
                [
                    bar.min.as_mut().and_then(ConditionalValue::formula_mut),
                    bar.max.as_mut().and_then(ConditionalValue::formula_mut),
                ],
                None,
                None,
            ),
            Self::IconSet(set) => ([None, None], None, Some(set.thresholds.as_mut_slice())),
            _ => ([None, None], None, None),
        };
        formulas
            .into_iter()
            .flatten()
            .chain(
                thresholds
                    .into_iter()
                    .flatten()
                    .filter_map(|t| t.value.formula_mut()),
            )
            .chain(
                icons
                    .into_iter()
                    .flatten()
                    .filter_map(|t| t.value.formula_mut()),
            )
    }
}
#[derive(Clone, PartialEq)]
pub struct ConditionalFormat {
    pub sheet: usize,
    /// Inclusive zero-based [top, left, bottom, right] areas.
    pub ranges: Vec<[usize; 4]>,
    /// Lower numbers take precedence; equal priorities retain document order.
    pub priority: usize,
    pub stop_if_true: bool,
    pub rule: ConditionalRule,
    pub style: Style,
    pub format: Option<String>,
}
impl ConditionalFormat {
    pub(super) fn anchor(&self) -> Option<(usize, usize)> {
        self.ranges
            .iter()
            .map(|r| (r[0], r[1]))
            .reduce(|a, b| (a.0.min(b.0), a.1.min(b.1)))
    }
}
#[derive(Default)]
pub struct ConditionalAppearance {
    pub style: Style,
    pub format: Option<String>,
    pub data_bar: Option<DataBarAppearance>,
    pub icon: Option<IconAppearance>,
}

impl Spreadsheet {
    /// Apply a derived number format without changing authored cells or caches.
    pub fn conditional_display(
        &self,
        sheet: usize,
        row: usize,
        column: usize,
        appearance: &ConditionalAppearance,
        limit: usize,
    ) -> Result<String, String> {
        let Some(format) = &appearance.format else {
            return self.display(sheet, row, column, limit);
        };
        if sheet >= self.sheets.len() {
            return Err("Unknown sheet".into());
        }
        let Some(cell) = self.cell(sheet, row, column) else {
            return Ok(String::new());
        };
        let mut cell = (*cell).clone();
        cell.format = Some(format.clone());
        cell.value_format = Some(format.clone());
        super::csv::cell_text(
            &cell,
            None,
            self.options.date1904,
            super::number_format::Mode::ExcelDisplay,
            &mut { limit },
        )
        .map(|(text, _)| text)
        .ok_or_else(|| "Cell formatting exceeds its limit".into())
    }

    pub(super) fn validate_conditional_formats(
        &self,
        rules: &[ConditionalFormat],
        work: &mut usize,
    ) -> Result<(), String> {
        for rule in rules {
            *work = work
                .checked_sub(
                    256 + rule.style.retained_bytes() + rule.format.as_ref().map_or(0, String::len),
                )
                .ok_or("Conditional formatting exceeds its limit")?;
            if rule.sheet >= self.sheets.len() || rule.priority == 0 || rule.ranges.is_empty() {
                return Err("Invalid conditional formatting rule".into());
            }
            for &[top, left, bottom, right] in &rule.ranges {
                *work = work
                    .checked_sub(64)
                    .ok_or("Conditional formatting exceeds its limit")?;
                if top > bottom || left > right || bottom >= 1_048_576 || right >= 16_384 {
                    return Err("Conditional formatting range is outside the worksheet".into());
                }
            }
            match &rule.rule {
                ConditionalRule::IconSet(set) => {
                    *work = work
                        .checked_sub(128 + set.name.len())
                        .ok_or("Conditional formatting exceeds its limit")?;
                    let count = icon_set_size(&set.name).ok_or("Unknown conditional icon set")?;
                    if set.thresholds.len() != count
                        || !set.custom.is_empty() && set.custom.len() != count
                    {
                        return Err(
                            "Icon thresholds and custom icons must match the set size".into()
                        );
                    }
                    for threshold in &set.thresholds {
                        threshold.value.validate(work)?;
                    }
                    for icon in &set.custom {
                        *work = work
                            .checked_sub(64 + icon.set.len())
                            .ok_or("Conditional formatting exceeds its limit")?;
                        if icon.set == "NoIcons" && icon.index == 0 {
                            continue;
                        }
                        if icon_set_size(&icon.set).is_none_or(|size| icon.index >= size) {
                            return Err("Invalid conditional icon".into());
                        }
                    }
                }
                ConditionalRule::DataBar(bar) => {
                    if !matches!(
                        bar.direction.as_str(),
                        "context" | "leftToRight" | "rightToLeft"
                    ) {
                        return Err("Invalid data bar direction".into());
                    }
                    if !matches!(bar.axis.as_str(), "automatic" | "middle" | "none") {
                        return Err("Invalid data bar axis".into());
                    }
                    *work = work
                        .checked_sub(
                            128 + bar.positive_color.len()
                                + bar.negative_color.as_ref().map_or(0, String::len)
                                + bar.axis_color.len()
                                + bar.border_color.as_ref().map_or(0, String::len)
                                + bar.negative_border_color.as_ref().map_or(0, String::len),
                        )
                        .ok_or("Conditional formatting exceeds its limit")?;
                    for color in [&bar.positive_color, &bar.axis_color]
                        .into_iter()
                        .chain(bar.negative_color.iter())
                        .chain(bar.border_color.iter())
                        .chain(bar.negative_border_color.iter())
                    {
                        if color.len() != 8 || !color.bytes().all(|b| b.is_ascii_hexdigit()) {
                            return Err("Invalid data bar color".into());
                        }
                    }
                    if bar.border_color.is_none() && bar.negative_border_color.is_some() {
                        return Err("Negative data bar borders require a positive border".into());
                    }
                    if bar.min_length > bar.max_length || bar.max_length > 100 {
                        return Err("Invalid data bar lengths".into());
                    }
                    for value in bar.min.iter().chain(&bar.max) {
                        value.validate(work)?;
                    }
                }
                ConditionalRule::ColorScale { thresholds } => {
                    if !(2..=3).contains(&thresholds.len()) {
                        return Err("Color scales need two or three thresholds".into());
                    }
                    for threshold in thresholds {
                        *work = work
                            .checked_sub(128 + threshold.color.len())
                            .ok_or("Conditional formatting exceeds its limit")?;
                        if threshold.color.len() != 8
                            || !threshold.color.bytes().all(|b| b.is_ascii_hexdigit())
                        {
                            return Err("Invalid color scale color".into());
                        }
                        threshold.value.validate(work)?;
                    }
                }

                ConditionalRule::Formula(source) => {
                    *work = work
                        .checked_sub(source.len())
                        .ok_or("Conditional formatting exceeds its limit")?;
                    if source.trim().trim_start_matches('=').trim().is_empty() {
                        return Err("Conditional formatting needs a formula".into());
                    }
                }
                ConditionalRule::Text { value, .. } => {
                    *work = work
                        .checked_sub(value.len().saturating_mul(4))
                        .ok_or("Conditional formatting exceeds its limit")?;
                }
                ConditionalRule::TimePeriod { period }
                    if !matches!(
                        period.as_str(),
                        "yesterday"
                            | "today"
                            | "tomorrow"
                            | "last7Days"
                            | "lastWeek"
                            | "thisWeek"
                            | "nextWeek"
                            | "lastMonth"
                            | "thisMonth"
                            | "nextMonth"
                    ) =>
                {
                    return Err("Unknown conditional date period".into());
                }
                ConditionalRule::AverageDeviation { deviations, .. }
                    if *deviations == 0 || *deviations > i32::MAX as usize =>
                {
                    return Err(
                        "Standard deviations must be a positive SpreadsheetML integer".into(),
                    );
                }
                ConditionalRule::Top { rank, percent, .. }
                    if *rank > 1_048_576 || *percent && *rank > 100 =>
                {
                    return Err("Invalid conditional formatting rank".into());
                }

                ConditionalRule::CellIs {
                    operator,
                    formula,
                    formula2,
                } => {
                    *work = work
                        .checked_sub(formula.len() + formula2.as_ref().map_or(0, String::len))
                        .ok_or("Conditional formatting exceeds its limit")?;
                    if formula.trim().trim_start_matches('=').trim().is_empty()
                        || matches!(operator, ValueOperator::Between | ValueOperator::NotBetween)
                            && formula2
                                .as_ref()
                                .is_none_or(|s| s.trim().trim_start_matches('=').trim().is_empty())
                    {
                        return Err("Conditional formatting needs a comparison value".into());
                    }
                }
                _ => {}
            }
        }
        Ok(())
    }
    /// Validate the complete rule edit before replacing any existing rules.
    pub fn set_conditional_formats(
        &mut self,
        rules: Vec<ConditionalFormat>,
        limit: usize,
    ) -> Result<(), String> {
        self.validate_conditional_formats(&rules, &mut { limit })?;
        self.options.conditional_formats = rules;
        Ok(())
    }
    /// Derive appearance only for requested cells, including blank cells. Even
    /// whole-sheet rules never allocate a cell for each coordinate in the range.
    pub fn conditional_styles(
        &self,
        sheet: usize,
        cells: &[(usize, usize)],
        mut limit: usize,
    ) -> Result<BTreeMap<(usize, usize), ConditionalAppearance>, String> {
        if sheet >= self.sheets.len() || cells.iter().any(|&(r, c)| r >= 1_048_576 || c >= 16_384) {
            return Err("Conditional formatting cell is outside the workbook".into());
        }
        self.validate_conditional_formats(&self.options.conditional_formats, &mut limit)?;
        formulas::conditional_styles::evaluate(self, sheet, cells, limit)
            .ok_or_else(|| "Conditional formatting exceeds its limit".into())
    }
}
