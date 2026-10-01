// Keep browser credentials scoped to the current tab. Closing the tab signs the
// user out and avoids leaving a long-lived refresh token in persistent storage.
const storage = () => globalThis.sessionStorage;

export async function getItemAsync(key: string) {
  return storage().getItem(key);
}

export async function setItemAsync(key: string, value: string) {
  storage().setItem(key, value);
}

export async function deleteItemAsync(key: string) {
  storage().removeItem(key);
}
