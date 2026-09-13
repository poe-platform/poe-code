# International text metadata

`pptx text runs get` reads direct formatting. `pptx text runs set` and SDK `mutateTextRuns` edit the same fields. CLI run/paragraph positions are one-based; SDK positions are zero-based.

```sh
pptx text runs set deck.pptx --slide 1 --shape Caption --paragraph 1 --run 1 \
  --east-asia-font "Grove East" --complex-script-font "Grove Arabic" \
  --complex-script-charset -128 --complex-script-pitch-family 34 \
  --complex-script-panose 020B0604020202020204 \
  --alternate-language ja-JP --rtl true --output styled.pptx
```

The SDK option names are `font`, `eastAsiaFont`, `complexScriptFont`, `symbolFont`, `language`, `alternateLanguage`, `rtl`, `complexScriptCharset`, `complexScriptPitchFamily` and `complexScriptPanose`. Omit a field to preserve it; use null to remove its direct override. Read results return null for absent direct attributes. Paragraph RTL and text-frame vertical mode remain separate properties, available through their existing resource operations.

Complex-script charset is an integer from -128 through 127. Pitch-family accepts 0, 1, 2, 16, 17, 18, 32, 33, 34, 48, 49, 50, 64, 65, 66, 80, 81 or 82. PANOSE is exactly 20 hexadecimal digits, serialized uppercase. Creating these attributes requires an existing complex-script font or an explicit `complexScriptFont`; clearing attributes does not create a missing font. Setting the font to null cannot be combined with non-null classification attributes.

Typeface-only updates preserve classification and unknown font metadata. Other script slots expose their typeface and preserve additional attributes. Extraction and literal replacement preserve Unicode sequences without normalization, including combining marks and emoji. Replacement can span adjacent runs; it retains the first matching run's formatting and unaffected suffix formatting.

`inspect` reports effective East Asian and complex-script typeface values with paragraph/layout/master/theme provenance. Direct run reads do not flatten inheritance. Vertical mode is metadata: these operations do not shape text, choose/install fonts or promise visual reading order.
