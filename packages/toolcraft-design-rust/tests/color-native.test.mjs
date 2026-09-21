import assert from "node:assert/strict";
import { test } from "node:test";
import * as own from "../dist/index.js";
import * as original from "../../toolcraft-design/dist/index.js";
test("theme precedence preserves lazy environment observation and decimal prefix parsing",()=>{
 const cases=[{}, {POE_CODE_THEME:"DARK",APPLE_INTERFACE_STYLE:"Light"},{POE_CODE_THEME:"",POE_THEME:"light",VSCODE_COLOR_THEME_KIND:"high contrast light"},{APPLE_INTERFACE_STYLE:""},{VSCODE_COLOR_THEME_KIND:"dark light"}];
 for(const value of["0;8","0;7","0;+8tail","0;-8","0;\u00a08","0;0x10","0;","0;"+"9".repeat(400)])cases.push({COLORFGBG:value});
 for(const values of cases){const observe=api=>{const reads=[],env={};for(const key of["POE_CODE_THEME","POE_THEME","APPLE_INTERFACE_STYLE","VSCODE_COLOR_THEME_KIND","COLORFGBG"])Object.defineProperty(env,key,{get(){reads.push(key);return values[key];}});return{mode:api.resolveThemeName(env),reads};};assert.deepEqual(observe(own),observe(original));}
 for(const api of[own,original]){api.resetTheme();assert.equal(api.getTheme({POE_BRAND:"blue"}).styles.info.fg,"#2f6fed");api.configureTheme({brand:"green"});assert.equal(api.getTheme({POE_BRAND:"blue"}).styles.info.fg,"#1f9d57");api.resetTheme();}
});
test("palettes and live labels agree for each brand and theme", () => {
  const saved = process.env.FORCE_COLOR;
  process.env.FORCE_COLOR = "1";
  try {
    for (const api of [original, own]) api.resetTheme();
    for (const mode of ["dark", "light"])
      for (const brand of ["purple", "blue", "green"]) {
        original.configureTheme({ brand, label: "Acme" });
        own.configureTheme({ brand, label: "Acme" });
        const env = { POE_CODE_THEME: mode },
          left = own.getTheme(env),
          right = original.getTheme(env);
        assert.equal(own.getTheme(env), left);
        for (const key of Object.keys(right))
          assert.equal(
            typeof right[key] === "function" ? left[key]("value") : left[key],
            typeof right[key] === "function" ? right[key]("value") : right[key]
          );
        assert.deepEqual(left.styles, right.styles);
        assert.equal(Object.keys(left).includes("styles"), false);
        original.configureTheme({ label: "Later" });
        own.configureTheme({ label: "Later" });
        assert.equal(left.intro("ready"), right.intro("ready"));
      }
  } finally {
    original.resetTheme();
    own.resetTheme();
    if (saved === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = saved;
  }
});
test("text rendering agrees across formats and Markdown delimiters", () => {
  const sample = ["plain", "`a``\r\nb`", "a[b](c)\\", "\ud800", ""];
  for (const format of ["terminal", "markdown", "json"])
    for (const content of sample) {
      for (const key of Object.keys(original.text))
        assert.equal(
          own.withOutputFormat(format, () => own.text[key](content, "detail")),
          original.withOutputFormat(format, () => original.text[key](content, "detail")),
          key
        );
    }
});
test("callable color chains preserve original nested reset and malformed hex contracts", () => {
  const saved = { FORCE_COLOR: process.env.FORCE_COLOR, NO_COLOR: process.env.NO_COLOR };
  process.env.FORCE_COLOR = "1";
  delete process.env.NO_COLOR;
  try {
    for (const style of [
      "reset",
      "bold",
      "dim",
      "italic",
      "underline",
      "inverse",
      "strikethrough",
      "black",
      "red",
      "green",
      "yellow",
      "blue",
      "magenta",
      "cyan",
      "white",
      "gray",
      "magentaBright",
      "cyanBright",
      "bgRed",
      "bgGreen",
      "bgYellow",
      "bgBlue",
      "bgMagenta"
    ]) {
      const sample = "a" + original.color.green("x") + "b\ud800";
      assert.equal(own.color[style].bold(sample), original.color[style].bold(sample));
    }
    for (const channels of [
      [NaN, Infinity, -Infinity],
      [0.5, 254.5, 255.1],
      [0.49999999999999994, 0.5, 1.4999999999999998],
      [-0.1, 1.49, 1.5]
    ])
      for (const method of ["rgb", "bgRgb"])
        assert.equal(own.color[method](...channels)("x"), original.color[method](...channels)("x"));
    for (const value of ["#abc", "ABCDEF", "#000", "#12345g", "#12", "#😀"]) {
      for (const method of ["hex", "bgHex"]) {
        let expected;
        try {
          expected = original.color[method](value)("x");
        } catch (error) {
          assert.throws(() => own.color[method](value), { message: error.message });
          continue;
        }
        assert.equal(own.color[method](value)("x"), expected);
      }
    }
  } finally {
    for (const [key, value] of Object.entries(saved))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});
