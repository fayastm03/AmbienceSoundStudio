export function errorHandler(error, _request, response, next) {
  if (response.headersSent) return next(error);
  console.error(`[server] ${error.name || "Error"}: request failed`);
  const status = error.status || error.statusCode || 500;
  response.status(status).json({ error: error.message || "Internal server error" });
}
