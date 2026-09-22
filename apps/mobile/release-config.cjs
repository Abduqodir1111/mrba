function validateReleaseApiUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "Для релиза задайте EXPO_PUBLIC_API_URL: постоянный HTTPS-адрес API с /api/v1.",
    );
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !host.includes(".") ||
    host.endsWith(".local") ||
    host.endsWith(".localhost") ||
    host.endsWith(".test") ||
    host.endsWith(".invalid") ||
    /(^|\.)example\.(com|org|net)$/.test(host) ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
      host,
    ) ||
    url.pathname.replace(/\/$/, "") !== "/api/v1"
  ) {
    throw new Error(
      "Релиз требует публичный HTTPS API с /api/v1, без localhost, частного IP, примеров, пароля и query-параметров.",
    );
  }
  return url.toString().replace(/\/$/, "");
}
module.exports = { validateReleaseApiUrl };
