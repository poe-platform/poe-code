import { switches } from "./switches.js";
import { WkhtmltopdfError } from "./errors.js";

// Adapter-authored stylesheet for the wkhtmltopdf outline vocabulary.
// Exporting it does not enable an XSLT processor or TOC conversion.
const defaultToc = `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="2.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:outline="http://wkhtmltopdf.org/outline" xmlns="http://www.w3.org/1999/xhtml">
  <xsl:output indent="yes" doctype-public="-//W3C//DTD XHTML 1.0 Strict//EN"
    doctype-system="http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd"/>
  <xsl:template match="outline:outline">
    <html><head><title>Table of Contents</title>
      <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
      <style>
        h1 { text-align: center; font: 20px arial; }
        div { border-bottom: 1px dashed rgb(200,200,200); }
        span { float: right; }
        li { list-style: none; }
        ul { font: 20px arial; padding-left: 0em; }
        ul ul { font-size: 80%; padding-left: 1em; }
        a { text-decoration: none; color: black; }
      </style>
    </head><body><h1>Table of Contents</h1>
      <ul><xsl:apply-templates select="outline:item/outline:item"/></ul>
    </body></html>
  </xsl:template>
  <xsl:template match="outline:item">
    <li>
      <xsl:if test="@title!=''">
        <div><a>
          <xsl:if test="@link"><xsl:attribute name="href"><xsl:value-of select="@link"/></xsl:attribute></xsl:if>
          <xsl:if test="@backLink"><xsl:attribute name="name"><xsl:value-of select="@backLink"/></xsl:attribute></xsl:if>
          <xsl:value-of select="@title"/>
        </a><span> <xsl:value-of select="@page"/> </span></div>
      </xsl:if>
      <ul><xsl:comment>Keep an explicit closing tag for QtXmlPatterns</xsl:comment>
        <xsl:apply-templates select="outline:item"/>
      </ul>
    </li>
  </xsl:template>
</xsl:stylesheet>
`;

const license = `MIT License

Copyright (c) 2026 Poe Platform

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

export function informationText(action: string): string {
  if (action === "dump-default-toc-xsl") return defaultToc;
  if (action === "license") return license;
  if (action === "version") return "wkhtmltopdf safe static adapter (source 024b2b2bb459dd904d15b911d04c6df4ff2c9031; Qt compatibility unqualified)\n";
  const usage = "Usage: wkhtmltopdf [options] [page|cover input|toc]... output\nBuilt-in PDF AST static renderer; trusted overrides are optional. Input/output '-' use stdin/stdout.\n";
  if (action === "help" || action === "extended-help") return usage;
  const description = "wkhtmltopdf safe static adapter\n\n" + usage +
    "\nThe built-in PDF AST renderer converts static HTML by default; a trusted first-party renderer may override it.\n" +
    "TOC stylesheet export does not enable TOC conversion. Qt/WebKit compatibility is unqualified.\n" +
    "Paths use only the configured virtual filesystem. No native executable, ambient files or implicit network are used.\n" +
    "Information exports require no renderer and write UTF-8 to stdout. --license describes this adapter's MIT license.\n\n" +
    "Options (static means parser admission; rendering still requires a qualified binding):\n" +
    switches.map(option => option.name + (option.short ? ", -" + option.short : "") +
      " <arg>".repeat(option.arity) + " [" + option.scope + "; " + option.disposition + "]").join("\n") + "\n";
  if (action === "readme") return description;
  if (action === "manpage") return '.TH WKHTMLTOPDF 1\n.SH NAME\nwkhtmltopdf \\- safe static adapter\n.SH DESCRIPTION\n.nf\n' + description + '.fi\n';
  if (action === "htmldoc") {
    const escaped = description.split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;");
    return '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><title>wkhtmltopdf safe static adapter</title></head><body><pre>' + escaped + '</pre></body></html>\n';
  }
  throw new WkhtmltopdfError("UNSUPPORTED_CAPABILITY", "Unknown information action", action);
}
