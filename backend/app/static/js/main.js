/* main.js - Core UI Interactivity & Browser Geolocation Handlers
 *
 * Accuracy policy:
 *   - GOOD_ACCURACY_M   (<=50 m)  : trustworthy, use for address + ranking.
 *   - POOR_ACCURACY_M   (>1500 m) : show amber warning -- Wi-Fi/IP fix, not GPS.
 *   - In between        (50-1500m): not used for the displayed address but
 *                                   still stored so trauma-centres ranking
 *                                   has *something*.
 *
 * We keep the BEST (lowest-accuracy-radius) fix from the last 30 s instead
 * of always trusting the latest one -- urban multipath causes the receiver
 * to spit out an occasional 200 m wobble between 15 m fixes.
 */

// 1. Mobile Drawer Slider Controller
function toggleMobileDrawer() {
  var drawer = document.getElementById('mobile-drawer');
  if (drawer) { drawer.classList.toggle('open'); }
}

// ==========================================================================
// Capacitor compat shim. When running inside the APK, the native bridge
// exposes window.Capacitor.Plugins.Geolocation, which wraps Android's
// FusedLocationProviderClient. In a regular browser, fall back to
// navigator.geolocation. One toggle for the whole app.
// ==========================================================================
function isCapacitor() {
  return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
}
function capGeo() {
  return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Geolocation) || null;
}
function geoSourceTag() { return isCapacitor() ? 'capacitor' : 'browser'; }

function getCurrentPositionCompat(onOk, onErr, opts) {
  var plugin = capGeo();
  if (isCapacitor() && plugin) {
    plugin.getCurrentPosition(opts)
      .then(function (p) { onOk(p); })
      .catch(function (e) { onErr({ code: 2, message: (e && e.message) || String(e) }); });
  } else {
    navigator.geolocation.getCurrentPosition(onOk, onErr, opts);
  }
}

function watchPositionCompat(onFix, onErr, opts) {
  var plugin = capGeo();
  if (isCapacitor() && plugin) {
    return plugin.watchPosition(opts, function (pos, err) {
      if (err) onErr({ code: 2, message: (err && err.message) || String(err) });
      else onFix(pos);
    });
  }
  return navigator.geolocation.watchPosition(onFix, onErr, opts);
}

function clearWatchCompat(watchHandle) {
  var plugin = capGeo();
  if (isCapacitor() && plugin) {
    Promise.resolve(watchHandle).then(function (id) { plugin.clearWatch({ id: id }); });
  } else if (watchHandle != null) {
    navigator.geolocation.clearWatch(watchHandle);
  }
}

// ==========================================================================
// Debug logger (same as before)
// ==========================================================================
var GPSDebug = (function () {
  var events = [];
  var MAX_EVENTS = 60;

  function ts() {
    var d = new Date();
    return d.toTimeString().split(' ')[0] + '.' + String(d.getMilliseconds()).padStart(3, '0');
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function render() {
    var panel = document.getElementById('gps-debug-log');
    if (!panel) return;
    panel.innerHTML = events.map(function (e) {
      var colorMap = { INFO:'#7fd0ff', OK:'#5bd58a', WARN:'#f6c14b', ERR:'#ff7d7d', API:'#c79bff', STEP:'#ffd28a' };
      var color = colorMap[e.level] || '#ddd';
      var detail = '';
      if (e.detail !== undefined) {
        var txt = typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail, null, 2);
        detail = '<pre style="margin:2px 0 0 14px;color:#bbb;white-space:pre-wrap;word-break:break-all;">' + escapeHtml(txt) + '</pre>';
      }
      return '<div style="margin-bottom:6px;">' +
        '<span style="color:#888;">[' + e.ts + ']</span> ' +
        '<span style="color:' + color + ';font-weight:600;">[' + e.level + ']</span> ' +
        '<span style="color:#eee;">' + escapeHtml(e.msg) + '</span>' + detail + '</div>';
    }).join('');
    panel.scrollTop = panel.scrollHeight;
  }

  function push(level, msg, detail) {
    events.push({ ts: ts(), level: level, msg: msg, detail: detail });
    if (events.length > MAX_EVENTS) events.shift();
    var args = ['%c[GPS ' + level + ']%c ' + msg,
      'color:#fff;background:#444;padding:1px 4px;border-radius:3px;', ''];
    if (detail !== undefined) args.push(detail);
    if (level === 'ERR') console.error.apply(console, args);
    else if (level === 'WARN') console.warn.apply(console, args);
    else console.log.apply(console, args);
    render();
  }

  return {
    info:  function (m, d) { push('INFO', m, d); },
    ok:    function (m, d) { push('OK',   m, d); },
    warn:  function (m, d) { push('WARN', m, d); },
    err:   function (m, d) { push('ERR',  m, d); },
    api:   function (m, d) { push('API',  m, d); },
    step:  function (m, d) { push('STEP', m, d); },
    clear: function () { events.length = 0; render(); }
  };
})();
window.GPSDebug = GPSDebug;

document.addEventListener('DOMContentLoaded', function () {
  GPSDebug.info('roadSOS client engine initiated.');
  buildDebugPanel();

  var toggleLabel = document.getElementById('location-toggle-label');
  var toggleInput = document.getElementById('location-toggle-input');
  var addressText = document.getElementById('address-text');
  var addressPill = document.getElementById('address-pill');

  var watchId = null;
  var refreshTimerId = null;
  var lastGeocodedAt = 0;
  var lastGeocodedCoords = null;
  var inFlightGeocode = false;
  var fixCount = 0;

  // Rolling window of recent fixes (best-of-N).
  var recentFixes = [];
  var WINDOW_MS = 30 * 1000;

  var MIN_GEOCODE_GAP_MS = 4000;
  var FORCE_REGEOCODE_MS = 20000;
  var HARD_REFRESH_INTERVAL_MS = 15000;
  var MOVE_THRESHOLD_DEG = 0.00015;
  var POOR_ACCURACY_M = 1500;   // amber warning above this
  var GOOD_ACCURACY_M = 80;     // only geocode at or below this (urban canyon realistic)

  GPSDebug.step('Environment probe', {
    userAgent: navigator.userAgent,
    isSecureContext: window.isSecureContext,
    protocol: location.protocol,
    host: location.host,
    geolocationSupported: !!navigator.geolocation,
    permissionsApi: !!navigator.permissions
  });

  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'geolocation' })
      .then(function (status) {
        GPSDebug.step('Permission state at load', { state: status.state });
        status.onchange = function () { GPSDebug.step('Permission state changed', { state: status.state }); };
      })
      .catch(function (err) { GPSDebug.warn('Permissions API query failed', err.message); });
  } else {
    GPSDebug.warn('Permissions API not available - cannot query geolocation permission.');
  }

  function shouldGeocode(lat, lng) {
    var now = Date.now();
    if (inFlightGeocode) { GPSDebug.info('shouldGeocode -> false (already in flight)'); return false; }
    if (!lastGeocodedCoords) { GPSDebug.info('shouldGeocode -> true (first time)'); return true; }
    if (now - lastGeocodedAt > FORCE_REGEOCODE_MS) {
      GPSDebug.info('shouldGeocode -> true (force-refresh: ' + (now - lastGeocodedAt) + 'ms)');
      return true;
    }
    if (now - lastGeocodedAt < MIN_GEOCODE_GAP_MS) {
      GPSDebug.info('shouldGeocode -> false (throttled: ' + (now - lastGeocodedAt) + 'ms)');
      return false;
    }
    var dLat = Math.abs(lat - lastGeocodedCoords.lat);
    var dLng = Math.abs(lng - lastGeocodedCoords.lng);
    var movedFar = dLat > MOVE_THRESHOLD_DEG || dLng > MOVE_THRESHOLD_DEG;
    GPSDebug.info('shouldGeocode -> ' + movedFar +
      ' (dLat=' + dLat.toFixed(6) + ', dLng=' + dLng.toFixed(6) + ', thr=' + MOVE_THRESHOLD_DEG + ')');
    return movedFar;
  }

  function truncate(obj) {
    if (!obj) return obj;
    try {
      return { display_name: obj.display_name, address: obj.address,
        lat: obj.lat, lon: obj.lon, class: obj.class, type: obj.type };
    } catch (_) { return obj; }
  }

  function pickBestRecentFix(latestCoords) {
    // Drop fixes older than WINDOW_MS and pick the smallest accuracy.
    var now = Date.now();
    recentFixes.push({ at: now, coords: latestCoords });
    recentFixes = recentFixes.filter(function (f) { return now - f.at <= WINDOW_MS; });
    var best = recentFixes[0];
    for (var i = 1; i < recentFixes.length; i++) {
      if (recentFixes[i].coords.accuracy < best.coords.accuracy) best = recentFixes[i];
    }
    return best.coords;
  }

  function renderPillFor(coords, addressOverride) {
    if (!coords || !addressText) return;
    var accTxt = ' · ±' + Math.round(coords.accuracy) + 'm';
    var label = addressOverride || (addressText.textContent.split(' · ±')[0]);
    addressText.textContent = label + accTxt;
  }

  async function updateApproximateAddress(lat, lng, accuracy) {
    if (!addressText) return;
    if (inFlightGeocode) return;
    inFlightGeocode = true;
    try {
      addressText.textContent = 'Fetching address... · ±' + Math.round(accuracy) + 'm';
      var data = null;
      var usedSource = null;

      var proxyUrl = '/api/v1/geocode?lat=' + lat + '&lng=' + lng + '&_=' + Date.now();
      GPSDebug.api('Calling local proxy', { url: proxyUrl });
      try {
        var resp = await fetch(proxyUrl, { cache: 'no-store' });
        GPSDebug.api('Proxy response status: ' + resp.status);
        if (resp.ok) {
          var parsed = await resp.json();
          if (parsed && !parsed.error) { data = parsed; usedSource = 'proxy';
            GPSDebug.ok('Got address from local proxy', truncate(parsed)); }
          else { GPSDebug.warn('Proxy returned error envelope', parsed); }
        } else { GPSDebug.warn('Proxy non-OK status: ' + resp.status); }
      } catch (proxyErr) { GPSDebug.warn('Proxy fetch failed', proxyErr.message); }

      if (!data) {
        var osmUrl = 'https://nominatim.openstreetmap.org/reverse?format=json' +
          '&lat=' + lat + '&lon=' + lng + '&zoom=16&_=' + Date.now();
        GPSDebug.api('Falling back to OSM Nominatim', { url: osmUrl });
        var r2 = await fetch(osmUrl, { headers: { 'Accept-Language': 'en' }, cache: 'no-store' });
        GPSDebug.api('OSM response status: ' + r2.status);
        if (!r2.ok) throw new Error('OSM error: ' + r2.status);
        data = await r2.json();
        usedSource = 'osm-direct';
        GPSDebug.ok('Got address from OSM directly', truncate(data));
      }

      if (data && data.address) {
        var addr = data.address;
        var road = addr.road || addr.street || '';
        var suburb = addr.suburb || '';
        if (suburb.startsWith('Zone ')) suburb = suburb.replace(/^Zone \d+\s+/, '');
        var neighborhood = addr.neighbourhood || addr.village || addr.hamlet || '';
        var n = neighborhood.toLowerCase();
        if (n.includes('division') || n.includes('ward') || n.includes('cmwssb') || n.includes('zone')) neighborhood = '';
        var city = addr.city || addr.town || addr.municipality || addr.state || '';
        var parts = [];
        if (road) parts.push(road);
        if (suburb) parts.push(suburb); else if (neighborhood) parts.push(neighborhood);
        if (city && parts.length < 2) parts.push(city);
        var displayStr = parts.join(', ');
        if (!displayStr) displayStr = (data.display_name || '').split(',')[0] || 'Approx. Location';

        addressText.textContent = displayStr + ' · ±' + Math.round(accuracy) + 'm';
        addressText.title = (data.display_name || displayStr) + '\n' +
          'lat: ' + lat.toFixed(6) + ', lng: ' + lng.toFixed(6) + '\n' +
          'accuracy: ±' + Math.round(accuracy) + ' m\n' +
          'via: ' + usedSource;
        lastGeocodedCoords = { lat: lat, lng: lng };
        lastGeocodedAt = Date.now();
        GPSDebug.ok('Address rendered: "' + displayStr + '" ±' + Math.round(accuracy) + 'm',
          { via: usedSource, coords: { lat: lat, lng: lng }, fullName: data.display_name });
      } else {
        GPSDebug.warn('No usable address in geocode response.', data);
        addressText.textContent = 'Approx. Location · ±' + Math.round(accuracy) + 'm';
      }
    } catch (err) {
      GPSDebug.err('Reverse geocoding failed', err.message);
      addressText.textContent = 'Location Locked · ±' + Math.round(accuracy) + 'm';
    } finally { inFlightGeocode = false; }
  }

  function handlePositionFix(position, source) {
    fixCount += 1;
    var raw = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
      altitude: position.coords.altitude,
      altitudeAccuracy: position.coords.altitudeAccuracy,
      heading: position.coords.heading,
      speed: position.coords.speed,
      timestamp: position.timestamp,
      ageMs: Date.now() - position.timestamp
    };

    // Pick the BEST fix in the last 30s (lowest accuracy radius wins).
    // This filters out the occasional multipath wobble.
    var coords = pickBestRecentFix(raw);
    var usedBest = coords !== raw;

    GPSDebug.ok('Fix #' + fixCount + ' (' + source + ' via ' + geoSourceTag() + ')' +
                (usedBest ? ' [using better recent fix]' : ''), {
      lat: coords.lat, lng: coords.lng,
      'accuracy(m)': coords.accuracy, 'fix age(ms)': coords.ageMs,
      altitude: coords.altitude, heading: coords.heading, speed: coords.speed,
      'raw_accuracy(m)': raw.accuracy
    });

    var stateLine = document.getElementById('gps-debug-state');
    if (stateLine) {
      stateLine.textContent = 'Last fix (' + source + '): ' +
        coords.lat.toFixed(6) + ', ' + coords.lng.toFixed(6) +
        ' ±' + coords.accuracy.toFixed(0) + 'm age ' + coords.ageMs + 'ms fixes:' + fixCount +
        ' (raw ±' + raw.accuracy.toFixed(0) + 'm)';
    }

    if (toggleLabel) {
      if (coords.accuracy > POOR_ACCURACY_M) {
        toggleLabel.classList.add('is-low-accuracy');
        toggleLabel.title = 'Accuracy is poor (±' + Math.round(coords.accuracy) + ' m). ' +
          'Likely Wi-Fi/IP fix, not real GPS. Move outdoors with sky view or wait 30 s for satellite lock.';
        GPSDebug.warn('Accuracy ' + Math.round(coords.accuracy) + 'm > ' + POOR_ACCURACY_M + 'm -> IP/Wi-Fi positioning.');
      } else {
        toggleLabel.classList.remove('is-low-accuracy');
        toggleLabel.title = '';
      }
    }

    // Always push to global state so trauma-centres can rank by exact lat/lng
    // even at coarse accuracy -- ranking is robust to small position error.
    if (window.RoadSOSState) window.RoadSOSState.set('gpsCoordinates', coords);
    if (toggleLabel) { toggleLabel.classList.add('is-active'); toggleLabel.classList.remove('is-error'); }

    // BUT: do not geocode (and therefore do not display a neighbourhood name)
    // until accuracy is good enough that the answer is meaningful.
    if (coords.accuracy > GOOD_ACCURACY_M) {
      GPSDebug.info('Accuracy ' + Math.round(coords.accuracy) + 'm > ' + GOOD_ACCURACY_M +
                    'm -> skipping geocode to avoid wrong-suburb labelling.');
      if (addressText && (!lastGeocodedCoords || addressText.textContent.indexOf('Improving') === 0
                          || addressText.textContent.indexOf('Locating') === 0)) {
        addressText.textContent = 'Improving GPS lock... ±' + Math.round(coords.accuracy) + 'm';
      } else if (addressText) {
        // Still refresh the accuracy reading next to the existing address.
        renderPillFor(coords);
      }
      return;
    }

    if (shouldGeocode(coords.lat, coords.lng)) {
      updateApproximateAddress(coords.lat, coords.lng, coords.accuracy);
    } else {
      renderPillFor(coords);
    }
  }

  function handlePositionError(error) {
    var codeMap = { 1: 'PERMISSION_DENIED', 2: 'POSITION_UNAVAILABLE', 3: 'TIMEOUT' };
    GPSDebug.err('Geolocation error: ' + (codeMap[error.code] || error.code), error.message);
    if (toggleLabel) { toggleLabel.classList.remove('is-active'); toggleLabel.classList.add('is-error'); }
    if (toggleInput) toggleInput.checked = false;
    if (addressText) addressText.textContent = 'Access Denied';
    if (window.RoadSOSState) window.RoadSOSState.set('gpsCoordinates', null);
    stopWatching();
  }

  function startWatching() {
    if (!navigator.geolocation) {
      GPSDebug.err('navigator.geolocation undefined - Geolocation API not supported.');
      if (toggleLabel) toggleLabel.classList.add('is-error');
      if (toggleInput) toggleInput.checked = false;
      if (addressText) addressText.textContent = 'Not Supported';
      return;
    }
    if (addressText) addressText.textContent = 'Locating...';
    GPSDebug.step('Starting location watch (one-shot + watchPosition + interval poll)');

    GPSDebug.step('Calling getCurrentPosition (one-shot)',
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
    getCurrentPositionCompat(
      function (p) { handlePositionFix(p, 'one-shot'); },
      handlePositionError,
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );

    GPSDebug.step('Calling watchPosition',
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    watchId = watchPositionCompat(
      function (p) { handlePositionFix(p, 'watch'); },
      handlePositionError,
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
    GPSDebug.info('watchPosition id = ' + watchId);

    if (refreshTimerId) clearInterval(refreshTimerId);
    refreshTimerId = setInterval(function () {
      if (!navigator.geolocation) return;
      GPSDebug.step('Interval-triggered getCurrentPosition');
      getCurrentPositionCompat(
        function (p) { handlePositionFix(p, 'interval'); },
        function (e) { GPSDebug.warn('interval refresh failed', e.message); },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    }, HARD_REFRESH_INTERVAL_MS);
    GPSDebug.info('Interval poll every ' + HARD_REFRESH_INTERVAL_MS + 'ms armed.');
  }

  function stopWatching() {
    if (watchId !== null) {
      clearWatchCompat(watchId);
      GPSDebug.info('Cleared watchPosition id=' + watchId);
      watchId = null;
    }
    if (refreshTimerId !== null) {
      clearInterval(refreshTimerId);
      GPSDebug.info('Cleared interval poll.');
      refreshTimerId = null;
    }
    lastGeocodedCoords = null;
    lastGeocodedAt = 0;
    recentFixes = [];
    if (toggleLabel) {
      toggleLabel.classList.remove('is-active');
      toggleLabel.classList.remove('is-error');
      toggleLabel.classList.remove('is-low-accuracy');
      toggleLabel.title = '';
    }
  }

  if (toggleInput && toggleLabel) {
    // --- Boot-time restore: location stays ON by default, persisted in
    //     localStorage so user preference also survives across pages. ---
    var STORAGE_KEY = 'roadsos.location.enabled';
    function loadPreferredState() {
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (raw == null) return true; // default ON
        return raw === '1' || raw === 'true';
      } catch (e) { return true; }
    }
    function savePreferredState(on) {
      try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); } catch (e) {}
    }

    var bootOn = loadPreferredState();
    if (bootOn) {
      toggleInput.checked = true;
      toggleLabel.classList.add('is-active');
      // Programmatic .checked = true does NOT fire 'change'; drive it ourselves.
      // Defer so the rest of the DOMContentLoaded handlers wire up first.
      setTimeout(function () {
        GPSDebug.step('Boot-restore: location preference is ON, auto-starting watch');
        startWatching();
      }, 0);
    }

    toggleLabel.addEventListener('keydown', function (e) {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleInput.click(); }
    });

    toggleInput.addEventListener('change', function () {
      savePreferredState(toggleInput.checked);
      if (toggleInput.checked) {
        GPSDebug.step('User toggled location ON');
        toggleLabel.classList.remove('is-error');
        startWatching();
      } else {
        GPSDebug.step('User toggled location OFF');
        stopWatching();
        if (window.RoadSOSState) window.RoadSOSState.set('gpsCoordinates', null);
        if (addressText) { addressText.textContent = 'Location OFF'; addressText.removeAttribute('title'); }
      }
    });

    if (addressPill) {
      addressPill.addEventListener('click', function (e) {
        if (!toggleInput.checked) return;
        e.preventDefault(); e.stopPropagation();
        GPSDebug.step('Manual refresh requested by user (clicked pin)');
        if (addressText) addressText.textContent = 'Refreshing...';
        lastGeocodedCoords = null; lastGeocodedAt = 0;
        if (!navigator.geolocation) return;
        getCurrentPositionCompat(
          function (p) { handlePositionFix(p, 'manual'); },
          handlePositionError,
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      });
    }
  }
});

function buildDebugPanel() {
  if (document.getElementById('gps-debug-panel')) return;
  var toggleBtn = document.createElement('button');
  toggleBtn.id = 'gps-debug-toggle';
  toggleBtn.type = 'button';
  toggleBtn.textContent = 'GPS Debug';
  toggleBtn.style.cssText =
    'position:fixed;bottom:80px;right:12px;z-index:9998;' +
    'background:#1f1f1f;color:#fff;border:1px solid #555;' +
    'padding:6px 10px;border-radius:6px;font-size:12px;' +
    'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;' +
    'cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.25);';

  var panel = document.createElement('div');
  panel.id = 'gps-debug-panel';
  panel.style.cssText =
    'position:fixed;bottom:120px;right:12px;z-index:9999;' +
    'width:min(440px,92vw);height:min(380px,60vh);' +
    'background:rgba(20,20,22,0.96);color:#eee;border:1px solid #444;' +
    'border-radius:10px;padding:10px;display:none;flex-direction:column;' +
    'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;' +
    'box-shadow:0 8px 28px rgba(0,0,0,0.4);';
  panel.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:8px;">' +
      '<strong style="color:#fff;">GPS Debug Console</strong>' +
      '<div>' +
        '<button id="gps-debug-clear" type="button" style="background:#333;color:#fff;border:1px solid #555;padding:2px 6px;border-radius:4px;font-size:11px;cursor:pointer;">clear</button> ' +
        '<button id="gps-debug-close" type="button" style="background:#333;color:#fff;border:1px solid #555;padding:2px 6px;border-radius:4px;font-size:11px;cursor:pointer;">x</button>' +
      '</div>' +
    '</div>' +
    '<div id="gps-debug-state" style="background:#000;color:#9ef;border:1px solid #234;border-radius:4px;padding:4px 6px;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Waiting for first fix...</div>' +
    '<div id="gps-debug-log" style="flex:1;overflow-y:auto;background:#111;border:1px solid #2a2a2a;border-radius:4px;padding:6px;line-height:1.4;"></div>' +
    '<div style="margin-top:6px;color:#888;font-size:10px;">Tip: DevTools (F12) -> Sensors -> set custom Location to simulate movement.</div>';

  document.body.appendChild(toggleBtn);
  document.body.appendChild(panel);
  toggleBtn.addEventListener('click', function () {
    panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
  });
  panel.querySelector('#gps-debug-close').addEventListener('click', function () { panel.style.display = 'none'; });
  panel.querySelector('#gps-debug-clear').addEventListener('click', function () { GPSDebug.clear(); });
}
