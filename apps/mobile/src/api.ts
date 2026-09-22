import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { apiEnvironment, environmentUrl } from "./environment";

const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (__DEV__ ? "http://127.0.0.1:3107/api/v1" : "");
let environment = "production";
let accessToken: string | null = null;
let refreshFlight: Promise<void> | null = null;
export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}
export type Pending = {
  id: string;
  actorId: string;
  epoch: string;
  route: string;
};
async function raw(path: string, options: RequestInit = {}) {
  if (!API_URL) throw new ApiError("Адрес сервера не настроен");
  try {
    return await fetch(`${environmentUrl(API_URL, environment)}${path}`, {
      ...options,
      signal: AbortSignal.timeout(12000),
      headers: { "Content-Type": "application/json", ...options.headers },
    });
  } catch {
    throw new ApiError("Нет соединения с сервером. Проверьте интернет.");
  }
}
async function parse(response: Response) {
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(
      Array.isArray(data.message)
        ? data.message.join("\n")
        : (data.message ?? "Не удалось выполнить запрос"),
      response.status,
    );
  return data;
}
async function acceptTokens(data: {
  accessToken: string;
  refreshToken: string;
}) {
  await SecureStore.setItemAsync("mrba.refresh", data.refreshToken);
  accessToken = data.accessToken;
}
export async function login(login: string, password: string) {
  environment = apiEnvironment(login);
  await SecureStore.setItemAsync("mrba.environment", environment);
  let deviceId = await SecureStore.getItemAsync("mrba.device");
  if (!deviceId) {
    deviceId = Crypto.randomUUID();
    await SecureStore.setItemAsync("mrba.device", deviceId);
  }
  await acceptTokens(
    await parse(
      await raw("/auth/login", {
        method: "POST",
        body: JSON.stringify({ login, password, deviceId }),
      }),
    ),
  );
}
export async function restore() {
  environment = (await SecureStore.getItemAsync("mrba.environment")) === "demo" ? "demo" : "production";
  const token = await SecureStore.getItemAsync("mrba.refresh");
  if (!token) return false;
  await refresh();
  return true;
}
async function refresh() {
  if (!refreshFlight)
    refreshFlight = (async () => {
      const token = await SecureStore.getItemAsync("mrba.refresh");
      if (!token) throw new ApiError("Войдите в систему", 401);
      await acceptTokens(
        await parse(
          await raw("/auth/refresh", {
            method: "POST",
            body: JSON.stringify({ refreshToken: token }),
          }),
        ),
      );
    })().finally(() => {
      refreshFlight = null;
    });
  return refreshFlight;
}
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let response = await raw(path, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, ...options.headers },
  });
  if (response.status === 401) {
    await refresh();
    response = await raw(path, {
      ...options,
      headers: { Authorization: `Bearer ${accessToken}`, ...options.headers },
    });
  }
  return parse(response);
}
export async function logout() {
  const refreshToken = await SecureStore.getItemAsync("mrba.refresh");
  // Revocation must succeed before reporting a successful logout.
  if (refreshToken)
    await parse(
      await raw("/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refreshToken }),
      }),
    );
  accessToken = null;
  await SecureStore.deleteItemAsync("mrba.refresh");
}
export async function pending(): Promise<Pending | null> {
  const s = await SecureStore.getItemAsync("mrba.pending");
  return s ? JSON.parse(s) : null;
}
export async function resolvePending() {
  const marker = await pending();
  if (!marker) return null;
  const me = await api("/auth/me");
  if (me.id !== marker.actorId)
    throw new ApiError(
      "Неопределённый запрос относится к другой учётной записи. Войдите под его автором.",
    );
  const context = await api("/system/context");
  if (context.recoveryEpoch !== marker.epoch)
    throw new ApiError(
      "Сервер восстановлен. Необходима сверка операции с владельцем; повтор заблокирован.",
    );
  let result;
  try {
    result = await api(`/commands/${marker.id}`);
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 404) throw e;
    let draft;
    try {
      draft = await api(`/drafts/${marker.id}`);
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 404) throw err;
      // Under the same server lock, fence any late request before clearing the marker.
      result = await api(`/drafts/${marker.id}/cancel`, {
        method: "POST",
        headers: { "X-Recovery-Epoch": marker.epoch },
      });
    }
    if (draft) {
      if (draft.status === "DRAFT")
        await api(`/drafts/${marker.id}/prepare`, {
          method: "POST",
          headers: { "X-Recovery-Epoch": marker.epoch },
          body: JSON.stringify({ version: draft.version }),
        });
      if (draft.epoch !== marker.epoch || draft.route !== marker.route)
        throw new ApiError("Данные операции изменены");
      try {
        result = await api(draft.route, {
          method: "POST",
          headers: {
            "Idempotency-Key": marker.id,
            "X-Recovery-Epoch": marker.epoch,
          },
          body: JSON.stringify(draft.payload),
        });
      } catch (err) {
        if (
          err instanceof ApiError &&
          [400, 401, 403, 404, 409, 422, 429].includes(err.status)
        ) {
          await api(`/drafts/${marker.id}/cancel`, {
            method: "POST",
            headers: { "X-Recovery-Epoch": marker.epoch },
          });
          await SecureStore.deleteItemAsync("mrba.pending");
        }
        throw err;
      }
    }
  }
  await SecureStore.deleteItemAsync("mrba.pending");
  return result;
}
async function mutateInternal(path: string, body: unknown) {
  if (await pending())
    throw new ApiError("Сначала уточните результат предыдущей операции.");
  const [me, context] = await Promise.all([
    api("/auth/me"),
    api("/system/context"),
  ]);
  const marker: Pending = {
    id: Crypto.randomUUID(),
    actorId: me.id,
    epoch: context.recoveryEpoch,
    route: path,
  };
  await SecureStore.setItemAsync("mrba.pending", JSON.stringify(marker));
  try {
    if (!path.startsWith("/users"))
      await api(`/drafts/${marker.id}`, {
        method: "POST",
        headers: { "X-Recovery-Epoch": marker.epoch },
        body: JSON.stringify({ route: path, payload: body }),
      });
    const result = await api(path, {
      method: "POST",
      headers: {
        "Idempotency-Key": marker.id,
        "X-Recovery-Epoch": marker.epoch,
      },
      body: JSON.stringify(body),
    });
    await SecureStore.deleteItemAsync("mrba.pending");
    return result;
  } catch (error) {
    // A deterministic rejection cannot have committed; a network/5xx failure is ambiguous.
    if (
      error instanceof ApiError &&
      [400, 401, 403, 409, 422, 429].includes(error.status)
    ) {
      await api(`/drafts/${marker.id}/cancel`, {
        method: "POST",
        headers: { "X-Recovery-Epoch": marker.epoch },
      });
      await SecureStore.deleteItemAsync("mrba.pending");
    }
    throw error;
  }
}

export type Page<T> = { items: T[]; nextCursor: string | null };
export async function all<T = any>(path: string): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;
  do {
    const data: any = await api(
      path +
        (path.includes("?") ? "&" : "?") +
        "limit=100" +
        (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
    );
    if (Array.isArray(data)) return data;
    items.push(...data.items);
    cursor = data.nextCursor;
  } while (cursor);
  return items;
}

let mutationBusy = false;
export async function mutate(path: string, body: unknown) {
  if (mutationBusy) throw new ApiError("Дождитесь завершения текущей операции");
  mutationBusy = true;
  try {
    return await mutateInternal(path, body);
  } finally {
    mutationBusy = false;
  }
}
export async function saveDraft(path: string, body: unknown) {
  const context = await api("/system/context");
  return api("/drafts/" + Crypto.randomUUID(), {
    method: "POST",
    headers: { "X-Recovery-Epoch": context.recoveryEpoch },
    body: JSON.stringify({ route: path, payload: body, status: "DRAFT" }),
  });
}
export async function resumeDraft(id: string) {
  if (await pending())
    throw new ApiError("Сначала уточните предыдущую операцию");
  const d = await api("/drafts/" + id);
  const context = await api("/system/context");
  if (context.recoveryEpoch !== d.epoch)
    throw new ApiError("Сервер восстановлен. Требуется сверка операции");
  await SecureStore.setItemAsync(
    "mrba.pending",
    JSON.stringify({
      id: d.id,
      actorId: d.actorId,
      epoch: d.epoch,
      route: d.route,
    }),
  );
  await api("/drafts/" + id + "/prepare", {
    method: "POST",
    headers: { "X-Recovery-Epoch": d.epoch },
    body: JSON.stringify({ version: d.version }),
  });
  return resolvePending();
}
export async function editDraft(id: string, version: number, payload: unknown) {
  const c = await api("/system/context");
  return api("/drafts/" + id + "/edit", {
    method: "POST",
    headers: { "X-Recovery-Epoch": c.recoveryEpoch },
    body: JSON.stringify({ version, payload }),
  });
}
export async function cancelDraft(id: string) {
  const c = await api("/system/context");
  const result = await api("/drafts/" + id + "/cancel", {
    method: "POST",
    headers: { "X-Recovery-Epoch": c.recoveryEpoch },
  });
  if (result.type !== "CANCELLED")
    throw new ApiError(
      "Операция уже проведена. Отмена черновика не отменяет проведённый документ.",
    );
  return result;
}
