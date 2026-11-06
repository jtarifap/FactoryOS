import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import {
  authorizeRequest,
  isAllowedHost,
  isAllowedOrigin,
  requiresJsonBody,
} from "../server/request-security.ts";

const panelHost = "127.0.0.1:5173";
const apiHost = "127.0.0.1:4177";
const panelOrigin = "http://127.0.0.1:5173";

function decide(overrides = {}) {
  return authorizeRequest({
    method: "GET",
    pathname: "/api/health",
    host: apiHost,
    origin: undefined,
    secFetchSite: undefined,
    contentType: undefined,
    ...overrides,
  });
}

test("only the documented loopback host and port combinations are accepted", () => {
  for (const host of ["127.0.0.1:4177", "localhost:4177", "127.0.0.1:5173", "localhost:5173", "LOCALHOST:5173"]) {
    assert.equal(isAllowedHost(host), true, host);
  }
  for (const host of [undefined, "", "evil.com", "evil.com:4177", "127.0.0.1:9999", "0.0.0.0:4177", "127.0.0.1", "127.0.0.1:5173.evil.com", "127.0.0.1:5173@evil.com"]) {
    assert.equal(isAllowedHost(host), false, String(host));
  }
});

test("only exact loopback panel and API origins are accepted", () => {
  for (const origin of [panelOrigin, "http://localhost:5173", "http://127.0.0.1:4177", "http://localhost:4177"]) {
    assert.equal(isAllowedOrigin(origin), true, origin);
  }
  for (const origin of [undefined, "null", "file://127.0.0.1", "http://evil.com", "http://127.0.0.1:9999", "http://127.0.0.1:5173/path", "http://127.0.0.1:5173@evil.com", "https://127.0.0.1:5173"]) {
    assert.equal(isAllowedOrigin(origin), false, String(origin));
  }
});

test("JSON bodies are required only on endpoints that parse JSON", () => {
  assert.equal(requiresJsonBody("POST", "/api/jobs"), true);
  assert.equal(requiresJsonBody("PUT", "/api/settings"), true);
  assert.equal(requiresJsonBody("POST", "/api/models/test"), true);
  assert.equal(requiresJsonBody("POST", "/api/preview/start"), true);
  assert.equal(requiresJsonBody("POST", "/api/preview/stop"), true);
  assert.equal(requiresJsonBody("POST", "/api/jobs/12345678/cancel"), false);
  assert.equal(requiresJsonBody("POST", "/api/settings/validate"), false);
  assert.equal(requiresJsonBody("GET", "/api/jobs"), false);
});

test("a legitimate panel request is allowed", () => {
  assert.deepEqual(decide({ method: "POST", pathname: "/api/jobs", host: panelHost, origin: panelOrigin, contentType: "application/json" }), { ok: true });
});

test("a local client without Origin is still allowed", () => {
  assert.deepEqual(decide({ method: "POST", pathname: "/api/jobs", contentType: "application/json" }), { ok: true });
  assert.deepEqual(decide({ method: "POST", pathname: "/api/jobs/12345678/cancel" }), { ok: true });
});

test("a foreign Origin is rejected even with a loopback Host", () => {
  const decision = decide({ method: "POST", pathname: "/api/jobs", origin: "http://evil.com", contentType: "application/json" });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 403);
});

test("Origin null and non-http origins are rejected for mutations", () => {
  for (const origin of ["null", "file://127.0.0.1"]) {
    const decision = decide({ method: "POST", pathname: "/api/jobs", origin, contentType: "application/json" });
    assert.equal(decision.ok, false);
    assert.equal(decision.status, 403);
  }
});

test("a foreign Host is rejected before anything else", () => {
  const decision = decide({ host: "evil.com:4177", origin: panelOrigin });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 403);
});

test("form-safe content types cannot reach JSON endpoints", () => {
  for (const contentType of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
    const decision = decide({ method: "POST", pathname: "/api/jobs", origin: panelOrigin, contentType });
    assert.equal(decision.ok, false);
    assert.equal(decision.status, 415);
  }
  assert.equal(decide({ method: "POST", pathname: "/api/jobs", origin: panelOrigin, contentType: "application/json; charset=utf-8" }).ok, true);
  assert.equal(decide({ method: "POST", pathname: "/api/jobs", origin: panelOrigin, contentType: "application/problem+json" }).ok, true);
  assert.equal(decide({ method: "POST", pathname: "/api/jobs", origin: panelOrigin, contentType: undefined }).ok, true);
});

test("cross-site browser requests cannot read or mutate the API", () => {
  const decision = decide({ pathname: "/api/jobs", secFetchSite: "cross-site" });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 403);
  assert.equal(decide({ pathname: "/preview-static/demo/", secFetchSite: "cross-site" }).ok, true);
});

test("preflight requests are rejected instead of advertising CORS", () => {
  const decision = decide({ method: "OPTIONS", pathname: "/api/jobs" });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 403);
});

async function withServer(run) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url || "/", "http://127.0.0.1");
    const decision = authorizeRequest({
      method: req.method || "GET",
      pathname: u.pathname,
      host: req.headers.host,
      origin: req.headers.origin,
      secFetchSite: req.headers["sec-fetch-site"],
      contentType: req.headers["content-type"],
    });
    res.writeHead(decision.ok ? 200 : decision.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(decision.ok ? { ok: true } : { error: decision.error }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    await run(address.port);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function request(port, { method = "GET", path = "/api/health", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers }, res => {
      let text = "";
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: text }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

test("real HTTP requests enforce Host, Origin and Content-Type", async () => {
  await withServer(async port => {
    const allowed = await request(port, {
      method: "POST",
      path: "/api/jobs",
      headers: { Host: panelHost, Origin: panelOrigin, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(allowed.status, 200);

    const noOrigin = await request(port, {
      method: "POST",
      path: "/api/jobs",
      headers: { Host: apiHost, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(noOrigin.status, 200);

    const evilOrigin = await request(port, {
      method: "POST",
      path: "/api/jobs",
      headers: { Host: apiHost, Origin: "http://evil.com", "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(evilOrigin.status, 403);

    const evilHost = await request(port, {
      path: "/api/health",
      headers: { Host: "evil.com:4177" },
    });
    assert.equal(evilHost.status, 403);

    const formBody = await request(port, {
      method: "POST",
      path: "/api/jobs",
      headers: { Host: apiHost, Origin: panelOrigin, "Content-Type": "text/plain" },
      body: "{}",
    });
    assert.equal(formBody.status, 415);

    const crossSite = await request(port, {
      path: "/api/jobs",
      headers: { Host: apiHost, "Sec-Fetch-Site": "cross-site" },
    });
    assert.equal(crossSite.status, 403);
  });
});
