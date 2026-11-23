// Follow the packet: one CloudFront log line becomes the steps the engine plays.
// viz.aws.a@SovereignWebsite.dinis, 23 Nov 2026. Storyboard 01 (docs/viz/2026-11-23__01-storyboard-follow-the-packet.md).
// Pure function, no network, no DOM: the same list comes from the twin today and from real logs later.
// A step: { i, t, from, to, kind, title, text, fields, gap }.
//   t is seconds from the start, scaled from the log line's own time_taken (the timeline is true to the data).
//   gap names what the twin does not hold yet; the view draws it as "not yet in the twin", never as data.

const EDGES = { LHR: "London", DUB: "Dublin", AMS: "Amsterdam" };
const FIELDS = ["timestamp", "c_ip", "cs_method", "cs_uri_stem", "sc_status", "sc_bytes", "time_taken", "x_edge_location", "cs_user_agent"];

export function parseLine(text) {
  const line = typeof text === "string" ? JSON.parse(text) : text;
  for (const f of FIELDS) if (!(f in line)) throw new Error("Log line has no " + f + ": not a CloudFront line the twin writes");
  return line;
}

// The S3 browser's address for a place (site/s3.js route(), fe7170c): every panel value links to what it names.
export function s3Href(bucket, key) {
  return "#/s3/" + bucket + "/" + String(key || "").split("/").map(encodeURIComponent).join("/");
}

export function edgeCity(code) {
  const m = /^([A-Z]{3})/.exec(code || "");
  return (m && EDGES[m[1]]) || "unknown edge";
}

// ctx: { site, logs, logKey, object: { size, type, modified } | null,
//        stream: the twin's DescribeDeliveryStream description, or null }
export function stepsFor(text, ctx) {
  const l = parseLine(text);
  const tt = Number(l.time_taken) || 0;
  const key = l.cs_uri_stem.replace(/^\//, "") || "index.html";
  const out = [];
  const add = (from, to, kind, title, text, fields, extra) => out.push({ i: out.length + 1, from, to, kind, title, text, fields, ...extra });

  add("visitor", "edge", "request", "Ask", l.cs_method + " " + l.cs_uri_stem + " from " + l.c_ip,
    { method: l.cs_method, path: l.cs_uri_stem, address: l.c_ip, agent: l.cs_user_agent });
  add("edge", "edge", "request", "Edge", "Reaches edge " + l.x_edge_location + " (" + edgeCity(l.x_edge_location) + ")",
    { edge: l.x_edge_location, city: edgeCity(l.x_edge_location) }, { gap: "cache hit or miss" });
  add("edge", "keeper", "data", "Origin", "Asks bucket " + ctx.site + " for " + key,
    { bucket: ctx.site, key, href: s3Href(ctx.site, key), ...(ctx.object || {}) }, { gap: ctx.object ? "origin access setting" : "object not in the twin" });
  add("keeper", "visitor", "data", "Answer", l.sc_status + ", " + l.sc_bytes + " bytes in " + tt + " s",
    { status: l.sc_status, bytes: l.sc_bytes, seconds: tt });
  const st = ctx.stream || null, dest = st && st.Destinations && st.Destinations[0] && st.Destinations[0].ExtendedS3DestinationDescription;
  const proc = dest && dest.ProcessingConfiguration && dest.ProcessingConfiguration.Enabled
    ? ((dest.ProcessingConfiguration.Processors || [])[0] || {}).Parameters : null;
  const processor = proc && (proc.find((x) => x.ParameterName === "LambdaArn") || {}).ParameterValue;
  add("edge", "scribe", "log", "Log",
    st ? "One JSON line goes to Firehose stream " + st.DeliveryStreamName + (processor ? ", enriched by " + processor.replace(/^.*:function:/, "").replace(/:\$LATEST$/, "") : "")
       : "One JSON line written for this request",
    { line: l, ...(st ? { stream: st.DeliveryStreamName, arn: st.DeliveryStreamARN, processor: processor || null } : {}),
      ...("country" in l ? { country: l.country, vault: l.vault_id || null } : {}) },
    st ? {} : { gap: "Firehose stream" });
  add("scribe", "archivist", "log", "Batch", "Lands in " + ctx.logs + " as " + ctx.logKey,
    { bucket: ctx.logs, key: ctx.logKey, href: s3Href(ctx.logs, ctx.logKey), ...(dest ? { buffer_seconds: dest.BufferingHints.IntervalInSeconds, buffer_mb: dest.BufferingHints.SizeInMBs, compression: dest.CompressionFormat } : {}) },
    dest && !dest.BucketARN.endsWith(":::" + ctx.logs) ? { gap: "stream writes to another bucket" } : {});

  // Vault reach: the enricher's vault_id names the vault this request touched; shown only when the line has one.
  if (l.vault_id) add("archivist", "vault", "vault", "Vault", "Touches vault " + l.vault_id + " (from the enricher's vault_id)", { vault: l.vault_id });

  // Timing: the four request steps share time_taken; the log steps follow after (Firehose batches hourly; shown, not timed).
  const share = tt / 4;
  out.forEach((s, n) => { s.t = n < 4 ? +(share * n).toFixed(4) : +(tt + (n - 3) * share).toFixed(4); });
  // Log steps carry the enriched line as the scribe wrote it (country, vault_id); the request steps show the raw request.
  return out;
}

// One line of text per step: the same story for a keyboard or screen reader user.
export function asText(steps) {
  return steps.map((s) => s.i + ". " + s.title + ": " + s.text + (s.gap ? " (" + s.gap + ": not yet in the twin)" : ""));
}
