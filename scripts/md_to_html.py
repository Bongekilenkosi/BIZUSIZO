#!/usr/bin/env python
"""
Simple markdown → styled HTML converter for Bizusizo documents.

Usage:
    python scripts/md_to_html.py <input.md> [output.html]

The output HTML is print-ready — open it in Chrome/Edge/Firefox
and use Ctrl+P → "Save as PDF" for a clean PDF export.

Styling is tuned for academic / clinical-paper formatting:
- Readable body typography (Georgia / Times fallback)
- Proper table borders and spacing
- Sensible margins for A4 printing
- Heading hierarchy with reasonable sizes
- Code / monospace blocks with subtle background
"""

import sys
from pathlib import Path
import markdown

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>{title}</title>
<style>
@page {{ size: A4; margin: 20mm 18mm 22mm 18mm; }}
html {{ font-size: 11pt; }}
body {{
    font-family: Georgia, "Times New Roman", serif;
    line-height: 1.55;
    color: #222;
    max-width: 180mm;
    margin: 0 auto;
    padding: 10mm 0;
}}
h1 {{ font-size: 18pt; margin-top: 0; border-bottom: 2px solid #333; padding-bottom: 6pt; }}
h2 {{ font-size: 14pt; margin-top: 18pt; border-bottom: 1px solid #999; padding-bottom: 3pt; }}
h3 {{ font-size: 12pt; margin-top: 14pt; }}
h4 {{ font-size: 11pt; margin-top: 12pt; font-style: italic; font-weight: normal; }}
p {{ margin: 6pt 0; text-align: justify; }}
ul, ol {{ margin: 6pt 0 6pt 20pt; }}
li {{ margin-bottom: 2pt; }}
strong {{ font-weight: 600; }}
em {{ font-style: italic; }}
blockquote {{
    border-left: 3px solid #999;
    padding-left: 12pt;
    color: #555;
    margin: 8pt 0;
    font-style: italic;
}}
code {{
    font-family: "Consolas", "Courier New", monospace;
    font-size: 10pt;
    background: #f4f4f4;
    padding: 1px 4px;
    border-radius: 2px;
}}
pre {{
    background: #f4f4f4;
    padding: 8pt 10pt;
    border-radius: 3px;
    overflow-x: auto;
    font-size: 9.5pt;
    line-height: 1.4;
}}
pre code {{ background: none; padding: 0; }}
table {{
    border-collapse: collapse;
    margin: 10pt 0;
    width: 100%;
    font-size: 10pt;
}}
th, td {{
    border: 1px solid #999;
    padding: 4pt 8pt;
    text-align: left;
    vertical-align: top;
}}
th {{ background: #e8e8e8; font-weight: 600; }}
tr:nth-child(even) td {{ background: #f9f9f9; }}
hr {{ border: none; border-top: 1px solid #ccc; margin: 18pt 0; }}
a {{ color: #0b5ed7; text-decoration: none; }}
a:hover {{ text-decoration: underline; }}
@media print {{
    body {{ padding: 0; }}
    h1, h2, h3 {{ page-break-after: avoid; }}
    table, pre, blockquote {{ page-break-inside: avoid; }}
}}
.print-hint {{
    background: #fffbd7;
    border: 1px solid #e0c97a;
    padding: 8pt 12pt;
    margin-bottom: 14pt;
    border-radius: 3px;
    font-size: 10pt;
}}
@media print {{ .print-hint {{ display: none; }} }}
</style>
</head>
<body>
<div class="print-hint">
<strong>To save as PDF:</strong> press <kbd>Ctrl</kbd>+<kbd>P</kbd>, choose "Save as PDF" as the destination, and print. This banner will not appear in the PDF.
</div>
{body}
</body>
</html>
"""


def convert(md_path: Path, out_path: Path) -> None:
    md_text = md_path.read_text(encoding="utf-8")
    html_body = markdown.markdown(
        md_text,
        extensions=["tables", "fenced_code", "sane_lists", "nl2br"],
    )
    title = md_path.stem.replace("_", " ").title()
    out_path.write_text(HTML_TEMPLATE.format(title=title, body=html_body), encoding="utf-8")


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python scripts/md_to_html.py <input.md> [output.html]", file=sys.stderr)
        sys.exit(1)

    md_path = Path(sys.argv[1]).resolve()
    if not md_path.exists():
        print(f"Input not found: {md_path}", file=sys.stderr)
        sys.exit(1)

    out_path = Path(sys.argv[2]).resolve() if len(sys.argv) >= 3 else md_path.with_suffix(".html")
    convert(md_path, out_path)
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
