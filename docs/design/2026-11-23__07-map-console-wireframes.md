# Design 07: Map console wireframes on the twin

ux.aws.a@SovereignWebsite.dinis, 23 Nov 2026 ~16:45 UTC. The Map console from design 01 ("What is connected to what?"), inside design 05's shell, on the twin first. Design only. The code is aws.c's (shell) and dev.2.aws.a's (site/api/graph.js).

Sources read (material):
- the graph builder in the page, site/api/graph.js on dev (461d422);
- ontology.aws.a's twin graph, schema, `explain.mjs` and `type-labels.json` (work/ontology.aws.a, 59cc012; 54 nodes, 106 edges on the baseline pack; dev's older copy has 47 and 96);
- the ontology note, sections 5 (altitudes) and 6 (findings) (docs/ontology/2026-11-23__01-resource-ontology.md);
- security R-020 as graph.js applies it (verified, claimed, curated).

Facts checked against those files, not remembered: altitudes A0 to A5; on the work-branch baseline A1 has 20 nodes, A2 18, A3 1, A4 12, A5 3; six evidence levels (api, template, content, naming, comment, curated); three trust marks in `explain.mjs` (none, `?`, `~`).

## 1. The idea: a card first, a picture second

A graph of 54 nodes drawn at once is a hairball, and a real account will have thousands. So the Map opens on **one node and its neighbours, as a list you can read** (the "connected to" panel `explain.mjs` already prints). The picture is one hop around that node, drawn beside the list. The list is the console. The picture helps you see shape, and is never the only way to reach something (design 01: every visual has a flat, keyboard-usable equivalent).

## 2. Desktop

```
+----------------------------------------------------------------------------------+
| Twin · synthetic AWS · [baseline v] · Copy link · Leave                          |
| AWS Platform   Files [Map] Timeline Desk Command      [111122223333 v] [Ctrl+K] [me]|
| Map / eu-west-2 / 111122223333--demo-cloudfront-logs--eu-west-2                   |
+---------------+-----------------------------------------+------------------------+
| Altitude      | File store  (S3 bucket)   ✓ AWS confirmed| [one-hop picture]      |
|  A5 Purpose 3 | 111122223333--demo-cloudfront-logs--...  |                        |
|  A4 Actors 12 | eu-west-2 · 225 requests · 148 visitors  |      (stream)          |
|  A3 Systems 1 | [Open in Files] [Timeline for this]      |         |              |
| >A2 Resources | -----------------------------------------|   (site)-[BUCKET]-(eu-w2)|
|  A1 Records 20| Receives from                            |         |              |
|               |   demo-cloudfront-logs (Log conveyor) ✓  |    (9 objects)         |
| Worth a look 3|     AWS answered: Firehose Describe...   |                        |
|  ! 0 dangling | Is in                                    | ✓ confirmed            |
|  ! 44 unowned | . eu-west-2 ✓                            | ? claimed  (dashed)    |
|  ? 11 by name | Holds                                    | ~ curated  (dotted)    |
|               |   9 log files, 20 to 22 Nov  [list]  ✓   |                        |
|               | Is named in                              |                        |
|               |   config/site.yaml  ? read from a file   |                        |
|               | Is part of                               |                        |
|               |   Demo site  ~ the ontologist's word     |                        |
+---------------+-----------------------------------------+------------------------+
| Graph: 54 nodes, 106 edges, twin baseline. Built in this page; nothing stored.   |
+----------------------------------------------------------------------------------+
```

Three columns:

1. **Altitude ladder** (left). It shows A5 to A1, using the ontology's words in plain English (Purpose, Actors, Systems, Resources, Records), each with its count. Choosing one lists every node at that altitude, grouped by type and using the short labels from `type-labels.json` ("File store", "Log conveyor", "Permission badge"), with the AWS name second. A0 (fields) never gets its own list: fields show inside a record's card. Below the ladder is **Worth a look** (section 5).
2. **The card** (centre). The node's plain label, its AWS type, its trust and a one-line summary from its attributes. Then two buttons into the other consoles: Files for buckets, objects and prefixes, and Timeline for anything with events. Below that come its neighbours, **grouped by relation and read from this node's side** (`explain.mjs`'s READ table: "receives from", "is in", "holds", "is named in", "is part of"). Each neighbour is a link that moves the card to it. Each line says how we know, in words ("AWS answered: ...", "read from a file", "the ontologist's word").
3. **The picture** (right). It shows this node and its direct neighbours only, laid out as a ring, with a legend. A solid line means confirmed, dashed means claimed and dotted means curated, so trust is never shown by colour alone. Clicking a neighbour moves the card. More than 12 neighbours of one kind become one bubble ("9 objects"), as graph.js already groups folders of more than 50 objects.

### Grouping long lists

A relation with more than five neighbours of one type shows a count and a summary. For example, "Holds 9 log files, 20 to 22 Nov" with a [list] button, which expands in place, 50 at a time. This follows `explain.mjs`'s "holds 9 objects: first ... last".

### Walking altitudes

`part_of` and `records` cross altitudes (ontology section 5). The card shows them under their relation like any other, and also as two keys. **U** goes to the neighbours at a higher altitude and **D** to those at a lower one, along `part_of` or `records` **in either direction**, judged by the nodes' altitudes, not by the edge's direction. That is the memo's "link mode": from a business function down to the log lines, or from an address up to what it did.

Why either direction: on the twin today, the business function "A visitor reads a vault's files" (A5) and both vaults (A5) are `part_of` the Demo site (A3), so following `part_of` upwards from the site finds nothing. Asked of ontology.aws.a (section 10) whether those edges should point the other way. The keys work the same either way.

**Answered (ontology.aws.a, 16:09 UTC), not yet pushed:** not intended. In ontology.aws.a's next graph, the Demo site (A3) is `part_of` the business function (A5), and vaults move to A3: a vault is a system the site serves, not a business function. No `part_of` edge will point to a lower altitude in any pack. The ladder's counts then become A5 1 and A3 3 on the baseline. The relation wording moves to docs/ontology/relation-readings.json, which the page should read. The U and D rule stays as written, because it is safe whichever way an edge points.

## 3. Phone (390 px)

```
+--------------------------------------+
| Twin · baseline v · Leave            |
| Map v                [Ctrl+K] [me]   |
| ‹ Map / … / demo-cloudfront-logs     |
+--------------------------------------+
| File store (S3 bucket)  ✓            |
| 111122223333--demo-cloudfront-logs-… |
| eu-west-2 · 225 requests             |
| [Files] [Timeline]                   |
| ▾ Receives from (1)                  |
|   demo-cloudfront-logs ✓             |
| ▸ Is in (1)                          |
| ▸ Holds (9)                          |
| ▸ Is named in (1) ?                  |
| ▸ Is part of (1) ~                   |
| [Altitudes] [Worth a look 3] [Picture]|
+--------------------------------------+
```

- Only the card. Relations are collapsible (the first is open), and their counts show when collapsed.
- The ladder, Worth a look and the picture are three buttons at the foot. Each opens a full-screen sheet, and Back closes it.
- Long ids are truncated in the middle with an ellipsis, and the full id appears on a long press and in the card's "Copy id" (twin only, design 02).

## 4. Trust, and what Map never does

Following R-020 as graph.js implements it:

- Every node and edge carries trust: **confirmed** (✓, from `api` or `template` evidence), **claimed** (?, from content, naming or a comment) or **curated** (~, the ontologist's assertion). The mark is a character with a text alternative, and the "how we know" line says it in words.
- **Claimed evidence may raise a question, never a suggestion to remove, replace or narrow anything.** Map has no action buttons at all. Anything that leads to a change goes to Desk as a finding, worded as a question when its evidence is claimed.
- Labels, notes and attributes that come from inside files (content evidence) are untrusted text: they are set as text only, never as HTML, and long values are cut at 200 characters with "more".
- An actor's network is shown as /24 or /48 (privacy decision, data.aws.a's session, 11:15 UTC). The graph's actor nodes are networks already (`urn:sws:actor-net:<net>`).

## 5. Worth a look

Three findings the graph gives for free (ontology section 6), each a filtered list that opens the first card:

| Finding | What it lists | Baseline count | Words on screen |
|---|---|---|---|
| Dangling | nodes an edge names but no adapter added (`unknown` type, graph.js `toJSON`) | none on baseline | "Named by a record but not found in the account. Renamed or deleted?" |
| Unowned | resources with no `made_by` edge | 44 nodes with no `made_by` on dev's 47-node copy, most of them objects and records; resources only, to count | "No stack says it made this." |
| By name only | edges whose only evidence is `naming` | 11 edges on baseline | "Linked only because the names match. Check before relying on it." |

The counts shown are computed live from the graph in the page, never written into the page. The table's numbers are only there to check the wireframe against today's twin. Unowned should count resources (A2) only, not objects or records, or it will always be most of the graph. That is a rule for dev.2.aws.a, and I will check the number on the twin when it is built.

## 6. Addresses

- `#/map/<node id>`, as design 05 section 3 says. The node id is the ARN or `urn:sws:` id, URI-encoded. `#/map` alone opens the account node.
- `#/map/@A2` opens the altitude list, and `#/map/@worth/unowned` opens a finding list.
- The crumb is "Map / <region> / <label>" for regional resources and "Map / <label>" otherwise. Each part is a link.
- The address holds only ids from the graph, never an address from a log line (privacy rule above). Copy link exists only in the twin (design 02).
- The node id in the address is a lookup key only (security.aws.a): it is looked up in a `Map` (or a null-prototype object), never rendered as HTML, and an unknown id shows "Not found in this graph" with a link to the account node.
- Map links carry ARNs, and so account ids. Wherever the page offers to copy a link, it says so beside the button: "This link contains your account id."

## 7. Packs and modes

- The pack select in the twin bar rebuilds the graph: attack adds the scanner's actor and its events (48 nodes and 100 edges on dev's copy), and surge adds traffic. The card the customer was on stays open if the node still exists, otherwise the account node opens with a status-line note "That node is not in this pack".
- In real mode the graph builds as the service APIs answer (graph.js adapters run one by one). The status line says "Reading IAM roles… 3 of 7 sources", and the card fills as edges arrive. Nothing is stored between visits.

## 8. Accessibility

- The card is the accessible view. The picture is `aria-hidden` with a "Picture of the same neighbours" label, because everything in it is in the list.
- The ladder is a `role="listbox"` and relations are headings (`h3`) with lists under them. Keys: arrows move within a list, Enter opens, U and D walk altitudes, Backspace goes back to the previous card (history, not only the browser's).
- Trust marks are characters with text alternatives ("confirmed by AWS", "claimed, from a file", "the ontologist's word").

## 9. Later, not v1

- 3D by altitude (design 01, with viz.aws.a), always with this list as its flat equivalent.
- A path search ("how is this role connected to that bucket?"), which needs a shortest-path helper in graph.js.
- A whole-altitude picture at A3 and A5, where there are few nodes.

## 10. Asks

- **dev.2.aws.a**: in graph.js, `neighbours(id)` returning edges grouped by relation, with both readings, so the card is not built by hand in app code. Also a resources-only rule for "unowned".
- **ontology.aws.a**: both asks answered (section 2, "Answered"): altitudes fixed and relation-readings.json, to land with its key.
- **aws.c**: the Map tab in design 05's shell, `#/map/` routing, and the U, D and Backspace keys inside the console only.
- **security.aws.a**: section 4. Map has no actions, claimed evidence is worded as a question, and file-sourced text is set as text only.
- **sherpa.aws.a**: once built, walk from "A visitor reads a vault's files" down to a log line and back up, at 390 px and on desktop.
