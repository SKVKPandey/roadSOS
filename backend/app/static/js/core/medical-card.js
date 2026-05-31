/* medical-card.js - LocalStorage-backed medical card.
 *
 * MVP keeps everything on-device. No sync, no DB. Schema is intentionally
 * tiny so future-you can extend without migration headaches.
 */
window.RoadSOSMedCard = (function () {
  var KEY = 'roadsos.medcard.v1';

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) {
      console.warn('[medcard] read failed', e);
      return {};
    }
  }

  function write(card) {
    try {
      localStorage.setItem(KEY, JSON.stringify(card || {}));
      return true;
    } catch (e) {
      console.warn('[medcard] write failed', e);
      return false;
    }
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) {}
  }

  /** Snapshot a one-line summary, e.g. for SMS or hover tooltips. */
  function summary() {
    var c = read();
    var bits = [];
    if (c.name) bits.push(c.name);
    if (c.blood) bits.push(c.blood);
    if (c.allergies) bits.push('Allergies: ' + c.allergies);
    if (c.conditions) bits.push('Conditions: ' + c.conditions);
    return bits.join(' | ');
  }

  return { read: read, write: write, clear: clear, summary: summary };
})();
