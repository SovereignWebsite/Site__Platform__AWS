// Read a zip without downloading it: the index (central directory) is at the end of every zip, so a couple of
// byte-range requests list everything inside, and one more fetches a single file, which the browser unzips with
// DecompressionStream. Works for .zip, .whl, .jar and zip64 (over 4 GB). Dinis Cruz, 23 Nov 2026: "yes that
// would be an amazing feature to have".
// fetchRange(start, end) must return a Promise of an ArrayBuffer holding bytes start..end (inclusive).
(function (root) {
  "use strict";
  var EOCD = 0x06054b50, Z64_LOC = 0x07064b50, Z64_EOCD = 0x06064b50, CEN = 0x02014b50, LOC = 0x04034b50;
  var MAX32 = 0xffffffff, MAX16 = 0xffff;

  function u64(dv, at) { return dv.getUint32(at, true) + dv.getUint32(at + 4, true) * 4294967296; }
  function dosDate(date, time) {
    if (!date) return "";
    var y = 1980 + (date >> 9), m = (date >> 5) & 15, d = date & 31, h = time >> 11, mi = (time >> 5) & 63;
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return y + "-" + p(m) + "-" + p(d) + " " + p(h) + ":" + p(mi);
  }
  function decodeName(bytes, utf8) {
    try { return new TextDecoder(utf8 ? "utf-8" : "utf-8", { fatal: !utf8 }).decode(bytes); }
    catch (e) { return new TextDecoder("latin1").decode(bytes); }
  }

  // List the entries: [{ name, size, compressed, method, encrypted, modified, offset, dir }]
  function list(fetchRange, size) {
    var tailLen = Math.min(size, 65535 + 22 + 20);
    return fetchRange(size - tailLen, size - 1).then(function (buf) {
      var dv = new DataView(buf), at = -1;
      for (var i = buf.byteLength - 22; i >= 0; i--) if (dv.getUint32(i, true) === EOCD) { at = i; break; }
      if (at < 0) throw new Error("Not a zip: no end-of-index record in the last " + tailLen + " bytes.");
      var count = dv.getUint16(at + 10, true), cdSize = dv.getUint32(at + 12, true), cdOffset = dv.getUint32(at + 16, true);
      if (count === MAX16 || cdSize === MAX32 || cdOffset === MAX32) {
        var loc = at - 20;
        if (loc < 0 || dv.getUint32(loc, true) !== Z64_LOC) throw new Error("zip64 locator not found.");
        var z64at = u64(dv, loc + 8);
        return fetchRange(z64at, z64at + 55).then(function (b) {
          var z = new DataView(b);
          if (z.getUint32(0, true) !== Z64_EOCD) throw new Error("zip64 end record not found.");
          return readIndex(fetchRange, u64(z, 48), u64(z, 40));
        });
      }
      return readIndex(fetchRange, cdOffset, cdSize, buf, size - tailLen);
    });
  }
  // held/heldAt: bytes already fetched and where they start; if they cover the index, no second request.
  function readIndex(fetchRange, offset, length, held, heldAt) {
    if (!length) return Promise.resolve([]);
    var got = held && offset >= heldAt && offset + length <= heldAt + held.byteLength
      ? Promise.resolve(held.slice(offset - heldAt, offset - heldAt + length)) : fetchRange(offset, offset + length - 1);
    return got.then(function (buf) {
      var dv = new DataView(buf), out = [], p = 0;
      while (p + 46 <= buf.byteLength && dv.getUint32(p, true) === CEN) {
        var flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true);
        var time = dv.getUint16(p + 12, true), date = dv.getUint16(p + 14, true);
        var comp = dv.getUint32(p + 20, true), size = dv.getUint32(p + 24, true);
        var nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
        var off = dv.getUint32(p + 42, true);
        var name = decodeName(new Uint8Array(buf, p + 46, nlen), !!(flags & 0x800));
        // zip64 extra field (id 1): 8-byte values, in this order, for the fields that hold 0xffffffff
        var x = p + 46 + nlen, xend = x + xlen;
        while (x + 4 <= xend) {
          var id = dv.getUint16(x, true), sz = dv.getUint16(x + 2, true), q = x + 4;
          if (id === 1) {
            if (size === MAX32) { size = u64(dv, q); q += 8; }
            if (comp === MAX32) { comp = u64(dv, q); q += 8; }
            if (off === MAX32) { off = u64(dv, q); q += 8; }
          }
          x += 4 + sz;
        }
        out.push({ name: name, size: size, compressed: comp, method: method, encrypted: !!(flags & 1),
          modified: dosDate(date, time), offset: off, dir: /\/$/.test(name) });
        p = xend + clen;
      }
      return out;
    });
  }

  // One entry's bytes, unzipped. Returns a Promise of a Uint8Array.
  function read(fetchRange, entry) {
    if (entry.encrypted) return Promise.reject(new Error("This file is encrypted (a password zip): it can be listed, not opened here."));
    if (entry.method !== 0 && entry.method !== 8) return Promise.reject(new Error("Compression method " + entry.method + " is not one a browser can unzip (only stored and deflate)."));
    return fetchRange(entry.offset, entry.offset + 29).then(function (h) {
      var dv = new DataView(h);
      if (dv.getUint32(0, true) !== LOC) throw new Error("The file's local header was not where the index says.");
      var start = entry.offset + 30 + dv.getUint16(26, true) + dv.getUint16(28, true);
      if (!entry.compressed) return new Uint8Array(0);
      return fetchRange(start, start + entry.compressed - 1);
    }).then(function (data) {
      if (data instanceof Uint8Array) return data;
      if (entry.method === 0) return new Uint8Array(data);
      var ds = new DecompressionStream("deflate-raw");
      return new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer().then(function (b) { return new Uint8Array(b); });
    });
  }

  root.Zip = { list: list, read: read, isZip: function (key) { return /\.(zip|whl|jar|war|ear|apk|nupkg|xpi|docx|xlsx|pptx|odt|ods|epub)$/i.test(key); } };
})(typeof window !== "undefined" ? window : globalThis);
