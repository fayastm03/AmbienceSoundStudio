const baseUrl = process.env.SMOKE_URL || "http://localhost:3000";

function createClient() {
  let cookie = "";
  return async function request(path, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      Origin: baseUrl,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.headers || {}),
    };
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, { ...options, headers });
    } catch (error) {
      if (error.cause?.code === "ECONNREFUSED" || error.message?.includes("fetch failed")) {
        console.error(`\n[smoke-mixes] Error: Could not connect to server at ${baseUrl}`);
        console.error("[smoke-mixes] The server must be running before running smoke tests. In another terminal, run:");
        console.error("  npm run dev\n");
        process.exit(1);
      }
      throw error;
    }
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    let body = {};
    try {
      body = await response.json();
    } catch {}
    return { response, body };
  };
}

function expect(status, actual, label) {
  if (actual !== status) {
    throw new Error(`${label}: expected ${status}, got ${actual}`);
  }
}

const validLevels = {
  rain: {
    channel: 0.6,
    layers: {
      "heavy-rain": 0.5,
      "light-rain": 0.3,
      window: 0.2,
      roof: 0.4,
      thunder: 0.1,
    },
  },
  coffee: {
    channel: 0.4,
    layers: {
      chatter: 0.6,
      espresso: 0.3,
    },
  },
  fire: {
    channel: 0.3,
    layers: {
      crackle: 0.5,
      firewood: 0.4,
      embers: 0.2,
    },
  },
};

const fakeId = "64b1f2e9a1b2c3d4e5f6a7b8";

// 1. Guest access - all routes return 401
const guest = createClient();
const guestList = await guest("/api/mixes");
expect(401, guestList.response.status, "guest list mixes");

const guestCreate = await guest("/api/mixes", {
  method: "POST",
  body: JSON.stringify({ name: "Guest Mix", levels: validLevels }),
});
expect(401, guestCreate.response.status, "guest create mix");

const guestRename = await guest(`/api/mixes/${fakeId}`, {
  method: "PATCH",
  body: JSON.stringify({ name: "Guest Rename" }),
});
expect(401, guestRename.response.status, "guest rename mix");

const guestDelete = await guest(`/api/mixes/${fakeId}`, {
  method: "DELETE",
  body: "{}",
});
expect(401, guestDelete.response.status, "guest delete mix");

// 2. Register & log in User A
const userA = createClient();
const userAEmail = `smoke-mixes-a-${Date.now()}@example.com`;
const password = "correct-horse-battery";
const regA = await userA("/api/auth/register", {
  method: "POST",
  body: JSON.stringify({ email: userAEmail, password, displayName: "User A" }),
});
expect(201, regA.response.status, "register user A");

const loginA = await userA("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ email: userAEmail, password }),
});
expect(200, loginA.response.status, "login user A");

// User A initial mix list is empty
const listA0 = await userA("/api/mixes");
expect(200, listA0.response.status, "user A initial list");
if (!Array.isArray(listA0.body.mixes) || listA0.body.mixes.length !== 0) {
  throw new Error("expected empty mixes array for new user");
}

// 3. Invalid payloads rejected
// Blank name
const badName = await userA("/api/mixes", {
  method: "POST",
  body: JSON.stringify({ name: "   ", levels: validLevels }),
});
expect(400, badName.response.status, "blank name rejected");

// Name too long (>40 chars)
const longName = await userA("/api/mixes", {
  method: "POST",
  body: JSON.stringify({ name: "a".repeat(41), levels: validLevels }),
});
expect(400, longName.response.status, "overlong name rejected");

// Unknown channel
const unknownChannel = await userA("/api/mixes", {
  method: "POST",
  body: JSON.stringify({
    name: "Bad Channel",
    levels: { ...validLevels, ocean: { channel: 0.5, layers: {} } },
  }),
});
expect(400, unknownChannel.response.status, "unknown channel rejected");

// Unknown layer
const unknownLayer = await userA("/api/mixes", {
  method: "POST",
  body: JSON.stringify({
    name: "Bad Layer",
    levels: {
      ...validLevels,
      rain: { ...validLevels.rain, layers: { ...validLevels.rain.layers, whale: 0.5 } },
    },
  }),
});
expect(400, unknownLayer.response.status, "unknown layer rejected");

// Out of range volume (> 1)
const highVolume = await userA("/api/mixes", {
  method: "POST",
  body: JSON.stringify({
    name: "High Vol",
    levels: {
      ...validLevels,
      rain: { ...validLevels.rain, channel: 1.5 },
    },
  }),
});
expect(400, highVolume.response.status, "high volume rejected");

// Out of range volume (< 0)
const lowVolume = await userA("/api/mixes", {
  method: "POST",
  body: JSON.stringify({
    name: "Low Vol",
    levels: {
      ...validLevels,
      rain: { ...validLevels.rain, channel: -0.2 },
    },
  }),
});
expect(400, lowVolume.response.status, "negative volume rejected");

// Extra field at root (e.g. master volume or userId injection)
const extraRoot = await userA("/api/mixes", {
  method: "POST",
  body: JSON.stringify({
    name: "Extra Root",
    levels: validLevels,
    master: 0.8,
  }),
});
expect(400, extraRoot.response.status, "extra root field master rejected");

const userIdInject = await userA("/api/mixes", {
  method: "POST",
  body: JSON.stringify({
    name: "Inject User",
    levels: validLevels,
    userId: fakeId,
  }),
});
expect(400, userIdInject.response.status, "userId in body rejected");

// Over 8 KB payload
const largePayload = await userA("/api/mixes", {
  method: "POST",
  body: JSON.stringify({
    name: "Huge Mix",
    levels: validLevels,
    extraPaddedData: "x".repeat(9000),
  }),
});
if (largePayload.response.status !== 413 && largePayload.response.status !== 400) {
  throw new Error(`expected 413 or 400 for >8KB payload, got ${largePayload.response.status}`);
}

// Invalid ObjectId format in URL returns 404
const badIdPatch = await userA("/api/mixes/not-a-valid-id", {
  method: "PATCH",
  body: JSON.stringify({ name: "Rename" }),
});
expect(404, badIdPatch.response.status, "invalid objectid patch returns 404");

const badIdDelete = await userA("/api/mixes/not-a-valid-id", {
  method: "DELETE",
  body: "{}",
});
expect(404, badIdDelete.response.status, "invalid objectid delete returns 404");

// 4. Create valid mix
const createRes = await userA("/api/mixes", {
  method: "POST",
  body: JSON.stringify({ name: "Study Focus", levels: validLevels, source: "manual" }),
});
expect(201, createRes.response.status, "create mix");
const mixA = createRes.body.mix;
if (!mixA || !mixA.id || mixA.name !== "Study Focus") {
  throw new Error("created mix body invalid");
}
if (mixA.master !== undefined || mixA.levels.master !== undefined) {
  throw new Error("master volume must not be saved");
}

// 5. User A lists mixes
const listA1 = await userA("/api/mixes");
expect(200, listA1.response.status, "list mixes after create");
if (listA1.body.mixes.length !== 1 || listA1.body.mixes[0].id !== mixA.id) {
  throw new Error("list mixes did not contain created mix");
}

// 6. User A renames mix
const renameRes = await userA(`/api/mixes/${mixA.id}`, {
  method: "PATCH",
  body: JSON.stringify({ name: "Night Rain Study" }),
});
expect(200, renameRes.response.status, "rename mix");
if (renameRes.body.mix.name !== "Night Rain Study") {
  throw new Error("rename mix did not update name");
}

// Rename with extra fields rejected
const badRenameExtra = await userA(`/api/mixes/${mixA.id}`, {
  method: "PATCH",
  body: JSON.stringify({ name: "New Name", levels: validLevels }),
});
expect(400, badRenameExtra.response.status, "rename with extra fields rejected");

// 7. Isolation check: User B cannot access or mutate User A's mix
const userB = createClient();
const userBEmail = `smoke-mixes-b-${Date.now()}@example.com`;
const regB = await userB("/api/auth/register", {
  method: "POST",
  body: JSON.stringify({ email: userBEmail, password, displayName: "User B" }),
});
expect(201, regB.response.status, "register user B");

const loginB = await userB("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ email: userBEmail, password }),
});
expect(200, loginB.response.status, "login user B");

// User B's list does not show User A's mix
const listB = await userB("/api/mixes");
expect(200, listB.response.status, "user B list mixes");
if (listB.body.mixes.length !== 0) {
  throw new Error("user B saw user A's mixes");
}

// User B attempting to read User A's mix returns 404
const bGetA = await userB(`/api/mixes/${mixA.id}`);
expect(404, bGetA.response.status, "user B read user A mix returns 404");

// User B attempting to rename User A's mix returns 404
const bRenameA = await userB(`/api/mixes/${mixA.id}`, {
  method: "PATCH",
  body: JSON.stringify({ name: "Hacked by B" }),
});
expect(404, bRenameA.response.status, "user B rename user A mix returns 404");

// User B attempting to delete User A's mix returns 404
const bDeleteA = await userB(`/api/mixes/${mixA.id}`, {
  method: "DELETE",
  body: "{}",
});
expect(404, bDeleteA.response.status, "user B delete user A mix returns 404");

// 8. User A deletes their mix
const deleteRes = await userA(`/api/mixes/${mixA.id}`, {
  method: "DELETE",
  body: "{}",
});
expect(200, deleteRes.response.status, "user A delete mix");

// User A's list is empty again
const listA2 = await userA("/api/mixes");
expect(200, listA2.response.status, "list mixes after delete");
if (listA2.body.mixes.length !== 0) {
  throw new Error("mix was not removed from list");
}

// User A deleting non-existent mix returns 404
const deleteAgain = await userA(`/api/mixes/${mixA.id}`, {
  method: "DELETE",
  body: "{}",
});
expect(404, deleteAgain.response.status, "delete deleted mix returns 404");

console.log("Saved mixes smoke test passed");

