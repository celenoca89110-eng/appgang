/* Petit wrapper fetch() qui ajoute automatiquement le token JWT et gère les erreurs. */
const Api = (() => {
  function getToken() {
    return sessionStorage.getItem('gangapp_token');
  }
  function setToken(token) {
    sessionStorage.setItem('gangapp_token', token);
  }
  function clearToken() {
    sessionStorage.removeItem('gangapp_token');
  }

  async function request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      /* pas de corps JSON (ex: 204) */
    }

    if (!res.ok) {
      const message = (data && data.error) || `Erreur ${res.status}`;
      const err = new Error(message);
      err.status = res.status;
      if (data && data.details) err.details = data.details;
      throw err;
    }
    return data;
  }

  return {
    getToken,
    setToken,
    clearToken,
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    del: (path) => request('DELETE', path),
  };
})();
