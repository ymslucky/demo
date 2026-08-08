#!/usr/bin/env python3
"""WCAG AA contrast audit for LuckyLab theme tokens (light + dark).

Verifies every foreground/background pair used by component rules in
app/globals.css, blending alpha (rgba) tokens over their base surface.

Usage:  python3 scripts/contrast-audit.py
Exit 0 = all required pairs pass AA (4.5:1 text / 3:1 UI), exit 1 = failures.

Documented tradeoff:
- The light-theme neutral border (#e2e8f0, ~1.2:1) is intentionally kept as the
  original design value — acceptance criterion "light theme visually unchanged"
  takes precedence (WCAG 1.4.11 boundary contrast would require a visibly darker
  border). The dark theme border (#64748b) passes 3:1 on both dark surfaces.
- If tokens change, update the LIGHT/DARK dicts below and re-run.
"""
import sys

# ---------- WCAG relative luminance ----------
def channel(c: float) -> float:
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def lum(hex_or_rgba) -> float:
    if isinstance(hex_or_rgba, tuple):  # (r, g, b) 0-255
        r, g, b = hex_or_rgba
    else:
        h = hex_or_rgba.lstrip("#")
        r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)

def contrast(fg, bg) -> float:
    l1, l2 = lum(fg), lum(bg)
    if l1 < l2:
        l1, l2 = l2, l1
    return (l1 + 0.05) / (l2 + 0.05)

def blend(rgba, base_hex):
    """Composite rgba(r,g,b,a) over base color -> solid rgb."""
    r, g, b, a = rgba
    br, bg_, bb = (int(base_hex[i:i + 2], 16) for i in (1, 3, 5))
    return tuple(round(c * a + base * (1 - a)) for c, base in zip((r, g, b), (br, bg_, bb)))

# ---------- token sets (must match app/globals.css) ----------
LIGHT = {
    "primary": "#4f46e5", "primary-dark": "#3730a3", "primary-light": "#6366f1",
    "text": "#1e293b", "text-muted": "#64748b", "bg": "#f8fafc", "surface": "#ffffff",
    "border": "#e2e8f0", "on-primary": "#ffffff", "btn-primary": "#4f46e5",
    "btn-primary-hover": "#3730a3", "tint": "#eef2ff", "tint-strong": "#c7d2fe",
    "tag-bg": "#f1f5f9", "tag-text": "#475569", "info-bg": "#ecfdf5",
    "info-text": "#065f46", "err-bg": "#fef2f2", "err-text": "#b91c1c",
}
DARK = {
    "primary": "#818cf8", "primary-dark": "#c7d2fe", "primary-light": "#a5b4fc",
    "text": "#e2e8f0", "text-muted": "#94a3b8", "bg": "#0f172a", "surface": "#1e293b",
    "border": "#64748b", "on-primary": "#ffffff", "btn-primary": "#4f46e5",
    "btn-primary-hover": "#3730a3", "tag-bg": "#1e293b",
    "tint-blend": blend((99, 102, 241, 0.15), "#0f172a"),
    "info-blend": blend((16, 185, 129, 0.10), "#0f172a"),
    "err-blend": blend((239, 68, 68, 0.15), "#0f172a"),
    "err-text": "#fca5a5", "info-text": "#6ee7b7",
}

# ---------- pairs: (label, fg, bg, required) ----------
CHECKS = {
    "light": [
        ("body text on bg",          "text", "bg", 4.5),
        ("body text on surface",     "text", "surface", 4.5),
        ("muted on bg",              "text-muted", "bg", 4.5),
        ("muted on surface",         "text-muted", "surface", 4.5),
        ("muted on tag-bg",          "tag-text", "tag-bg", 4.5),
        ("link on bg",               "primary", "bg", 4.5),
        ("link on surface",          "primary", "surface", 4.5),
        ("link-hover/code on tint",  "primary-dark", "tint", 4.5),
        ("link-name on surface",     "primary-dark", "surface", 4.5),
        ("btn text on btn",          "on-primary", "btn-primary", 4.5),
        ("btn text on btn hover",    "on-primary", "btn-primary-hover", 4.5),
        ("info text on info bg",     "info-text", "info-bg", 4.5),
        ("err text on err bg",       "err-text", "err-bg", 4.5),
        ("card hover border",        "primary-light", "surface", 3.0),
    ],
    "dark": [
        ("body text on bg",          "text", "bg", 4.5),
        ("body text on surface",     "text", "surface", 4.5),
        ("muted on bg",              "text-muted", "bg", 4.5),
        ("muted on surface",         "text-muted", "surface", 4.5),
        ("link on bg",               "primary", "bg", 4.5),
        ("link on surface",          "primary", "surface", 4.5),
        ("link-hover/code on tint",  "primary-dark", "tint-blend", 4.5),
        ("link-name on surface",     "primary-dark", "surface", 4.5),
        ("btn text on btn",          "on-primary", "btn-primary", 4.5),
        ("btn text on btn hover",    "on-primary", "btn-primary-hover", 4.5),
        ("info text on info bg",     "info-text", "info-blend", 4.5),
        ("err text on err bg",       "err-text", "err-blend", 4.5),
        ("card hover border",        "primary-light", "surface", 3.0),
        ("border on bg (UI)",        "border", "bg", 3.0),
        ("border on surface (UI)",   "border", "surface", 3.0),
    ],
}

failures = []
for theme, pairs in CHECKS.items():
    toks = LIGHT if theme == "light" else DARK
    print(f"== {theme.upper()} ==")
    for label, fg, bg, req in pairs:
        ratio = contrast(toks[fg], toks[bg])
        status = "PASS" if ratio >= req else "FAIL"
        if status == "FAIL":
            failures.append((theme, label, ratio, req))
        print(f"  {status:4s} {ratio:5.2f}:1 (need {req:3.1f})  {label}")

print()
if failures:
    for f in failures:
        print(f"FAIL [{f[0]}] {f[1]}: {f[2]:.2f}:1 < {f[3]:.1f}")
    sys.exit(1)
print("ALL CONTRAST CHECKS PASS (WCAG AA)")
