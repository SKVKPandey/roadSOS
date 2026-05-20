/* main.js - Core UI Interactivity & Browser Geolocation Handlers */

// 1. Mobile Drawer Slider Controller
function toggleMobileDrawer() {
  const drawer = document.getElementById('mobile-drawer');
  if (drawer) {
    drawer.classList.toggle('open');
  }
}

// 2. Global DOM Listeners & Geolocation Syncs
document.addEventListener('DOMContentLoaded', () => {
  console.log('[SYSTEM] roadSOS client engine initiated.');

  // Try to read user GPS coordinates safely
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy
        };
        
        // Sync to state management
        if (window.RoadSOSState) {
          window.RoadSOSState.set('gpsCoordinates', coords);
        }
        
        // Feed into Dashboard Live Terminal logs
        const terminal = document.querySelector('.telemetry-terminal');
        if (terminal) {
          const now = new Date();
          const timeStr = now.toTimeString().split(' ')[0];
          const syncRow = document.createElement('div');
          syncRow.className = 'terminal-row flex gap-4';
          syncRow.innerHTML = `
            <span class="text-success font-medium">[${timeStr}]</span>
            <span class="text-success font-semibold">[GPS] Locked coordinates: ${coords.lat.toFixed(4)}° N, ${coords.lng.toFixed(4)}° E (accuracy: ${coords.accuracy.toFixed(1)}m)</span>
          `;
          terminal.appendChild(syncRow);
          terminal.scrollTop = terminal.scrollHeight;
        }
      },
      (error) => {
        console.warn('[GPS] Geolocation coordinates access suspended:', error.message);
      }
    );
  }
});
