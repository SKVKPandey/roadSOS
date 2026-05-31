/* trauma-centers.js - Client-side cache-first trauma centre lookup.
 *
 * Flow:
 *   1. Page asks getNearby(lat, lng) -> we hit /api/v1/regions/by-point.
 *   2. Response is split into per-cell bundles and per-centre records,
 *      both persisted to IndexedDB so a subsequent offline launch can
 *      still render something.
 *   3. When the GPS pipeline reports a motion vector, prefetchForward()
 *      asks the server which cells to warm and fires background fetches
 *      against /api/v1/regions/by-cell/<h3>. The service worker then
 *      caches those responses (stale-while-revalidate) so an offline
 *      drive keeps working through the wedge that was prefetched.
 *
 * Throttle / jitter handling (added after seeing server-side prefetch
 * floods with bogus speed spikes of 30+ m/s during GPS warm-up):
 *
 *   - PREFETCH_GAP_MS gate fires from a single in-flight latch, atomic
 *     to JS's single thread. Setting it BEFORE the fetch (not after)
 *     prevents the burst of concurrent calls we used to see when watch
 *     + interval poll + manual refresh all fired within the same 100 ms.
 *   - We skip prefetch when reported speed is implausibly high (>25 m/s,
 *     ~90 km/h). On phone-in-pocket cold-start, GPS commonly reports
 *     spurious 30-100 m/s for the first few seconds before settling.
 *   - We skip prefetch when accuracy is poor (>200 m), since the wedge
 *     we'd compute from a bad fix points in a meaningless direction.
 */

window.RoadSOSTrauma = (function () {
  var BASE = '/api/v1/regions';
  var PREFETCH_GAP_MS = 15000;       // hard ceiling: one prefetch every 15 s
  var SPEED_JITTER_M_S = 25;         // skip if reported speed > 25 m/s
  var ACCURACY_THRESHOLD_M = 200;    // skip if reported accuracy > 200 m

  var lastPrefetchAt = 0;
  var inFlightPrefetch = false;

  function tag(msg, detail) {
    if (window.GPSDebug) window.GPSDebug.api('[trauma] ' + msg, detail);
    else if (detail !== undefined) console.log('[trauma]', msg, detail);
    else console.log('[trauma]', msg);
  }

  function warn(msg, detail) {
    if (window.GPSDebug) window.GPSDebug.warn('[trauma] ' + msg, detail);
    else console.warn('[trauma]', msg, detail);
  }

  /** GET /api/v1/regions/by-point -- the canonical "what's near me" call. */
  function fetchNearby(lat, lng, opts) {
    opts = opts || {};
    var url = BASE + '/by-point?lat=' + encodeURIComponent(lat) +
              '&lng=' + encodeURIComponent(lng) +
              '&k=' + (opts.k || 2) +
              '&limit=' + (opts.limit || 25);
    tag('fetchNearby', { url: url });
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('by-point HTTP ' + r.status);
      return r.json();
    });
  }

  function fetchCell(cell) {
    var url = BASE + '/by-cell/' + encodeURIComponent(cell);
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('by-cell HTTP ' + r.status);
      return r.json();
    });
  }

  function persistNearbyResponse(resp) {
    if (!window.RoadSOSIDB) return Promise.resolve();
    var ops = [];
    ops.push(window.RoadSOSIDB.putRegion({
      cell: resp.center_cell,
      resolution: resp.resolution,
      centers: resp.centers,
      generated_at: resp.generated_at,
      ttl_seconds: 24 * 3600,
      source: 'by-point'
    }));
    (resp.centers || []).forEach(function (c) {
      ops.push(window.RoadSOSIDB.putCenter(c));
    });
    return Promise.all(ops);
  }

  function getNearby(lat, lng, opts) {
    return fetchNearby(lat, lng, opts)
      .then(function (resp) {
        persistNearbyResponse(resp).catch(function (e) {
          warn('IDB persist failed', e && e.message);
        });
        return resp;
      })
      .catch(function (err) {
        warn('network failed, trying IDB fallback', err.message);
        if (!window.RoadSOSIDB) throw err;
        return window.RoadSOSIDB.allRegions().then(function (rows) {
          if (!rows.length) throw err;
          var pick = rows[0];
          return {
            query: { lat: lat, lng: lng, offline: true },
            center_cell: pick.cell,
            resolution: pick.resolution,
            centers: pick.centers,
            offline: true,
            generated_at: pick.generated_at
          };
        });
      });
  }

  /** Ask the server which forward cells to warm, then background-fetch them.
   *
   *  Skip conditions (in order):
   *    - no coords / missing lat or lng
   *    - already in flight
   *    - throttle: < PREFETCH_GAP_MS since last call
   *    - speed > SPEED_JITTER_M_S (likely GPS warm-up noise)
   *    - accuracy > ACCURACY_THRESHOLD_M (wedge direction would be garbage)
   */
  function prefetchForward(coords) {
    if (!coords || coords.lat == null || coords.lng == null) return;

    if (inFlightPrefetch) {
      // No log -- this fires constantly and clutters the panel.
      return;
    }

    var now = Date.now();
    if (now - lastPrefetchAt < PREFETCH_GAP_MS) return;

    if (coords.speed != null && coords.speed > SPEED_JITTER_M_S) {
      tag('skip prefetch: speed=' + coords.speed.toFixed(1) +
          'm/s exceeds jitter cap ' + SPEED_JITTER_M_S);
      return;
    }

    if (coords.accuracy != null && coords.accuracy > ACCURACY_THRESHOLD_M) {
      tag('skip prefetch: accuracy=' + coords.accuracy.toFixed(0) +
          'm exceeds threshold ' + ACCURACY_THRESHOLD_M);
      return;
    }

    // Latch BOTH at the top so concurrent callers in the same tick all bail.
    lastPrefetchAt = now;
    inFlightPrefetch = true;

    var url = BASE + '/prefetch?lat=' + encodeURIComponent(coords.lat) +
              '&lng=' + encodeURIComponent(coords.lng);
    if (coords.heading != null && !isNaN(coords.heading)) {
      url += '&heading=' + encodeURIComponent(coords.heading);
    }
    if (coords.speed != null && !isNaN(coords.speed)) {
      url += '&speed=' + encodeURIComponent(coords.speed);
    }
    tag('prefetch plan request', { url: url });

    fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('prefetch HTTP ' + r.status);
        return r.json();
      })
      .then(function (plan) {
        tag('prefetch plan received', {
          cells: plan.cells && plan.cells.length,
          priority: plan.priority
        });
        // Background-fetch each forward cell. Don't block on these.
        (plan.urls || []).forEach(function (u) {
          fetch(u).then(function (r) {
            if (!r.ok) return;
            return r.clone().json().then(function (bundle) {
              if (!window.RoadSOSIDB || !bundle.cell) return;
              window.RoadSOSIDB.putRegion(bundle);
              (bundle.centers || []).forEach(function (c) {
                window.RoadSOSIDB.putCenter(c);
              });
            });
          }).catch(function () { /* network noise, ignore */ });
        });
      })
      .catch(function (err) { warn('prefetch failed', err.message); })
      .then(function () { inFlightPrefetch = false; });
  }

  return {
    getNearby: getNearby,
    prefetchForward: prefetchForward,
    fetchCell: fetchCell,
    _state: function () {
      return { lastPrefetchAt: lastPrefetchAt, inFlightPrefetch: inFlightPrefetch };
    }
  };
})();
