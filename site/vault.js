// The device vault: keeps a session across a refresh or a browser restart, readable only by this site on
// this device. Dinis Cruz, 22 Nov 2026: "create a public and private key ... for this website, which should
// survive browser restart. And that public private key should never be known ... use the public key to
// encrypt these details so that only this page ... [can read them]".
//
// How:
// - On first use the page makes an ECDH P-256 key pair with WebCrypto. The private key is created
//   non-extractable: no script, not even this one, can read its bytes; the browser only lets this origin
//   use it. Both keys are kept as CryptoKey objects in IndexedDB (the browser stores them; they are never
//   exported, printed or sent).
// - To seal: a fresh one-off ECDH key pair, its shared secret with the device public key gives an AES-GCM
//   256 key (encrypt only); the record holds the one-off public key, the IV and the ciphertext, bound to
//   this origin and the record's name as additional data.
// - To open: the device private key and the record's one-off public key give the same AES key.
// - Sign out deletes the sealed records; "Forget this device" also deletes the key pair.
// What it does not protect against: a script running in this page (hence the strict CSP), or someone using
// this browser profile while the session is still valid. Records also carry their own expiry and are
// dropped once it passes.
(function (root) {
  "use strict";
  var subtle = root.crypto.subtle, DB = "sws-vault", STORE = "kv";
  var enc = new TextEncoder(), dec = new TextDecoder();

  function db() {
    return new Promise(function (resolve, reject) {
      var r = root.indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE); };
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction(STORE, mode), s = t.objectStore(STORE), out = fn(s);
        t.oncomplete = function () { d.close(); resolve(out && out.result); };
        t.onerror = function () { d.close(); reject(t.error); };
      });
    });
  }
  var get = function (k) { return tx("readonly", function (s) { return s.get(k); }); };
  var put = function (k, v) { return tx("readwrite", function (s) { s.put(v, k); }); };
  var del = function (k) { return tx("readwrite", function (s) { s.delete(k); }); };

  var EC = { name: "ECDH", namedCurve: "P-256" };
  var deviceKey = null;
  function device() {
    if (deviceKey) return Promise.resolve(deviceKey);
    return get("device-key").then(function (k) {
      if (k) return (deviceKey = k);
      return subtle.generateKey(EC, false, ["deriveKey"]).then(function (kp) {
        deviceKey = { publicKey: kp.publicKey, privateKey: kp.privateKey, created: new Date().toISOString() };
        return put("device-key", deviceKey).then(function () { return deviceKey; });
      });
    });
  }
  function aes(priv, pub, usage) {
    return subtle.deriveKey({ name: "ECDH", public: pub }, priv, { name: "AES-GCM", length: 256 }, false, [usage]);
  }
  function aad(name) { return enc.encode(root.location.origin + "|" + name); }

  // Seal a JSON value under a name, until expiresAt (ms since epoch).
  function seal(name, value, expiresAt) {
    return device().then(function (dk) {
      return subtle.generateKey(EC, false, ["deriveKey"]).then(function (eph) {
        var iv = root.crypto.getRandomValues(new Uint8Array(12));
        return Promise.all([aes(eph.privateKey, dk.publicKey, "encrypt"), subtle.exportKey("raw", eph.publicKey)])
          .then(function (r) {
            return subtle.encrypt({ name: "AES-GCM", iv: iv, additionalData: aad(name) }, r[0], enc.encode(JSON.stringify(value)))
              .then(function (ct) { return put("sealed:" + name, { v: 1, epk: r[1], iv: iv, ct: ct, exp: expiresAt }); });
          });
      });
    });
  }
  // Open a sealed value; null if absent, expired or unreadable (an unreadable record is deleted).
  function open(name) {
    return get("sealed:" + name).then(function (rec) {
      if (!rec) return null;
      if (!(rec.exp > Date.now())) return del("sealed:" + name).then(function () { return null; });
      return device().then(function (dk) {
        return subtle.importKey("raw", rec.epk, EC, false, [])
          .then(function (epk) { return aes(dk.privateKey, epk, "decrypt"); })
          .then(function (k) { return subtle.decrypt({ name: "AES-GCM", iv: rec.iv, additionalData: aad(name) }, k, rec.ct); })
          .then(function (pt) { return JSON.parse(dec.decode(pt)); });
      }).catch(function () { return del("sealed:" + name).then(function () { return null; }); });
    });
  }
  function forget(name) { return del("sealed:" + name); }
  function forgetDevice() {
    deviceKey = null;
    return new Promise(function (resolve) { var r = root.indexedDB.deleteDatabase(DB); r.onsuccess = r.onerror = r.onblocked = function () { resolve(); }; });
  }
  function available() { return !!(root.indexedDB && subtle); }

  root.Vault = { seal: seal, open: open, forget: forget, forgetDevice: forgetDevice, available: available };
})(window);
