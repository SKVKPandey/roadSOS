/* idb.js - Tiny promise wrapper over IndexedDB for region/centre persistence.
 *
 * Two stores:
 *   regions  - keyed by H3 cell id, value is the full region bundle JSON.
 *   centers  - keyed by centre id (e.g. "node/12345"), denormalised
 *              so we can render details without re-deriving cells.
 *
 * We use one big DB ("roadsos") with versioned migrations. Bumping
 * DB_VERSION and editing onupgradeneeded is how we evolve the schema.
 */

window.RoadSOSIDB = (function () {
  var DB_NAME = 'roadsos';
  var DB_VERSION = 2;
  var _dbPromise = null;

  function open() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise(function (resolve, reject) {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB not supported'));
        return;
      }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        if (!db.objectStoreNames.contains('regions')) {
          var regions = db.createObjectStore('regions', { keyPath: 'cell' });
          regions.createIndex('generated_at', 'generated_at', { unique: false });
        }
        if (!db.objectStoreNames.contains('centers')) {
          var centers = db.createObjectStore('centers', { keyPath: 'id' });
          centers.createIndex('lat', 'lat', { unique: false });
        }
        // v2: per-country emergency numbers cache so SOS works offline
        // even when the user crosses a border with no connectivity.
        if (!db.objectStoreNames.contains('emergency_numbers')) {
          db.createObjectStore('emergency_numbers', { keyPath: 'code' });
        }
        if (!db.objectStoreNames.contains('kv')) {
          db.createObjectStore('kv', { keyPath: 'k' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return _dbPromise;
  }

  function tx(store, mode) {
    return open().then(function (db) {
      var t = db.transaction(store, mode || 'readonly');
      return { tx: t, store: t.objectStore(store) };
    });
  }

  function put(store, value) {
    return tx(store, 'readwrite').then(function (h) {
      return new Promise(function (resolve, reject) {
        var r = h.store.put(value);
        r.onsuccess = function () { resolve(r.result); };
        r.onerror = function () { reject(r.error); };
      });
    });
  }

  function get(store, key) {
    return tx(store).then(function (h) {
      return new Promise(function (resolve, reject) {
        var r = h.store.get(key);
        r.onsuccess = function () { resolve(r.result || null); };
        r.onerror = function () { reject(r.error); };
      });
    });
  }

  function getAll(store) {
    return tx(store).then(function (h) {
      return new Promise(function (resolve, reject) {
        var r = h.store.getAll();
        r.onsuccess = function () { resolve(r.result || []); };
        r.onerror = function () { reject(r.error); };
      });
    });
  }

  function del(store, key) {
    return tx(store, 'readwrite').then(function (h) {
      return new Promise(function (resolve, reject) {
        var r = h.store.delete(key);
        r.onsuccess = function () { resolve(); };
        r.onerror = function () { reject(r.error); };
      });
    });
  }

  function clear(store) {
    return tx(store, 'readwrite').then(function (h) {
      return new Promise(function (resolve, reject) {
        var r = h.store.clear();
        r.onsuccess = function () { resolve(); };
        r.onerror = function () { reject(r.error); };
      });
    });
  }

  return {
    open: open,
    putRegion:    function (b) { return put('regions', b); },
    getRegion:    function (cell) { return get('regions', cell); },
    allRegions:   function () { return getAll('regions'); },
    deleteRegion: function (cell) { return del('regions', cell); },
    putCenter:    function (c) { return put('centers', c); },
    getCenter:    function (id) { return get('centers', id); },
    allCenters:   function () { return getAll('centers'); },
    // ---- v2: emergency-number cache --------------------------------
    putEmergency: function (rec) { return put('emergency_numbers', rec); },
    getEmergency: function (code) { return get('emergency_numbers', code); },
    allEmergency: function () { return getAll('emergency_numbers'); },
    // ---- v2: misc key-value (last-known country, etc) --------------
    putKV: function (k, v) { return put('kv', { k: k, v: v, t: Date.now() }); },
    getKV: function (k) { return get('kv', k); },
    clearAll: function () {
      return Promise.all([clear('regions'), clear('centers'),
                          clear('emergency_numbers'), clear('kv')]);
    }
  };
})();
