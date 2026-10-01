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
  return <ScrollView {...props} />;
}
