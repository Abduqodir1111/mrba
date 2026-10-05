export {
  deleteItemAsync,
  getItemAsync,
  setItemAsync,
} from "expo-secure-store";

export function onSessionRemoved(_callback: () => void) {
  return () => {};
}
