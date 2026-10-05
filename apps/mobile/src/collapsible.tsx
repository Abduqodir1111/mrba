import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, View } from "react-native";

export function Collapsible({ open, animate = true, children }: React.PropsWithChildren<{ open: boolean; animate?: boolean }>) {
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;
  const [height, setHeight] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (active) setReduceMotion(value); });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => { active = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: reduceMotion ? 0 : 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [open, progress, reduceMotion]);
  if (!animate) return <>{children}</>;
  return <Animated.View
    pointerEvents={open ? "auto" : "none"}
    accessibilityElementsHidden={!open}
    importantForAccessibility={open ? "auto" : "no-hide-descendants"}
    style={{ height: progress.interpolate({ inputRange: [0, 1], outputRange: [0, height] }), opacity: progress, overflow: "hidden" }}
  >
    <View style={{ position: "absolute", top: 0, left: 0, right: 0 }} onLayout={(event) => setHeight(event.nativeEvent.layout.height)}>
      {children}
    </View>
  </Animated.View>;
}
