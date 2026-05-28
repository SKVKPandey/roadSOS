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

  const toggleLabel = document.getElementById('location-toggle-label');
  const toggleInput = document.getElementById('location-toggle-input');
  const addressText = document.getElementById('address-text');
  
  let watchId = null;
  let lastGeocodedCoords = null;

  // Simple check to throttle reverse geocoding requests (only query if moved > ~100m)
  function shouldGeocode(lat, lng) {
    if (!lastGeocodedCoords) return true;
    const threshold = 0.001;
    return Math.abs(lat - lastGeocodedCoords.lat) > threshold || 
           Math.abs(lng - lastGeocodedCoords.lng) > threshold;
  }

  async function updateApproximateAddress(lat, lng) {
    if (!addressText) return;
    
    try {
      addressText.textContent = 'Fetching address...';
      
      let data = null;
      try {
        // Try fetching via local backend proxy first
        const response = await fetch(`/api/v1/geocode?lat=${lat}&lng=${lng}`);
        if (response.ok) {
          data = await response.json();
        } else {
          console.warn('[GPS] Geocoding proxy returned non-OK status. Falling back. Status:', response.status);
        }
      } catch (proxyErr) {
        console.warn('[GPS] Geocoding proxy unavailable, falling back to direct OSM request:', proxyErr.message);
      }
      
      // Fallback: fetch from OpenStreetMap directly if proxy failed
      if (!data) {
        const osmUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16`;
        const response = await fetch(osmUrl, {
          headers: {
            'Accept-Language': 'en'
          }
        });
        if (!response.ok) throw new Error('Direct OSM Geocoding response error: ' + response.status);
        data = await response.json();
      }
      
      if (data && data.address) {
        const addr = data.address;
        const road = addr.road || addr.street || '';
        
        // Clean up suburb (e.g. "Zone 13 Adyar" -> "Adyar")
        let suburb = addr.suburb || '';
        if (suburb.startsWith('Zone ')) {
          suburb = suburb.replace(/^Zone \d+\s+/, '');
        }
        
        // Filter out unhelpful neighborhoods (e.g. water divisions, administrative wards)
        let neighborhood = addr.neighbourhood || addr.village || addr.hamlet || '';
        if (neighborhood.toLowerCase().includes('division') || 
            neighborhood.toLowerCase().includes('ward') || 
            neighborhood.toLowerCase().includes('cmwssb') ||
            neighborhood.toLowerCase().includes('zone')) {
          neighborhood = '';
        }
        
        const city = addr.city || addr.town || addr.municipality || addr.state || '';
        
        const parts = [];
        if (road) parts.push(road);
        if (suburb) {
          parts.push(suburb);
        } else if (neighborhood) {
          parts.push(neighborhood);
        }
        if (city && parts.length < 2) {
          parts.push(city);
        }
        
        let displayStr = parts.join(', ');
        if (!displayStr) {
          displayStr = data.display_name.split(',')[0] || 'Approx. Location';
        }
        
        addressText.textContent = displayStr;
        addressText.title = data.display_name; // Tooltip for full description
        lastGeocodedCoords = { lat, lng };
      } else {
        console.log('[DEBUG PIPELINE] 5. No valid address data found in response.');
        addressText.textContent = 'Approx. Location';
      }
    } catch (err) {
      console.error('[GPS] Reverse geocoding failed:', err);
      addressText.textContent = 'Location Locked';
    }
  }

  if (toggleInput && toggleLabel) {
    // Accessibility: toggle checkbox with Enter/Space on label
    toggleLabel.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        toggleInput.click();
      }
    });

    toggleInput.addEventListener('change', () => {
      if (toggleInput.checked) {
        // Clear any previous error state
        toggleLabel.classList.remove('is-error');
        
        if (addressText) {
          addressText.textContent = 'Locating...';
        }

        if (!navigator.geolocation) {
          console.warn('[GPS] Geolocation is not supported by this browser.');
          toggleLabel.classList.add('is-error');
          toggleInput.checked = false;
          if (addressText) addressText.textContent = 'Not Supported';
          return;
        }

        // Start watching position
        watchId = navigator.geolocation.watchPosition(
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

            // Update UI feedback
            toggleLabel.classList.add('is-active');
            toggleLabel.classList.remove('is-error');
            if (addressText.textContent === 'Locating...') {
               addressText.textContent = 'Location ON';
            }

            // Geocode if threshold is passed
            if (shouldGeocode(coords.lat, coords.lng)) {
              updateApproximateAddress(coords.lat, coords.lng);
            }

            // Feed into Dashboard Live Terminal logs if present
            const terminal = document.querySelector('.telemetry-terminal');
            if (terminal) {
              const now = new Date();
              const timeStr = now.toTimeString().split(' ')[0];
              const syncRow = document.createElement('div');
              syncRow.className = 'terminal-row flex gap-4';
              syncRow.innerHTML = `
                <span class="text-success font-medium">[${timeStr}]</span>
                <span class="text-success font-semibold">[GPS] Dynamic coordinates: ${coords.lat.toFixed(4)}° N, ${coords.lng.toFixed(4)}° E (accuracy: ${coords.accuracy.toFixed(1)}m)</span>
              `;
              terminal.appendChild(syncRow);
              terminal.scrollTop = terminal.scrollHeight;
            }
          },
          (error) => {
            console.warn('[GPS] Geolocation coordinates access failed/suspended:', error.message);
            toggleLabel.classList.remove('is-active');
            toggleLabel.classList.add('is-error');
            toggleInput.checked = false;
            
            if (addressText) {
              addressText.textContent = 'Access Denied';
            }
            
            if (window.RoadSOSState) {
              window.RoadSOSState.set('gpsCoordinates', null);
            }

            if (watchId !== null) {
              navigator.geolocation.clearWatch(watchId);
              watchId = null;
            }
            lastGeocodedCoords = null;
          },
          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
          }
        );
      } else {
        // Switched off
        if (watchId !== null) {
          navigator.geolocation.clearWatch(watchId);
          watchId = null;
        }

        if (window.RoadSOSState) {
          window.RoadSOSState.set('gpsCoordinates', null);
        }

        toggleLabel.classList.remove('is-active');
        toggleLabel.classList.remove('is-error');

        if (addressText) {
          addressText.textContent = 'Location OFF';
          addressText.removeAttribute('title');
        }
        lastGeocodedCoords = null;
      }
    });
  }
});
