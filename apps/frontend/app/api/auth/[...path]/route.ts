async function handle(request: Request) {
  const url = new URL(request.url);
  if (request.method === 'POST' && (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site')) {
    return Response.json({ message: 'Invalid origin' }, { status: 403 });
  }
  const headers = new Headers();
  for (const name of ['cookie', 'origin', 'content-type', 'sec-fetch-site', 'user-agent']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    const response = await fetch(new URL(url.pathname + url.search, process.env.BACKEND_URL ?? 'http://127.0.0.1:3001'), {
      method: request.method,
      headers,
      body: request.method === 'POST' ? await request.text() : undefined,
      redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(30_000),
    });
    const outgoing = new Headers({ 'Cache-Control': 'no-store' });
    for (const name of ['content-type', 'location']) {
      const value = response.headers.get(name);
      if (value) outgoing.set(name, value);
    }
    for (const cookie of response.headers.getSetCookie()) outgoing.append('set-cookie', cookie);
    return new Response(response.body, { status: response.status, headers: outgoing });
  } catch {
    return Response.json({ message: 'Sign-in service unavailable. Please retry.' }, { status: 502 });
  }
}

export { handle as GET, handle as POST };
