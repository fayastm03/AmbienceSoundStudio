// Adapts the shared Netlify-style handler to Vercel's Node.js function API.
const { handler } = require("../netlify/functions/mix.js");

module.exports = async function mix(request, response) {
  const body = typeof request.body === "string"
    ? request.body
    : JSON.stringify(request.body || {});
  const result = await handler({
    httpMethod: request.method,
    headers: request.headers,
    body,
  });

  Object.entries(result.headers || {}).forEach(([name, value]) => {
    response.setHeader(name, value);
  });
  response.status(result.statusCode).send(result.body);
};
