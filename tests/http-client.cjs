function createApiClient(base) {
  let cookie = '';
  const client = {
    get cookie() { return cookie; },
    async fetch(url, options = {}) {
      const location = url.startsWith('http') ? url : url.startsWith('/api/') ? `${new URL(base).origin}${url}` : `${base}${url}`;
      const response = await globalThis.fetch(location, { ...options, headers: { ...options.headers, ...(cookie ? { Cookie: cookie } : {}) } });
      for (const value of response.headers.getSetCookie()) {
        if (value.startsWith('bb_session=')) cookie = value.split(';')[0];
      }
      return response;
    },
    async json(method, route, body) {
      const response = await client.fetch(route, {
        method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = response.status === 204 ? null : await response.json();
      return { status: response.status, data, response };
    },
  };
  return client;
}

module.exports = { createApiClient };
