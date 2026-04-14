export function apiBase() {
  const isLocalStatic =
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") &&
    window.location.port === "5500";
  return isLocalStatic ? "http://127.0.0.1:5000" : "";
}

export function apiUrl(path) {
  return `${apiBase()}${path}`;
}

export function extractTokenFromSupabaseStorage() {
  const direct =
    window.localStorage.getItem("sb-access-token") ||
    window.localStorage.getItem("supabaseAccessToken") ||
    "";
  if (direct) {
    return direct;
  }

  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key || !key.startsWith("sb-") || !key.endsWith("-auth-token")) {
      continue;
    }

    const raw = window.localStorage.getItem(key);
    if (!raw) {
      continue;
    }

    try {
      const parsed = JSON.parse(raw);
      const token = String(parsed?.access_token || "").trim();
      if (token) {
        return token;
      }
    } catch (_error) {
      // Ignore invalid localStorage token formats.
    }
  }

  return "";
}

export function authHeaders() {
  const token = extractTokenFromSupabaseStorage();
  if (!token) {
    return { "Content-Type": "application/json" };
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

export async function apiFetch(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    credentials: "include",
    ...options,
    headers: {
      ...authHeaders(),
      ...(options.headers || {}),
    },
  });

  const isJson = (response.headers.get("content-type") || "").includes("application/json");
  const payload = isJson ? await response.json() : null;

  return { response, payload };
}
