/* api.js - REST Fetch Interface Integrator */

window.RoadSOSAPI = (() => {
  const defaultHeaders = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  return {
    get: async (url) => {
      try {
        const response = await fetch(url, { method: 'GET', headers: defaultHeaders });
        return await response.json();
      } catch (err) {
        console.error(`[API ERROR] GET failed for ${url}:`, err);
        throw err;
      }
    },
    
    post: async (url, data = {}) => {
      try {
        const csrfToken = document.querySelector('input[name="csrf_token"]');
        const headers = { ...defaultHeaders };
        if (csrfToken) {
          headers['X-CSRFToken'] = csrfToken.value;
        }
        
        const response = await fetch(url, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(data)
        });
        return await response.json();
      } catch (err) {
        console.error(`[API ERROR] POST failed for ${url}:`, err);
        throw err;
      }
    }
  };
})();
