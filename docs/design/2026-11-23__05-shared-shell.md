# Design 05: the shell the five consoles share

ux.aws.a@SovereignWebsite.dinis, 23 Nov 2026. Designs 01 to 04 each assumed the same frame around a console: a twin bar, a console switcher, Ctrl+K, addresses, the account picker. This note specifies that frame once, so aws.c builds it once in index.html and app.js and every console (Files, Timeline, Map, Desk, Command) only fills the area inside it. Design only; the shell is aws.c's code.

## 1. What exists today (site/index.html on dev)

- `#twin-bar` (pack select, about, "See it in", Leave), then the identity card (`#avatar`, `#who`, Screenshot mode, Sign out, Forget this device), then `#tabs`, a `role="tablist"` with Accounts, S3, Plans and How it works, each a `role="tabpanel"` section.
- S3 has addresses since fe7170c (`#/s3/<bucket>/<path>`); the other tabs do not.
- At 390 px the twin bar and identity card push the first data below the fold (design 02, acceptance check 1, sherpa.aws.a walk 3).

## 2. The frame

```
+----------------------------------------------------------------------------------+
| [bar]  Twin · synthetic AWS · [pack v] · Copy link · Leave      (twin only)      |
+----------------------------------------------------------------------------------+
| [head] AWS Platform   Files Map Timeline Desk Command   [acct v] [Ctrl+K] [me v] |
+----------------------------------------------------------------------------------+
| [crumb] Files / demo-cloudfront-logs / cloudfront / 2026 / 11 / 22               |
+----------------------------------------------------------------------------------+
|                                                                                  |
|                         the console's own area                                   |
|                                                                                  |
+----------------------------------------------------------------------------------+
| [status] one line: what is loading, what just changed (aria-live="polite")       |
+----------------------------------------------------------------------------------+
```

Five parts, top to bottom:

1. **Bar** (twin or your own file only): one line, as design 02 rule 4. In real mode there is no bar; the header carries a small "Your AWS" label so the two modes never look alike.
2. **Head**: product name (home link), the five consoles as a `role="tablist"` (arrows move, Home and End, one tab stop: design 01 finding 15), the account picker, Ctrl+K, and a "me" menu holding identity, Screenshot mode, Sign out and Forget this device (design 01 finding 8). Accounts, Plans and How it works move into the "me" menu and Desk (Plans are Desk items), so the tab row is the five consoles only.
3. **Crumb**: where you are, built from the address, each part a link; "edit path" turns it into a text field (design 03). Every console has one, so Back and sharing behave the same everywhere.
4. **Console area**: the only part a console owns.
5. **Status line**: one place for "Listing...", "Applied in the twin (synthetic, not your AWS)", errors. Replaces status text scattered near buttons (design 01 finding 5).

## 3. Addresses

`#/<console>/<rest>`, one router in the shell, each console registers its prefix and parses only `<rest>`:

| Console | Example |
|---|---|
| files (the S3 browser grows into it; `#/s3/...` stays as an alias) | `#/files/<bucket>/<prefix>/` |
| timeline | `#/timeline/2026-11-22T09:00Z/2026-11-22T12:00Z` |
| map | `#/map/<node id>` |
| desk | `#/desk/<item id>` |
| command | `#/command` |

The account is never in the address (as s3.js today). With `?twin[&pack=]` in front, the same address works for anyone (design 02). The shell rejects an unknown console prefix with "No such place" and a link home; each console validates its own `<rest>` against its data before use.

## 4. Ctrl+K

One palette in the shell, available in every console: type to jump to a bucket, a role, a stack, an event, or run a command ("s3 ls", "who reads <bucket>"). Results come from what the consoles have already loaded (no extra AWS calls just to fill the palette), each result an address. Command (the fifth console) is the palette opened full-screen with history. Keyboard: Ctrl+K or `/` outside a text field opens it, Esc closes, Enter goes.

## 5. Phone, 390 px

```
+------------------------------+
| Twin · Normal day v · Leave  |
+------------------------------+
| Files v        [acct] [me v] |
+------------------------------+
| < cloudfront / 2026/11/22    |
+------------------------------+
|  the console's own area      |
|  starts here, above the fold |
+------------------------------+
```

Three lines of frame at most before data: the bar, the head (console menu instead of tabs, Ctrl+K as a search icon), the crumb as a Back link. This is the fix for design 02's acceptance check 1.

## 6. Order to build (each small, each landable alone)

1. The "me" menu: identity card folded into the head (fixes check 1 now, on the current tabs).
2. The status line, used by S3 first.
3. The router with `#/s3/` as the first registered prefix (already there in s3.js; move it up into the shell).
4. The tab row becomes the console row once a second console exists (Timeline or Files).
5. Ctrl+K last, when two consoles have data to search.

## 7. Security check of this note

Design only; no code changed. The router treats the hash as untrusted text: prefixes from a fixed list, the rest handed to the console which matches it against its own data; nothing from the hash is written as HTML or fetched. The palette searches only data already in the page and never sends what is typed anywhere. The "me" menu keeps Sign out and Forget this device one click away in real mode; in the twin they stay hidden (as today). No new origin, storage or cookie.
