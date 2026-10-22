export function requireAuth(request, response, next) {
  if (!request.session.userId) return response.status(401).json({ error: "Authentication required" });
  return next();
}
