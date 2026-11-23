#!/usr/bin/env python3
"""Five designs of aws.platform.sovereignweb.site/join/ (Join the beta). design.c@SovereignWebsite.dinis, round 1.
The words are read from site/join/index.html at build time, section by section, so they stay the keeper's own.
The console (the home page) is ux.aws's to design, by the split agreed on 23 November 2026; these are the join page only.
Usage: build.py <site dir>"""
import os, re, sys, html

SITE = sys.argv[1]
OUT = os.path.join(SITE, "designs")
HOST = "https://aws.platform.sovereignweb.site"
e = html.escape
SRC = open(os.path.join(SITE, "join", "index.html")).read()
MAIN = re.search(r'<main[^>]*>(.*?)</main>', SRC, re.S).group(1)
MARK = re.search(r'<div class="mark">(.*?)</div>', MAIN, re.S).group(1).strip()
H1 = re.search(r'<h1>(.*?)</h1>', MAIN, re.S).group(1).strip()
LEAD = re.search(r'<p class="lead">(.*?)</p>', MAIN, re.S).group(1).strip()
SMALL = re.search(r'<p class="small">(.*?)</p>', MAIN, re.S).group(1).strip()
SECTIONS = []
for m in re.finditer(r'<section class="card">\s*<h2>(.*?)</h2>(.*?)</section>', MAIN, re.S):
    body = m.group(2).strip().replace('href="../', 'href="/')
    SECTIONS.append((m.group(1).strip(), body))
SEC = {t: b for t, b in SECTIONS}
IDS = {"What you need": "need", "Set up, in about five minutes": "setup", "What the site can do in your account": "can",
       "What you are trusting": "trust", "Leaving": "leaving"}
assert set(IDS) == set(SEC), sorted(SEC)
DESIGNS = [
    (1, "Runbook", "An operations runbook: a contents rail, then the procedure in numbered sections, written to be followed."),
    (2, "Two Keys", "The two roles as two keys on the table: what each can open, set against what you are trusting."),
    (3, "Blueprint", "A blueprint, dark first: the path from your browser to your account drawn, the steps as its annotations."),
    (4, "Boarding", "Boarding in five minutes: the steps as a line of stops, what you need as the ticket, leaving as the exit."),
    (5, "Brief", "Everything on one plain page, for reading fast or printing."),
]
FAMILY = [("https://sovereignwebsite.ai/", "Sovereign Website"), ("https://sovereignwebsite.org/", "Principles"),
          ("https://sovereignwebsite.site/", "Hosted"), ("https://hub.sovereignweb.site/", "Hub"),
          ("https://agents.sovereignweb.site/", "Agents"), ("https://vault.sovereignwebsite.site/", "Vault"),
          ("https://agenticcells.ai/", "AgentiCCells"), ("https://riskmandate.ai/", "RiskMandate"),
          ("https://newsroom.sgit.ai/", "Newsroom")]
CSP = "default-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'"


def sec(title, h="h2", cls="sec"):
    return f'<section class="{cls}" id="{IDS[title]}" aria-labelledby="h-{IDS[title]}"><{h} id="h-{IDS[title]}">{title}</{h}>{SEC[title]}</section>'


BASE = """
*{box-sizing:border-box}
html{color-scheme:light dark;-webkit-text-size-adjust:100%}
body{margin:0;font:1.0625rem/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--fg);overflow-wrap:break-word}
a{color:var(--link)}
:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
.skip{position:absolute;left:-999px;top:.5rem;z-index:99;background:var(--bg);color:var(--fg);padding:.5rem .9rem;border:2px solid var(--focus)}
.skip:focus{left:1rem}
main *{min-width:0}
.chrome{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;justify-content:flex-end;position:relative;z-index:5;padding-top:.5rem}
.chrome .by{margin:0 auto 0 0;font-size:.9rem;color:var(--muted)}\n.chrome .by a{color:var(--fg)}\n.chrome details{position:relative}
.chrome summary{cursor:pointer;list-style:none;min-height:44px;display:inline-flex;align-items:center;padding:.35rem .8rem;border:1px solid var(--ctl);border-radius:999px;font-size:.9rem;background:var(--bg);color:var(--fg)}
.chrome summary::-webkit-details-marker{display:none}
.chrome summary::after{content:"";width:.45rem;height:.45rem;margin-left:.5rem;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(45deg) translateY(-2px)}
.chrome details[open] summary::after{transform:rotate(-135deg)}
.chrome ul{position:absolute;right:0;top:calc(100% + .35rem);margin:0;padding:.4rem;list-style:none;min-width:15rem;max-width:calc(100vw - 2rem);background:var(--bg);color:var(--fg);border:1px solid var(--ctl);border-radius:.6rem;box-shadow:0 .6rem 1.6rem rgba(0,0,0,.25)}
.chrome li a{display:block;padding:.55rem .7rem;border-radius:.4rem;color:var(--fg);text-decoration:none;font-size:.95rem}
.chrome li a:hover,.chrome li a:focus-visible{background:var(--hover)}
.chrome li a[aria-current]{font-weight:700;text-decoration:underline}
.chrome .gap{border-top:1px solid var(--ctl);margin-top:.3rem;padding-top:.3rem}
.chrome small{display:block;font-size:.85rem;color:var(--muted);font-weight:400}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.signin{display:grid;grid-template-columns:1fr auto auto;gap:.4rem .6rem;align-items:end;margin:1.25rem 0 .5rem}
.signin label{font-size:.9rem;color:var(--muted);grid-row:1}
.signin label[for=__none]{grid-column:2}
.signin input,.signin select,.signin button{font:inherit;font-size:1rem;padding:.55rem .7rem;border:1px solid var(--ctl);border-radius:6px;background:var(--field);color:var(--fg);min-height:44px}
.signin input{grid-column:1;grid-row:2}.signin select{grid-column:2;grid-row:2}
.signin button{grid-column:3;grid-row:2;background:var(--accent);color:var(--on-accent);border-color:var(--accent);font-weight:700;cursor:pointer}
@media (max-width:30rem){.signin{grid-template-columns:1fr auto}.signin button{grid-column:1/-1;grid-row:3}}
.status{font-weight:700;min-height:1.6em}
.note{font-size:.95rem;color:var(--muted)}
button.small,.out select{font:inherit;font-size:1rem;padding:.4rem .7rem;border:1px solid var(--ctl);border-radius:6px;background:var(--field);color:var(--link);font-weight:700;min-height:44px;cursor:pointer}
.out select{color:var(--fg);font-weight:400}
.out label{color:var(--muted)}
#forget{margin:.3rem 0}
.out h3{font-size:1.1rem;margin:1rem 0 .3rem}
.out table{border-collapse:collapse;width:100%;font-size:.95rem}
.out caption{text-align:left;font-weight:700;padding:.4rem 0}
.out th,.out td{text-align:left;vertical-align:top;padding:.45rem .6rem;border-bottom:1px solid var(--line);overflow-wrap:anywhere}
.out thead th{color:var(--muted);font-size:.9rem}
.scroll{overflow-x:auto;margin:1rem 0}
.out table{border-collapse:collapse;width:100%;font-size:.95rem}
.out caption{text-align:left;font-weight:700;padding:.4rem 0}
.out th,.out td{text-align:left;vertical-align:top;padding:.45rem .6rem;border-bottom:1px solid var(--line)}
.out thead th{color:var(--muted);font-size:.9rem}
.out th .sub{display:block;font-weight:400;color:var(--muted);font-size:.875rem}
.out tr.group th{background:var(--hover);font-size:.875rem;letter-spacing:.06em;text-transform:uppercase}
.out td.vals{white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
.out td.ok{color:var(--ok);font-weight:700;white-space:nowrap}
.out td.bad{color:var(--bad);font-weight:700}
.out td.num{text-align:right;font-variant-numeric:tabular-nums}
.sent{font-size:.9rem;color:var(--muted)}
footer{padding:2rem 0 3rem;font-size:.95rem}
footer nav{display:flex;flex-wrap:wrap;gap:.25rem 1.25rem}
footer nav a{min-height:44px;display:inline-flex;align-items:center}
@media print{.chrome,.skip,.signin,#forget{display:none}}
"""


def head(n, css):
    name, idea = (DESIGNS[n - 1][1], DESIGNS[n - 1][2]) if n else ("", "")
    title = f"{name}, design {n} of Join the beta, AWS Platform" if n else "Five designs, Join the beta, AWS Platform"
    desc = (f"Design {n} of aws.platform.sovereignweb.site/join/, {name}: {idea}" if n else
            "Five designs of the AWS Platform join page, the same words in five ideas, side by side.")
    url = f"{HOST}/designs/{n}/" if n else f"{HOST}/designs/"
    img = f"{HOST}/assets/share/card-1200x630.jpg"
    return f"""<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta http-equiv="Content-Security-Policy" content="{CSP}">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="AWS Platform">
<meta property="og:locale" content="en_GB">
<meta property="og:url" content="{url}">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:image" content="{img}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="AWS Platform">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{e(title)}">
<meta name="twitter:description" content="{e(desc)}">
<meta name="twitter:image" content="{img}">
<link rel="canonical" href="{url}">
<style>{BASE}{css}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
"""


def chrome(n):
    d = "".join(f'<li><a href="/designs/{i}/"{" aria-current=\"page\"" if i == n else ""}>{i}. {nm}<small>{idea}</small></a></li>' for i, nm, idea in DESIGNS)
    fam = "".join(f'<li><a href="{u}">{t}</a></li>' for u, t in FAMILY)
    return f"""<nav class="chrome" aria-label="Designs and the Sovereign Website family">\n<p class="by"><a href="/">AWS Platform</a> · join page</p>
<details><summary>Choose a design</summary><ul>{d}<li class="gap"><a href="/designs/">All five, side by side</a></li><li><a href="/">The site as it is now</a></li></ul></details>
<details><summary>Sovereign Website</summary><ul><li><a href="/start/">Start here</a></li><li><a href="/agents/">Use with your AI</a></li><li><a href="/admin/">How this site was made</a></li><li class="gap"><a href="/policy/">How this site is governed</a></li>{fam}</ul></details>
</nav>"""


def own(cls="own"):
    return f'<nav class="{cls}" aria-label="This site"><a href="#need">What you need</a><a href="#setup">Set up</a><a href="#leaving">Leaving</a><a href="/start/">Start here</a><a href="/agents/">Use with your AI</a></nav>'


def ul(items, cls="plain"):
    return f'<ul class="{cls}">' + "".join(f"<li>{x}</li>" for x in items) + "</ul>"


def footer():
    return f"""<footer>
<nav aria-label="About this site"><a href="/start/">Start here</a> <a href="/agents/">Use with your AI</a> <a href="/admin/">How this site was made</a> <a href="/policy/">How this site is governed</a></nav>
<p>A sovereign website, made with the <a href="https://sovereignwebsite.org/">open pattern</a>. Source: <a href="https://github.com/SovereignWebsite/Site__Platform__AWS">github.com/SovereignWebsite/Site__Platform__AWS</a>.</p>
</footer>
</body>
</html>
"""



DOC = """
.sec ul,.sec ol{padding-left:1.3rem}.sec li{margin:.45rem 0}
.sec h3{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:1rem;margin:1.1rem 0 .3rem}
.sec code{background:var(--hover);padding:.05rem .3rem;border-radius:.25rem}
.small{color:var(--muted);font-size:.95rem}
"""
NAMES = list(IDS)

# ---------------------------------------------------------------- 1. Runbook
CSS1 = DOC + """
:root{--bg:#f6f7f8;--fg:#14181c;--muted:#4a525b;--link:#0b5394;--focus:#0b5394;--ctl:#6c757f;--hover:#e6e9ec;--field:#fff;--accent:#0b5394;--on-accent:#fff;--line:#d3d8dd;--ok:#1d6b45;--bad:#a13a2a;--page:#ffffff}
@media (prefers-color-scheme:dark){:root{--bg:#0f1215;--fg:#e9edf0;--muted:#adb6bf;--link:#8cc4ff;--focus:#8cc4ff;--ctl:#7b858f;--hover:#1b2026;--field:#151a1f;--accent:#8cc4ff;--on-accent:#06121c;--line:#29313a;--ok:#86ddb3;--bad:#ff9b8a;--page:#151a1f}}
.wrap{max-width:76rem;margin:0 auto;padding:0 1rem}
.mast{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:.5rem 1rem;padding:.5rem 0}
.brand{font:800 1.1rem ui-monospace,Menlo,Consolas,monospace;color:var(--fg);text-decoration:none;min-height:44px;display:inline-flex;align-items:center}
.own{display:flex;flex-wrap:wrap;gap:.25rem 1rem;font-size:.95rem}.own a{color:var(--fg);min-height:44px;display:inline-flex;align-items:center}
.book{display:grid;gap:2rem;grid-template-columns:1fr;padding:1.5rem 0}
@media (min-width:58rem){.book{grid-template-columns:15rem 1fr}.toc{position:sticky;top:1rem;align-self:start}}
.toc{font-size:.95rem;order:2}
@media (min-width:58rem){.toc{order:0}}
.toc p{font:700 .85rem ui-monospace,Menlo,Consolas,monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin:0 0 .4rem}
.toc ol{list-style:none;margin:0;padding:0;counter-reset:t}
.toc li{counter-increment:t}
.toc a{display:flex;gap:.5rem;min-height:44px;align-items:center;color:var(--fg);text-decoration:none;border-left:3px solid var(--line);padding-left:.6rem}
.toc a::before{content:counter(t) ".";font-family:ui-monospace,Menlo,Consolas,monospace;color:var(--muted)}
.toc a:hover{border-left-color:var(--accent)}
.k{font:700 .85rem ui-monospace,Menlo,Consolas,monospace;letter-spacing:.1em;color:var(--muted);margin:0}
h1{font-size:clamp(2.1rem,6vw,3.4rem);line-height:1.05;margin:.3rem 0 1rem}
.lead{font-size:1.1rem;max-width:46rem}
.body{counter-reset:s}
.sec{counter-increment:s;background:var(--page);border:1px solid var(--line);border-radius:.5rem;padding:1.1rem 1.3rem;margin:1rem 0}
.sec>h2{font-size:1.35rem;margin:0 0 .4rem}
.sec>h2::before{content:counter(s) ". ";font-family:ui-monospace,Menlo,Consolas,monospace;color:var(--accent)}
footer{border-top:1px solid var(--line)}
"""


def d1():
    toc = "".join(f'<li><a href="#{IDS[t]}">{t}</a></li>' for t in NAMES)
    return head(1, CSS1) + f"""<div class="wrap">{chrome(1)}
<header class="mast"><a class="brand" href="/">AWS Platform</a>{own()}</header>
<main id="main"><div class="book">
<nav class="toc" aria-label="Runbook contents"><p>Runbook</p><ol>{toc}</ol></nav>
<div class="body"><p class="k">{MARK}</p><h1>{H1}</h1><p class="lead">{LEAD}</p>
{''.join(sec(t) for t in NAMES)}
<p class="small">{SMALL}</p></div></div></main>
""" + footer().replace("</body>", "</div></body>")


# ---------------------------------------------------------------- 2. Two Keys
CSS2 = DOC + """
:root{--bg:#f7f4ee;--fg:#1d1a15;--muted:#565046;--link:#7a3e12;--focus:#7a3e12;--ctl:#7d776c;--hover:#ece6da;--field:#fff;--accent:#7a3e12;--on-accent:#fff;--line:#dbd3c4;--ok:#1d6b45;--bad:#a13a2a;--read:#e6efe9;--change:#f6e4d6;--card:#fffdf8}
@media (prefers-color-scheme:dark){:root{--bg:#15130f;--fg:#efe9de;--muted:#c0b8a8;--link:#f0b27a;--focus:#f0b27a;--ctl:#8b8476;--hover:#24211b;--field:#1d1a15;--accent:#f0b27a;--on-accent:#1a0f06;--line:#3a352c;--ok:#86ddb3;--bad:#ff9b8a;--read:#17231c;--change:#2a1d14;--card:#1d1a15}}
.wrap{max-width:72rem;margin:0 auto;padding:0 1rem}
.mast{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:.5rem 1rem;padding:.5rem 0}
.brand{font:700 1.25rem Georgia,"Iowan Old Style","Times New Roman",serif;color:var(--fg);text-decoration:none;min-height:44px;display:inline-flex;align-items:center}
.own{display:flex;flex-wrap:wrap;gap:.25rem 1rem;font-size:.95rem}.own a{color:var(--fg);min-height:44px;display:inline-flex;align-items:center}
h1,h2{font-family:Georgia,"Iowan Old Style","Times New Roman",serif}
.k{font-size:.85rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:1.5rem 0 .3rem}
h1{font-size:clamp(2.2rem,6.4vw,4rem);line-height:1.02;margin:0 0 1rem}
.lead{font-size:1.12rem;max-width:46rem}
.table{display:grid;gap:1.25rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,24rem),1fr));margin:2rem 0}
.keyc{border-radius:1.2rem 1.2rem 1.2rem 3.5rem;padding:1.3rem 1.3rem 1.3rem 1.6rem;border:2px solid var(--fg)}
.keyc.can{background:var(--read)}.keyc.trust{background:var(--change)}
.keyc>h2{font-size:1.6rem;margin:0 0 .5rem}
.rest .sec{background:var(--card);border:1px solid var(--line);border-radius:.6rem;padding:1.1rem 1.3rem;margin:1rem 0}
.rest .sec>h2{font-size:1.4rem;margin:0 0 .4rem}
footer{border-top:1px solid var(--line)}
"""


def d2():
    return head(2, CSS2) + f"""<div class="wrap">{chrome(2)}
<header class="mast"><a class="brand" href="/">AWS Platform</a>{own()}</header>
<main id="main"><p class="k">{MARK}</p><h1>{H1}</h1><p class="lead">{LEAD}</p>
<div class="table">{sec("What the site can do in your account", cls="sec keyc can")}{sec("What you are trusting", cls="sec keyc trust")}</div>
<div class="rest">{sec("What you need")}{sec("Set up, in about five minutes")}{sec("Leaving")}</div>
<p class="small">{SMALL}</p></main>
""" + footer().replace("</body>", "</div></body>")


# ---------------------------------------------------------------- 3. Blueprint (dark first, way out there)
CSS3 = DOC + """
:root{--bg:#0b1f3a;--fg:#eaf2ff;--muted:#b9cbe6;--link:#ffe08a;--focus:#ffe08a;--ctl:#8aa3c7;--hover:#14305a;--field:#0f2647;--accent:#ffe08a;--on-accent:#1a1400;--line:#2f5083;--ok:#86ddb3;--bad:#ff9b8a;--grid:rgba(185,203,230,.12)}
@media (prefers-color-scheme:light){:root{--bg:#eef4fb;--fg:#0b1f3a;--muted:#3e5373;--link:#0b4f8a;--focus:#0b4f8a;--ctl:#6a7f9c;--hover:#dbe6f3;--field:#fff;--accent:#0b4f8a;--on-accent:#fff;--line:#a9bdd8;--ok:#1d6b45;--bad:#a13a2a;--grid:rgba(11,31,58,.08)}}
body{background-image:linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px);background-size:24px 24px}
.wrap{max-width:78rem;margin:0 auto;padding:0 1rem}
.mast{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:.5rem 1rem;padding:.5rem 0}
.brand{font:800 1.1rem ui-monospace,Menlo,Consolas,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--fg);text-decoration:none;min-height:44px;display:inline-flex;align-items:center}
.own{display:flex;flex-wrap:wrap;gap:.25rem 1rem;font-size:.95rem}.own a{color:var(--fg);min-height:44px;display:inline-flex;align-items:center}
.k{font:700 .85rem ui-monospace,Menlo,Consolas,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin:1.5rem 0 .3rem}
h1{font-size:clamp(2.2rem,6.4vw,4rem);line-height:1.02;margin:0 0 1rem;letter-spacing:-.02em}
.lead{font-size:1.1rem;max-width:46rem}
.flow{list-style:none;margin:2rem 0;padding:0;display:grid;gap:.75rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,11rem),1fr))}
.flow li{border:2px solid var(--fg);padding:.8rem;position:relative;background:var(--bg)}
.flow li b{display:block;font:800 .9rem ui-monospace,Menlo,Consolas,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}
.flow small{display:block;color:var(--muted);font-size:.95rem;margin-top:.2rem}
.sheets{display:grid;gap:1.25rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,26rem),1fr));margin-bottom:2rem}
.sec{border:1px dashed var(--ctl);padding:1.1rem 1.3rem;background:var(--bg)}
.sec>h2{font:800 1rem ui-monospace,Menlo,Consolas,monospace;letter-spacing:.12em;text-transform:uppercase;margin:0 0 .5rem;color:var(--accent)}
footer{border-top:1px solid var(--line)}
"""


def d3():
    flow = ('<ol class="flow" aria-label="The path, in four parts">'
            '<li><b>Your browser</b><small>Signs in with Google; the page runs here, with no server.</small></li>'
            '<li><b>AWS STS</b><small>Gives the page credentials for one hour.</small></li>'
            '<li><b>Your two roles</b><small>sws-aws-platform-read and sws-aws-platform-change, from the template.</small></li>'
            '<li><b>Plans you approve</b><small>Nothing changes until you press Approve.</small></li></ol>')
    return head(3, CSS3) + f"""<div class="wrap">{chrome(3)}
<header class="mast"><a class="brand" href="/">AWS Platform</a>{own()}</header>
<main id="main"><p class="k">{MARK}</p><h1>{H1}</h1><p class="lead">{LEAD}</p>
{flow}
<div class="sheets">{''.join(sec(t) for t in NAMES)}</div>
<p class="small">{SMALL}</p></main>
""" + footer().replace("</body>", "</div></body>")


# ---------------------------------------------------------------- 4. Boarding
CSS4 = DOC + """
:root{--bg:#f3f6f2;--fg:#122014;--muted:#465448;--link:#14663f;--focus:#14663f;--ctl:#6f7b73;--hover:#e1e8e2;--field:#fff;--accent:#14663f;--on-accent:#fff;--line:#cfd9d1;--ok:#14663f;--bad:#a13a2a;--ticket:#ffffff}
@media (prefers-color-scheme:dark){:root{--bg:#0d120f;--fg:#e9f0eb;--muted:#b0bdb4;--link:#86ddb3;--focus:#86ddb3;--ctl:#7b877f;--hover:#18211b;--field:#131a15;--accent:#86ddb3;--on-accent:#08140d;--line:#29342c;--ok:#86ddb3;--bad:#ff9b8a;--ticket:#131a15}}
.wrap{max-width:72rem;margin:0 auto;padding:0 1rem}
.mast{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:.5rem 1rem;padding:.5rem 0}
.brand{font-weight:800;font-size:1.2rem;color:var(--fg);text-decoration:none;min-height:44px;display:inline-flex;align-items:center}
.own{display:flex;flex-wrap:wrap;gap:.25rem 1rem;font-size:.95rem}.own a{color:var(--fg);min-height:44px;display:inline-flex;align-items:center}
.hero{display:grid;gap:1.5rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,24rem),1fr));padding:1.5rem 0;align-items:start}
.k{font-size:.85rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:0 0 .3rem}
h1{font-size:clamp(2.1rem,6vw,3.6rem);line-height:1.05;margin:0 0 1rem;letter-spacing:-.02em}
.ticket{background:var(--ticket);border:2px dashed var(--accent);border-radius:1rem;padding:1.1rem 1.3rem}
.ticket>h2{font-size:1.3rem;margin:0 0 .4rem}
.line .sec>h2{font-size:clamp(1.45rem,3.4vw,2rem);margin:1rem 0 .5rem}
.line .steps{list-style:none;padding:0;counter-reset:st;position:relative}
.line .steps>li{counter-increment:st;position:relative;padding:0 0 1.2rem 3.2rem;margin:0}
.line .steps>li::before{content:counter(st);position:absolute;left:0;top:0;width:2.2rem;height:2.2rem;border-radius:50%;background:var(--accent);color:var(--on-accent);display:grid;place-items:center;font-weight:800}
.line .steps>li:not(:last-child)::after{content:"";position:absolute;left:1.05rem;top:2.3rem;bottom:.1rem;width:3px;background:var(--line)}
.rest{display:grid;gap:1.25rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,22rem),1fr));margin:1rem 0 2rem}
.rest .sec{background:var(--ticket);border:1px solid var(--line);border-radius:.8rem;padding:1.1rem 1.3rem}
.rest .sec>h2{font-size:1.3rem;margin:0 0 .4rem}
.rest #leaving{border-color:var(--accent)}
footer{border-top:1px solid var(--line)}
"""


def d4():
    return head(4, CSS4) + f"""<div class="wrap">{chrome(4)}
<header class="mast"><a class="brand" href="/">AWS Platform</a>{own()}</header>
<main id="main"><div class="hero"><div><p class="k">{MARK}</p><h1>{H1}</h1><p>{LEAD}</p></div>{sec("What you need", cls="sec ticket")}</div>
<div class="line">{sec("Set up, in about five minutes")}</div>
<div class="rest">{sec("What the site can do in your account")}{sec("What you are trusting")}{sec("Leaving")}</div>
<p class="small">{SMALL}</p></main>
""" + footer().replace("</body>", "</div></body>")


# ---------------------------------------------------------------- 5. Brief
CSS5 = DOC + """
:root{--bg:#ffffff;--fg:#111111;--muted:#4a4a4a;--link:#0b4f8a;--focus:#0b4f8a;--ctl:#767676;--hover:#f0f0f0;--field:#ffffff;--accent:#0b4f8a;--on-accent:#ffffff;--line:#d6d6d6;--ok:#1d6b45;--bad:#a13a2a}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--fg:#f1f1f1;--muted:#bdbdbd;--link:#8cc4ff;--focus:#8cc4ff;--ctl:#8a8a8a;--hover:#222;--field:#1a1a1a;--accent:#8cc4ff;--on-accent:#0b0b0b;--line:#333;--ok:#86ddb3;--bad:#ff9b8a}}
.wrap{max-width:42rem;margin:0 auto;padding:0 1rem}
.brand{font:700 1.1rem Georgia,"Times New Roman",serif;color:var(--fg);text-decoration:none;min-height:44px;display:inline-flex;align-items:center}
.own{display:flex;flex-wrap:wrap;gap:0 1rem;font-size:.95rem}.own a{min-height:44px;display:inline-flex;align-items:center}
h1{font:700 clamp(2rem,6vw,2.6rem)/1.15 Georgia,serif;margin:1.25rem 0 .75rem}
.sec>h2{font:700 1.45rem Georgia,serif;margin:2rem 0 .4rem;padding-top:1rem;border-top:1px solid var(--line)}
footer{border-top:1px solid var(--line);margin-top:2rem}
"""


def d5():
    return head(5, CSS5) + f"""<div class="wrap">{chrome(5)}
<header><a class="brand" href="/">AWS Platform</a>{own()}</header>
<main id="main"><p>{MARK}</p><h1>{H1}</h1><p>{LEAD}</p>{''.join(sec(t) for t in NAMES)}<p class="small">{SMALL}</p></main>
""" + footer().replace("</body>", "</div></body>")


CSSI = """
:root{--bg:#f6f5f2;--fg:#151515;--muted:#4f4c47;--link:#0b5394;--focus:#0b5394;--ctl:#77736c;--hover:#e9e6df;--card:#fff;--line:#dcd8cf;--field:#fff;--accent:#0b5394;--on-accent:#fff;--ok:#1d6b45;--bad:#a13a2a}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--fg:#efede8;--muted:#bdb9b1;--link:#8cc4ff;--focus:#8cc4ff;--ctl:#85817a;--hover:#222;--card:#1c1c1c;--line:#333;--field:#1a1a1a;--accent:#8cc4ff;--on-accent:#06121c;--ok:#86ddb3;--bad:#ff9b8a}}
.wrap{max-width:76rem;margin:0 auto;padding:0 1rem}
.brand{font-weight:800;color:var(--fg);text-decoration:none;min-height:44px;display:inline-flex;align-items:center}
h1{font:700 clamp(2rem,5.5vw,3rem)/1.1 Georgia,serif;margin:1rem 0 .75rem}
.cards{list-style:none;margin:1.5rem 0 3rem;padding:0;display:grid;gap:1.25rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,20rem),1fr))}
.cards li{background:var(--card);border:1px solid var(--line);border-radius:.6rem;overflow:hidden}
.cards img{display:block;max-width:100%;height:auto;aspect-ratio:16/10;object-fit:cover;object-position:top;width:100%;border-bottom:1px solid var(--line)}
.cards .b{padding:1rem}.cards h2{font-size:1.2rem;margin:0 0 .3rem}.cards p{margin:.3rem 0}
footer{border-top:1px solid var(--line)}
"""


def index(rec):
    cards = "".join(f'<li><img src="/designs/{i}/shot-1366.webp" alt="Design {i}, {nm}, at desktop width" width="1366" height="854" loading="lazy"><div class="b"><h2><a href="/designs/{i}/">{i}. {nm}</a></h2><p>{idea}</p>{"<p><strong>Recommended by the designer.</strong></p>" if i == rec else ""}</div></li>' for i, nm, idea in DESIGNS)
    return head(0, CSSI) + f"""<div class="wrap">{chrome(0)}
<header><a class="brand" href="/">AWS Platform</a></header>
<main id="main"><h1>Five designs of the join page</h1>
<p>The same words as <a href="/join/">Join the beta</a>, in five ideas. The console itself is designed by the platform's own UX agent; these cover the join page only. The owner picks one; the keeper makes it the page.</p>
<ul class="cards">{cards}</ul></main>
""" + footer().replace("</body>", "</div></body>")


if __name__ == "__main__":
    for i, f in {1: d1, 2: d2, 3: d3, 4: d4, 5: d5}.items():
        os.makedirs(f"{OUT}/{i}", exist_ok=True)
        open(f"{OUT}/{i}/index.html", "w").write(f())
    open(f"{OUT}/index.html", "w").write(index(int(os.environ.get("RECOMMEND", "2"))))
    print("built", OUT, "sections", len(SECTIONS))
