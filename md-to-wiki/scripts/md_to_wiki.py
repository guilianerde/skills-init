#!/usr/bin/env python3
"""
Convert a local Markdown file to Confluence Storage Format XHTML.

Usage:
    python md_to_wiki.py <inputMd> <outputHtml> [--banner <bannerMdPath>] [--no-banner]

Output is a well-formed XHTML fragment suitable for Confluence's body.storage
representation. Code blocks are wrapped in <ac:structured-macro ac:name="code">.

This script does NOT call any wiki API — it only does local conversion.
Upload is handled by the caller (mcp__wiki-mcp__update_page).
"""
import argparse
import html
import os
import re
import sys

try:
    import markdown
except ImportError:
    print("ERROR: 'markdown' module not installed. Run: pip install markdown", file=sys.stderr)
    sys.exit(1)


def convert(md_path, out_path, banner_path=None, no_banner=False):
    with open(md_path, "r", encoding="utf-8") as f:
        md_text = f.read()

    # 1. Extract fenced code blocks so the markdown lib won't mangle them.
    code_blocks = []

    def _save_code_block(m):
        idx = len(code_blocks)
        lang = m.group(1) or ""
        raw = m.group(2)
        code_blocks.append((lang, raw))
        return f"@@CODEBLOCK_{idx}@@"

    pattern = re.compile(r"```(\w*)\n(.*?)```", re.DOTALL)
    md_text = pattern.sub(_save_code_block, md_text)

    # 2. Convert markdown → HTML.
    html_body = markdown.markdown(
        md_text,
        extensions=["tables", "sane_lists", "nl2br"],
        output_format="html5",
    )

    # 3. Restore code blocks as Confluence code macros.
    def _restore_code_block(m):
        idx = int(m.group(1))
        lang, raw = code_blocks[idx]
        # Escape CDATA terminator inside the code content.
        escaped = raw.replace("]]>", "]]]]><![CDATA[>")
        lang_param = (
            f'<ac:parameter ac:name="language">{html.escape(lang)}</ac:parameter>'
            if lang
            else ""
        )
        return (
            f'<ac:structured-macro ac:name="code" ac:schema-version="1">'
            f"{lang_param}"
            f"<ac:plain-text-body><![CDATA[{escaped}]]></ac:plain-text-body>"
            f"</ac:structured-macro>"
        )

    html_body = re.sub(r"@@CODEBLOCK_(\d+)@@", _restore_code_block, html_body)

    # 4. Fix XHTML well-formedness for Confluence Storage Format.
    html_body = re.sub(r"<br\s*>", "<br/>", html_body)
    html_body = re.sub(r"<hr\s*>", "<hr/>", html_body)
    html_body = re.sub(r"(<img[^>]*?)(?<!/)>", r"\1/>", html_body)
    # Drop auto-generated heading id="..." (Confluence generates its own anchors).
    html_body = re.sub(r'(<h[1-6])\s+id="[^"]*"', r"\1", html_body)

    # 5. Optional top info banner.
    banner_html = ""
    if not no_banner:
        if banner_path:
            if not os.path.exists(banner_path):
                print(f"WARN: banner file not found: {banner_path}, skipping banner", file=sys.stderr)
            else:
                with open(banner_path, "r", encoding="utf-8") as f:
                    banner_md = f.read()
                banner_inner = markdown.markdown(
                    banner_md, extensions=["tables", "sane_lists", "nl2br"]
                )
                banner_inner = re.sub(r"<br\s*>", "<br/>", banner_inner)
                banner_inner = re.sub(r"<hr\s*>", "<hr/>", banner_inner)
                banner_html = (
                    '<ac:structured-macro ac:name="info" ac:schema-version="1">'
                    "<ac:rich-text-body>"
                    f"{banner_inner}"
                    "</ac:rich-text-body>"
                    "</ac:structured-macro>"
                )
        else:
            # Auto-extract: use the first blockquote (lines starting with '>') as banner.
            lines = md_text.split("\n")
            bq_lines = []
            in_bq = False
            for ln in lines:
                if ln.startswith(">"):
                    bq_lines.append(ln[1:].lstrip())
                    in_bq = True
                elif in_bq and ln.strip() == "":
                    break
                elif in_bq:
                    break
            if bq_lines:
                banner_md = "\n".join(bq_lines)
                banner_inner = markdown.markdown(
                    banner_md, extensions=["tables", "sane_lists", "nl2br"]
                )
                banner_inner = re.sub(r"<br\s*>", "<br/>", banner_inner)
                banner_inner = re.sub(r"<hr\s*>", "<hr/>", banner_inner)
                banner_html = (
                    '<ac:structured-macro ac:name="info" ac:schema-version="1">'
                    "<ac:rich-text-body>"
                    f"{banner_inner}"
                    "</ac:rich-text-body>"
                    "</ac:structured-macro>"
                )

    final_html = banner_html + html_body

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(final_html)

    print(f"OK: wrote {len(final_html)} chars to {out_path}")
    if banner_html:
        print(f"  banner: {'from --banner file' if banner_path else 'auto-extracted from first blockquote'}")
    else:
        print("  banner: none")


def main():
    parser = argparse.ArgumentParser(
        description="Convert Markdown to Confluence Storage Format XHTML."
    )
    parser.add_argument("inputMd", help="Input Markdown file path")
    parser.add_argument("outputHtml", help="Output XHTML file path")
    parser.add_argument("--banner", dest="bannerMdPath", default=None,
                        help="Markdown file whose content is wrapped in an info macro banner")
    parser.add_argument("--no-banner", action="store_true",
                        help="Do not add a top info banner")
    args = parser.parse_args()

    if not os.path.exists(args.inputMd):
        print(f"ERROR: input markdown not found: {args.inputMd}", file=sys.stderr)
        sys.exit(1)

    convert(args.inputMd, args.outputHtml, args.bannerMdPath, args.no_banner)


if __name__ == "__main__":
    main()
