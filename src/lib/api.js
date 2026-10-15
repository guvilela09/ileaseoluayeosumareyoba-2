export function createApi(getToken, auth) {
  async function api(path, { method = 'GET', body } = {}) {
    const token = await getToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const response = await fetch(path, {
      method, headers,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data.detail || data.error;
      const message = typeof detail === 'string' ? detail : 'Não foi possível completar a ação. Confira os dados e tente novamente.';
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return data;
  }
  api.upload = async (file, kind = 'image') => {
    const upload = await auth.upload(file, kind);
    return api('/api/uploads/register', { method: 'POST', body: { ...upload, kind } });
  };
  return api;
}
