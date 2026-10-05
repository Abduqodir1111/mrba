// Persist device authentication across tabs and browser restarts. Passwords are
// never stored. Pending commands remain tab-local to avoid cross-tab replay.
const persistentKeys = new Set(["mrba.refresh", "mrba.device", "mrba.environment"]);
const storage = (key: string) => persistentKeys.has(key)
  ? globalThis.localStorage : globalThis.sessionStorage;

export async function getItemAsync(key: string) {
  const value = storage(key).getItem(key);
  if (value !== null || !persistentKeys.has(key)) return value;
  const previous = globalThis.sessionStorage.getItem(key);
  if (previous !== null) {
    globalThis.localStorage.setItem(key, previous);
    globalThis.sessionStorage.removeItem(key);
  }
  return previous;
}

export async function setItemAsync(key: string, value: string) {
  storage(key).setItem(key, value);
  if (persistentKeys.has(key)) globalThis.sessionStorage.removeItem(key);
}

export async function deleteItemAsync(key: string) {
  storage(key).removeItem(key);
  globalThis.sessionStorage.removeItem(key);
}

export function onSessionRemoved(callback: () => void) {
  const handle = (event: StorageEvent) => {
    if (event.storageArea === globalThis.localStorage &&
        (event.key === null || event.key === "mrba.refresh") &&
        !globalThis.localStorage.getItem("mrba.refresh")) {
      globalThis.sessionStorage.removeItem("mrba.refresh");
      callback();
    }
  };
  globalThis.addEventListener("storage", handle);
  return () => globalThis.removeEventListener("storage", handle);
}
