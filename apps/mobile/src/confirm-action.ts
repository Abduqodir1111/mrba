import { Alert, Platform } from "react-native";

type ConfirmActionOptions = {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
};

export function confirmAction({
  title,
  message,
  confirmText = "Подтвердить",
  cancelText = "Отмена",
  destructive = false,
  onConfirm,
}: ConfirmActionOptions) {
  if (Platform.OS === "web") {
    const browserConfirm = (
      globalThis as typeof globalThis & {
        confirm?: (message?: string) => boolean;
      }
    ).confirm;
    if (browserConfirm?.(`${title}\n\n${message}`)) void onConfirm();
    return;
  }

  Alert.alert(title, message, [
    { text: cancelText, style: "cancel" },
    {
      text: confirmText,
      style: destructive ? "destructive" : "default",
      onPress: () => void onConfirm(),
    },
  ]);
}
