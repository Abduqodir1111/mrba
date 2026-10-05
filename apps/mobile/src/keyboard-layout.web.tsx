import React from "react";
import {
  ScrollView,
  type ScrollViewProps,
} from "react-native";

export function KeyboardProvider({ children }: React.PropsWithChildren) {
  return <>{children}</>;
}

export function KeyboardAwareScrollView({
  bottomOffset: _bottomOffset,
  ...props
}: ScrollViewProps & { bottomOffset?: number }) {
  // React Native Web treats every scroll as a drag, including the browser's
  // automatic scroll when focusing an input or opening the virtual keyboard.
  // Keep focus during those scrolls; native keyboard handling is unchanged.
  return <ScrollView {...props} keyboardDismissMode="none" />;
}
