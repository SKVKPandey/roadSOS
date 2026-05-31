/* emergency-numbers.js - Region-aware emergency-number lookup with offline cache.
 *
 * Global applicability: the user's "all-services" SOS number changes
 * when they cross country borders. India -> 112; US -> 911; Australia
 * -> 000; etc. We:
 *
 *   1. Bulk-cache ALL countries we know about on first online launch.
 *      ~10 KB JSON. Once cached, the user can fly anywhere we cover and
 *      the right number is still available even with zero connectivity.
 *   2. Reverse-geocode the current lat/lng to a country code via
 *      /api/v1/emergency-numbers/by-point and remember the answer.
 *   3. Expose a synchronous-ish .current() that returns the best-known
 *      bundle for the current location, drawing from IndexedDB if the
 *      network is down.
 *
 * Movement awareness: when the GPS pipeline reports a fresh fix, we
 * recompute the country code only if the new fix is more than ~100 km
 * from the last one (cheaper than reverse-geocoding every tick).
 */
window.RoadSOSEmergency = (function () {
  var BASE = '/api/v1/emergency-numbers';
  var GLOBAL_TTL_MS = 14 * 24 * 3600 * 1000;   // 14 days
  var POINT_TTL_MS  = 24 * 3600 * 1000;        // 24 hours
  var MOVE_THRESHOLD_DEG = 1.0;                // ~111 km

  var lastResolvedAt = 0;
  var lastResolvedCoords = null;
  var current = null;

  // -------- helpers ------------------------------------------------

  function tag(msg, detail) {
    if (window.GPSDebug) window.GPSDebug.api('[em] ' + msg, detail);
    else if (detail !== undefined) console.log('[em]', msg, detail);
    else console.log('[em]', msg);
  }
  function warn(msg, detail) {
    if (window.GPSDebug) window.GPSDebug.warn('[em] ' + msg, detail);
    else console.warn('[em]', msg, detail);
  }

  // -------- bulk cache -------------------------------------------------

  /** Idempotent: fetches /api/v1/emergency-numbers/all once per TTL window
   *  and writes every country into IndexedDB. Safe to call on every page load. */
  function ensureBulkCache() {
    if (!window.RoadSOSIDB) return Promise.resolve();
    return window.RoadSOSIDB.getKV('em.bulk.fetched_at').then(function (rec) {
      var fresh = rec && rec.v && (Date.now() - rec.v < GLOBAL_TTL_MS);
      if (fresh) { tag('bulk cache is fresh, skipping fetch'); return; }
      tag('priming bulk emergency-number cache');
      return fetch(BASE + '/all').then(function (r) {
        if (!r.ok) throw new Error('bulk HTTP ' + r.status);
        return r.json();
      }).then(function (data) {
        var ops = (data.countries || []).map(function (c) {
          return window.RoadSOSIDB.putEmergency({
            code: c.code,
            name: c.name,
            police: c.police, ambulance: c.ambulance,
            fire: c.fire, all: c.all,
            cached_at: Date.now()
          });
        });
        return Promise.all(ops).then(function () {
          return window.RoadSOSIDB.putKV('em.bulk.fetched_at', Date.now());
        });
      }).then(function () { tag('bulk cache primed'); })
        .catch(function (e) { warn('bulk fetch failed', e.message); });
    });
  }

  // -------- per-point resolve -----------------------------------------

  function resolveByPoint(lat, lng) {
    return fetch(BASE + '/by-point?lat=' + encodeURIComponent(lat) +
                 '&lng=' + encodeURIComponent(lng))
      .then(function (r) {
        if (!r.ok) throw new Error('by-point HTTP ' + r.status);
        return r.json();
      });
  }

  function cachedForCountry(code) {
    if (!window.RoadSOSIDB || !code) return Promise.resolve(null);
    return window.RoadSOSIDB.getEmergency(code.toLowerCase());
  }

  function lastKnownCountry() {
    if (!window.RoadSOSIDB) return Promise.resolve(null);
    return window.RoadSOSIDB.getKV('em.last_country');
  }

  function rememberCountry(code) {
    if (!window.RoadSOSIDB || !code) return Promise.resolve();
    return window.RoadSOSIDB.putKV('em.last_country', code);
  }

  // -------- public API -------------------------------------------------

  function setCurrent(bundle, source) {
    current = bundle;
    tag('current set [' + source + ']: ' + (bundle.name || bundle.country_code) +
        ' all=' + bundle.all + ' police=' + bundle.police);
    document.dispatchEvent(new CustomEvent('roadsos:emergency-updated', { detail: bundle }));
  }

  /** Returns the best-known number bundle for the user's current location.
   *  May resolve to a cached/older bundle if offline. */
  function ensureCurrent() {
    if (current) return Promise.resolve(current);
    return lastKnownCountry().then(function (rec) {
      var code = rec && rec.v;
      if (code) return cachedForCountry(code).then(function (b) {
        if (b) { setCurrent(b, 'idb-last-known'); return b; }
        return null;
      });
      return null;
    });
  }

  /** Public: refresh based on a fresh GPS fix. Throttled to once per
   *  ~100 km of movement. Falls back to the IDB cache when offline. */
  function refreshFromCoords(coords) {
    if (!coords || coords.lat == null || coords.lng == null) return Promise.resolve(current);

    var skip = lastResolvedCoords &&
               Math.abs(coords.lat - lastResolvedCoords.lat) < MOVE_THRESHOLD_DEG &&
               Math.abs(coords.lng - lastResolvedCoords.lng) < MOVE_THRESHOLD_DEG;
    if (skip && current) return Promise.resolve(current);

    return resolveByPoint(coords.lat, coords.lng)
      .then(function (resp) {
        lastResolvedAt = Date.now();
        lastResolvedCoords = { lat: coords.lat, lng: coords.lng };
        var code = resp.country_code;
        var bundle = Object.assign({ country_code: code }, resp.numbers || {});
        return rememberCountry(code).then(function () {
          // Also persist this exact bundle to IDB for offline use later.
          if (window.RoadSOSIDB && code) {
            window.RoadSOSIDB.putEmergency({
              code: code, name: bundle.name, all: bundle.all,
              police: bundle.police, ambulance: bundle.ambulance, fire: bundle.fire,
              cached_at: Date.now()
            });
          }
          setCurrent(bundle, 'network');
          return bundle;
        });
      })
      .catch(function (err) {
        warn('by-point failed, attempting IDB fallback', err.message);
        // We're probably offline. Try the last-known country.
        return ensureCurrent();
      });
  }

  function getCurrent() { return current; }
  function getDialableAll() {
    var c = current || { all: '112' };
    return (c.all || '112').replace(/[^\d+#*]/g, '') || '112';
  }
  function getDialableFor(service) {
    var c = current || { all: '112' };
    return (c[service] || c.all || '112').replace(/[^\d+#*]/g, '') || '112';
  }

  return {
    ensureBulkCache: ensureBulkCache,
    refreshFromCoords: refreshFromCoords,
    ensureCurrent: ensureCurrent,
    getCurrent: getCurrent,
    getDialableAll: getDialableAll,
    getDialableFor: getDialableFor
  };
})();

// Boot: prime the bulk cache + recompute current bundle on every GPS fix.
document.addEventListener('DOMContentLoaded', function () {
  if (window.RoadSOSEmergency) {
    window.RoadSOSEmergency.ensureBulkCache();
    window.RoadSOSEmergency.ensureCurrent();
  }
  if (window.RoadSOSState && window.RoadSOSState.subscribe) {
    window.RoadSOSState.subscribe(function (key, value) {
      if (key === 'gpsCoordinates' && value && window.RoadSOSEmergency) {
        window.RoadSOSEmergency.refreshFromCoords(value);
      }
    });
  }
});
