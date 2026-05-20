/* state.js - Reactive Telemetry State Repository */

window.RoadSOSState = (() => {
  // Internal private state fields
  const _state = {
    gpsCoordinates: null,
    activeRescueBeacon: null,
    selectedService: null,
    fleetLocations: [
      { id: 4, type: 'towing', name: 'Rescue Truck #04', lat: 28.5395, lng: 77.2080, distance: '1.2 miles' },
      { id: 12, type: 'battery', name: 'Rescue Motor #12', lat: 28.5360, lng: 77.2110, distance: '2.4 miles' }
    ]
  };

  const _listeners = [];

  return {
    get: (key) => _state[key],
    
    set: (key, value) => {
      _state[key] = value;
      // Trigger all reactive listener events
      _listeners.forEach(fn => fn(key, value));
    },
    
    subscribe: (fn) => {
      if (typeof fn === 'function') {
        _listeners.push(fn);
      }
    }
  };
})();
