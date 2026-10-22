const baseUrl = process.env.SMOKE_URL || "http://localhost:3000";
const email = `smoke-${Date.now()}@example.com`;
const password = "correct-horse-battery";
let cookie = "";

async function request(path, options = {}) {
  const headers = { "Content-Type": "application/json", Origin: baseUrl, ...(cookie ? { Cookie: cookie } : {}), ...(options.headers || {}) };
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  } catch (error) {
    if (error.cause?.code === "ECONNREFUSED" || error.message?.includes("fetch failed")) {
      console.error(`\n[smoke-auth] Error: Could not connect to server at ${baseUrl}`);
      console.error("[smoke-auth] The server must be running before running smoke tests. In another terminal, run:");
      console.error("  npm run dev\n");
      process.exit(1);
    }
    throw error;
  }
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  let body = {};
  try { body = await response.json(); } catch {}
  return { response, body };
}

function expect(status, actual, label) {
  if (actual !== status) throw new Error(`${label}: expected ${status}, got ${actual}`);
}

const guestMe = await request("/api/auth/me");
expect(200, guestMe.response.status, "guest /me");
if (guestMe.body.user !== null) throw new Error("guest /me returned a user");

const registered = await request("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password, displayName: "Smoke User" }) });
expect(201, registered.response.status, "register");
const duplicate = await request("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password }) });
expect(409, duplicate.response.status, "duplicate register");
const wrong = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password: "wrong-password-123" }) });
expect(401, wrong.response.status, "wrong password");
const loggedIn = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
expect(200, loggedIn.response.status, "login");
const me = await request("/api/auth/me");
expect(200, me.response.status, "authenticated /me");
if (!me.body.user?.email) throw new Error("authenticated /me did not return a user");
const loggedOut = await request("/api/auth/logout", { method: "POST", body: "{}" });
expect(200, loggedOut.response.status, "logout");
const afterLogout = await request("/api/auth/me");
if (afterLogout.body.user !== null) throw new Error("logout did not clear session");

let rateLimited = false;
for (let index = 0; index < 12; index += 1) {
  const attempt = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password: "wrong-password-123" }) });
  if (attempt.response.status === 429) rateLimited = true;
}
if (!rateLimited) throw new Error("login rate limit was not reached");
console.log("Authentication smoke test passed");
