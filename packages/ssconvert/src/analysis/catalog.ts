/** Writable GObject properties in Gnumeric 1.12.61. Source/oracle inventory:
 * docs/ssconvert/analysis-tool-profile.json. Property order affects enum errors. */
export interface ToolProperty {
  readonly name: string;
  readonly type: "boolean" | "int" | "uint" | "double" | "string" | "enum";
  readonly default: string | number | boolean | null;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly enum?: Readonly<Record<string, number>>;
  readonly enumType?: string;
  /** Native setters can update flags independently of the supplied value. */
  readonly setterEffects?: Readonly<Record<string, boolean>>;
}
export interface ToolDefinition {
  readonly input: "pair" | "data" | "none";
  readonly outputName: string;
  readonly properties: readonly ToolProperty[];
}
const definitions: Readonly<Record<string, ToolDefinition>> = {
  "regression": {
    input: "pair", outputName: "Regression",
    properties: [
      {"name":"labels","type":"boolean","default":false},
      {"name":"alpha","type":"double","minimum":0,"maximum":1,"default":0.05},
      {"name":"group-by","type":"enum","default":1,"enum":{"row":0,"col":1,"area":2,"bin":3},"enumType":"gnm_tool_group_by_t"},
      {"name":"intercept","type":"boolean","default":true},
      {"name":"multiple-regression","type":"boolean","default":true},
      {"name":"multiple-y","type":"boolean","default":false},
      {"name":"residual","type":"boolean","default":true},
    ]
  },
  "moving-average": {
    input: "data", outputName: "Moving Average",
    properties: [
      {"name":"labels","type":"boolean","default":false},
      {"name":"group-by","type":"enum","default":1,"enum":{"row":0,"col":1,"area":2,"bin":3},"enumType":"gnm_tool_group_by_t"},
      {"name":"interval","type":"int","minimum":1,"maximum":2147483647,"default":1},
      {"name":"std-error-flag","type":"int","minimum":0,"maximum":1,"default":0},
      {"name":"df","type":"int","minimum":0,"maximum":2147483647,"default":0},
      {"name":"offset","type":"int","minimum":0,"maximum":2147483647,"default":0},
      {"name":"show-graph","type":"boolean","default":false},
      {"name":"ma-type","type":"int","minimum":0,"maximum":10,"default":0},
    ]
  },
  "anova": {
    input: "data", outputName: "Single Factor ANOVA",
    properties: [
      {"name":"labels","type":"boolean","default":false},
      {"name":"group-by","type":"enum","default":1,"enum":{"row":0,"col":1,"area":2,"bin":3},"enumType":"gnm_tool_group_by_t"},
      {"name":"alpha","type":"double","minimum":0,"maximum":1,"default":0.05},
    ]
  },
  "anova2": {
    input: "data", outputName: "Two Factor ANOVA",
    properties: [
      {"name":"group-by","type":"enum","default":1,"enum":{"row":0,"col":1,"area":2,"bin":3},"enumType":"gnm_tool_group_by_t"},
      {"name":"alpha","type":"double","minimum":0,"maximum":1,"default":0.05},
      {"name":"labels","type":"boolean","default":false},
      {"name":"replication","type":"int","minimum":1,"maximum":2147483647,"default":1},
    ]
  },
  "chi-squared-test": {
    input: "data", outputName: "Test of Homogeneity",
    properties: [
      {"name":"alpha","type":"double","minimum":0,"maximum":1,"default":0.05},
      {"name":"independence","type":"boolean","default":false},
      {"name":"labels","type":"boolean","default":false},
    ]
  },
  "descriptive-statistics": {
    input: "data", outputName: "Descriptive Statistics",
    properties: [
      {"name":"labels","type":"boolean","default":false},
      {"name":"group-by","type":"enum","default":1,"enum":{"row":0,"col":1,"area":2,"bin":3},"enumType":"gnm_tool_group_by_t"},
      {"name":"do-summary-statistics","type":"boolean","default":true},
      {"name":"do-confidence-level","type":"boolean","default":true},
      {"name":"do-kth-largest","type":"boolean","default":true},
      {"name":"do-kth-smallest","type":"boolean","default":true},
      {"name":"use-ssmedian","type":"boolean","default":false},
      {"name":"k-smallest","type":"int","minimum":1,"maximum":2147483647,"default":1},
      {"name":"k-largest","type":"int","minimum":1,"maximum":2147483647,"default":1},
      {"name":"confidence-level","type":"double","minimum":0,"maximum":1,"default":0.95},
    ]
  },
  "correlation": {
    input: "data", outputName: "Correlation",
    properties: [
      {"name":"labels","type":"boolean","default":false},
      {"name":"group-by","type":"enum","default":1,"enum":{"row":0,"col":1,"area":2,"bin":3},"enumType":"gnm_tool_group_by_t"},
    ]
  },
  "covariance": {
    input: "data", outputName: "Covariance",
    properties: [
      {"name":"labels","type":"boolean","default":false},
      {"name":"group-by","type":"enum","default":1,"enum":{"row":0,"col":1,"area":2,"bin":3},"enumType":"gnm_tool_group_by_t"},
    ]
  },
  "fourier-analysis": {
    input: "data", outputName: "Fourier Series",
    properties: [
      {"name":"labels","type":"boolean","default":false},
      {"name":"group-by","type":"enum","default":1,"enum":{"row":0,"col":1,"area":2,"bin":3},"enumType":"gnm_tool_group_by_t"},
      {"name":"inverse","type":"boolean","default":false},
    ]
  },
  "sampling": {
    input: "data", outputName: "Sampling",
    properties: [
      {"name":"labels","type":"boolean","default":false},
      {"name":"group-by","type":"enum","default":1,"enum":{"row":0,"col":1,"area":2,"bin":3},"enumType":"gnm_tool_group_by_t"},
      {"name":"periodic","type":"boolean","default":false},
      {"name":"row-major","type":"boolean","default":false},
      {"name":"offset","type":"uint","minimum":0,"maximum":4294967295,"default":0},
      {"name":"size","type":"uint","minimum":0,"maximum":4294967295,"default":0},
      {"name":"period","type":"uint","minimum":0,"maximum":4294967295,"default":0},
      {"name":"number","type":"uint","minimum":0,"maximum":4294967295,"default":0},
    ]
  },
  "ranking": {
    input: "data", outputName: "Ranks",
    properties: [
      {"name":"labels","type":"boolean","default":false},
      {"name":"group-by","type":"enum","default":1,"enum":{"row":0,"col":1,"area":2,"bin":3},"enumType":"gnm_tool_group_by_t"},
      {"name":"av-ties","type":"boolean","default":false},
    ]
  },
  "exponential-smoothing": {
    input: "data", outputName: "Exponential Smoothing",
    properties: [
      {"name":"labels","type":"boolean","default":false},
      {"name":"group-by","type":"enum","default":1,"enum":{"row":0,"col":1,"area":2,"bin":3},"enumType":"gnm_tool_group_by_t"},
      {"name":"damp-fact","type":"double","minimum":0,"maximum":1,"default":0.5},
      {"name":"g-damp-fact","type":"double","minimum":0,"maximum":1,"default":0.5},
      {"name":"s-damp-fact","type":"double","minimum":0,"maximum":1,"default":0.5},
      {"name":"s-period","type":"int","minimum":1,"maximum":2147483647,"default":1},
      {"name":"std-error-flag","type":"int","minimum":0,"maximum":1,"default":0},
      {"name":"df","type":"int","minimum":0,"maximum":2147483647,"default":0},
      {"name":"show-graph","type":"boolean","default":false},
      {"name":"es-type","type":"int","minimum":0,"maximum":10,"default":0},
    ]
  },
  "histogram": {
    input: "data", outputName: "Histogram",
    properties: [
      {"name":"labels","type":"boolean","default":false},
      {"name":"group-by","type":"enum","default":1,"enum":{"row":0,"col":1,"area":2,"bin":3},"enumType":"gnm_tool_group_by_t"},
      {"name":"predetermined","type":"boolean","default":false},
      {"name":"bin-type","type":"int","minimum":0,"maximum":100,"default":0},
      {"name":"max-given","type":"boolean","default":false},
      {"name":"min-given","type":"boolean","default":false},
      {"name":"max","type":"double","minimum":-1.7976931348623157e+308,"maximum":1.7976931348623157e+308,"default":0},
      {"name":"min","type":"double","minimum":-1.7976931348623157e+308,"maximum":1.7976931348623157e+308,"default":0},
      {"name":"n","type":"int","minimum":1,"maximum":2147483647,"default":1},
      {"name":"percentage","type":"boolean","default":false},
      {"name":"cumulative","type":"boolean","default":false},
      {"name":"only-numbers","type":"boolean","default":false},
      {"name":"chart","type":"enum","default":0,"enum":{"none":0,"histogram":1,"bar":2,"column":3},"enumType":"gnm_hist_tool_chart_t"},
    ]
  },
  "sign-test": {
    input: "data", outputName: "Sign Test",
    properties: [
      {"name":"labels","type":"boolean","default":false},
      {"name":"group-by","type":"enum","default":1,"enum":{"row":0,"col":1,"area":2,"bin":3},"enumType":"gnm_tool_group_by_t"},
      {"name":"median","type":"double","minimum":-1.7976931348623157e+308,"maximum":1.7976931348623157e+308,"default":0},
      {"name":"alpha","type":"double","minimum":0,"maximum":1,"default":0.05},
    ]
  },
  "frequency-tables": {
    input: "data", outputName: "Frequency Table",
    properties: [
      {"name":"labels","type":"boolean","default":false},
      {"name":"group-by","type":"enum","default":1,"enum":{"row":0,"col":1,"area":2,"bin":3},"enumType":"gnm_tool_group_by_t"},
      {"name":"predetermined","type":"boolean","default":false},
      {"name":"max","type":"double","minimum":-1.7976931348623157e+308,"maximum":1.7976931348623157e+308,"default":0},
      {"name":"min","type":"double","minimum":-1.7976931348623157e+308,"maximum":1.7976931348623157e+308,"default":0},
      {"name":"n","type":"int","minimum":1,"maximum":2147483647,"default":1},
      {"name":"percentage","type":"boolean","default":false},
      {"name":"exact","type":"boolean","default":false},
      {"name":"chart","type":"enum","default":0,"enum":{"none":0,"bar":1,"column":2},"enumType":"gnm_freq_tool_chart_t"},
    ]
  },
  "principal-components": {
    input: "data", outputName: "Principal Components Analysis",
    properties: [
      {"name":"labels","type":"boolean","default":false},
      {"name":"group-by","type":"enum","default":1,"enum":{"row":0,"col":1,"area":2,"bin":3},"enumType":"gnm_tool_group_by_t"},
    ]
  },
  "auto-expression": {
    input: "data", outputName: "Auto Expression",
    properties: [
      {"name":"labels","type":"boolean","default":false},
      {"name":"group-by","type":"enum","default":1,"enum":{"row":0,"col":1,"area":2,"bin":3},"enumType":"gnm_tool_group_by_t"},
      {"name":"multiple","type":"boolean","default":false},
      {"name":"below","type":"boolean","default":false},
      {"name":"function","type":"string","default":null},
    ]
  },
  "normality-test": {
    input: "data", outputName: "Normality Test",
    properties: [
      {"name":"labels","type":"boolean","default":false},
      {"name":"group-by","type":"enum","default":1,"enum":{"row":0,"col":1,"area":2,"bin":3},"enumType":"gnm_tool_group_by_t"},
      {"name":"alpha","type":"double","minimum":0,"maximum":1,"default":0.05},
      {"name":"type","type":"enum","default":0,"enum":{"andersondarling":0,"cramervonmises":1,"lilliefors":2,"shapirofrancia":3},"enumType":"gnm_normality_test_type_t"},
      {"name":"graph","type":"boolean","default":false},
    ]
  },
  "one-mean-test": {
    input: "data", outputName: "Student-t Test",
    properties: [
      {"name":"labels","type":"boolean","default":false},
      {"name":"group-by","type":"enum","default":1,"enum":{"row":0,"col":1,"area":2,"bin":3},"enumType":"gnm_tool_group_by_t"},
      {"name":"mean","type":"double","minimum":-1.7976931348623157e+308,"maximum":1.7976931348623157e+308,"default":0},
      {"name":"alpha","type":"double","minimum":0,"maximum":1,"default":0.05},
    ]
  },
  "wilcoxon-signed-rank-test": {
    input: "data", outputName: "Wilcoxon Signed Rank Test",
    properties: [
      {"name":"labels","type":"boolean","default":false},
      {"name":"group-by","type":"enum","default":1,"enum":{"row":0,"col":1,"area":2,"bin":3},"enumType":"gnm_tool_group_by_t"},
      {"name":"median","type":"double","minimum":-1.7976931348623157e+308,"maximum":1.7976931348623157e+308,"default":0},
      {"name":"alpha","type":"double","minimum":0,"maximum":1,"default":0.05},
    ]
  },
  "wilcoxon-signed-rank-test-two-samples": {
    input: "pair", outputName: "Wilcoxon Signed Rank Test",
    properties: [
      {"name":"labels","type":"boolean","default":false},
      {"name":"alpha","type":"double","minimum":0,"maximum":1,"default":0.05},
      {"name":"median","type":"double","minimum":-1.7976931348623157e+308,"maximum":1.7976931348623157e+308,"default":0},
    ]
  },
  "advanced-filter": {
    input: "pair", outputName: "Advanced Filter",
    properties: [
      {"name":"labels","type":"boolean","default":false},
      {"name":"alpha","type":"double","minimum":0,"maximum":1,"default":0.05},
      {"name":"unique-only-flag","type":"boolean","default":false},
    ]
  },
  "wilcoxon-mann-whitney": {
    input: "pair", outputName: "Wilcoxon-Mann-Whitney Test",
    properties: [
      {"name":"labels","type":"boolean","default":false},
      {"name":"alpha","type":"double","minimum":0,"maximum":1,"default":0.05},
    ]
  },
  "sign-test-two-samples": {
    input: "pair", outputName: "Sign Test",
    properties: [
      {"name":"labels","type":"boolean","default":false},
      {"name":"alpha","type":"double","minimum":0,"maximum":1,"default":0.05},
      {"name":"median","type":"double","minimum":-1.7976931348623157e+308,"maximum":1.7976931348623157e+308,"default":0},
    ]
  },
  "f-test": {
    input: "pair", outputName: "F-Test",
    properties: [
      {"name":"labels","type":"boolean","default":false},
      {"name":"alpha","type":"double","minimum":0,"maximum":1,"default":0.05},
    ]
  },
  "t-test-paired": {
    input: "pair", outputName: "t-Test",
    properties: [
      {"name":"labels","type":"boolean","default":false},
      {"name":"alpha","type":"double","minimum":0,"maximum":1,"default":0.05},
      {"name":"mean-diff","type":"double","minimum":-1.7976931348623157e+308,"maximum":1.7976931348623157e+308,"default":0},
    ]
  },
  "t-test-equal-variances": {
    input: "pair", outputName: "t-Test",
    properties: [
      {"name":"labels","type":"boolean","default":false},
      {"name":"alpha","type":"double","minimum":0,"maximum":1,"default":0.05},
      {"name":"mean-diff","type":"double","minimum":-1.7976931348623157e+308,"maximum":1.7976931348623157e+308,"default":0},
    ]
  },
  "t-test-unequal-variances": {
    input: "pair", outputName: "t-Test",
    properties: [
      {"name":"labels","type":"boolean","default":false},
      {"name":"alpha","type":"double","minimum":0,"maximum":1,"default":0.05},
      {"name":"mean-diff","type":"double","minimum":-1.7976931348623157e+308,"maximum":1.7976931348623157e+308,"default":0},
    ]
  },
  "kaplan-meier": {
    input: "pair", outputName: "Kaplan-Meier Estimates",
    properties: [
      {"name":"labels","type":"boolean","default":false},
      {"name":"alpha","type":"double","minimum":0,"maximum":1,"default":0.05},
      {"name":"censored","type":"boolean","default":false},
      {"name":"censor-mark","type":"int","minimum":-2147483648,"maximum":2147483647,"default":0},
      {"name":"censor-mark-to","type":"int","minimum":-2147483648,"maximum":2147483647,"default":0},
      {"name":"chart","type":"boolean","default":false},
      {"name":"ticks","type":"boolean","default":false},
      {"name":"std-err","type":"boolean","default":false},
      {"name":"median","type":"boolean","default":false},
      {"name":"logrank-test","type":"boolean","default":false},
    ]
  },
  "z-test": {
    input: "pair", outputName: "z-Test",
    properties: [
      {"name":"labels","type":"boolean","default":false},
      {"name":"alpha","type":"double","minimum":0,"maximum":1,"default":0.05},
      {"name":"mean-diff","type":"double","minimum":-1.7976931348623157e+308,"maximum":1.7976931348623157e+308,"default":0},
      {"name":"var1","type":"double","minimum":0,"maximum":1.7976931348623157e+308,"default":0},
      {"name":"var2","type":"double","minimum":0,"maximum":1.7976931348623157e+308,"default":0},
    ]
  },
  "fill-series": {
    input: "none", outputName: "Fill Series",
    properties: [
      {"name":"type","type":"enum","default":0,"enum":{"linear":0,"growth":1,"date":2},"enumType":"gnm_fill_series_type_t"},
      {"name":"date-unit","type":"enum","default":0,"enum":{"day":0,"weekday":1,"month":2,"year":3},"enumType":"gnm_fill_series_date_unit_t"},
      {"name":"series-in-rows","type":"boolean","default":false},
      {"name":"step-value","setterEffects":{"is-step-set":true},"type":"double","minimum":-1.7976931348623157e+308,"maximum":1.7976931348623157e+308,"default":1},
      {"name":"stop-value","setterEffects":{"is-stop-set":true},"type":"double","minimum":-1.7976931348623157e+308,"maximum":1.7976931348623157e+308,"default":0},
      {"name":"start-value","type":"double","minimum":-1.7976931348623157e+308,"maximum":1.7976931348623157e+308,"default":0},
      {"name":"is-step-set","type":"boolean","default":false},
      {"name":"is-stop-set","type":"boolean","default":false},
    ]
  },
};
for (const definition of Object.values(definitions)) {
  for (const property of definition.properties) {
    if (property.enum) Object.freeze(property.enum);
    if (property.setterEffects) Object.freeze(property.setterEffects);
    Object.freeze(property);
  }
  Object.freeze(definition.properties);
  Object.freeze(definition);
}
export const analysisTools = Object.freeze(definitions);
