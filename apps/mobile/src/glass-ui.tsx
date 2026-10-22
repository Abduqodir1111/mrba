import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ModalProps,
  type StyleProp,
  type ViewStyle,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from "expo-glass-effect";
import { Ionicons } from "@expo/vector-icons";
import { theme as c } from "./theme";

const nativeDriver = Platform.OS !== "web";
export const glassStyles = StyleSheet.create({
  card: {
    backgroundColor: c.surface,
    borderColor: c.glassBorder,
    borderWidth: 1,
    borderRadius: 26,
    shadowColor: "#31527D",
    shadowOpacity: 0.07,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 7 },
    elevation: 2,
  },
  control: {
    backgroundColor: "rgba(255,255,255,0.76)",
    borderColor: "rgba(255,255,255,0.96)",
    borderWidth: 1,
    shadowColor: "#31527D",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  webBlur:
    Platform.OS === "web"
      ? ({
          backdropFilter: "blur(22px) saturate(155%)",
          WebkitBackdropFilter: "blur(22px) saturate(155%)",
        } as ViewStyle)
      : {},
});

const Preferences = createContext({
  reducedMotion: false,
  reducedTransparency: false,
});
export function GlassPreferencesProvider({
  children,
}: React.PropsWithChildren) {
  const [reducedMotion, setMotion] = useState(false);
  const [reducedTransparency, setTransparency] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setMotion(value);
    });
    const motion = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setMotion,
    );
    const transparency =
      Platform.OS === "ios"
        ? AccessibilityInfo.addEventListener(
            "reduceTransparencyChanged",
            setTransparency,
          )
        : null;
    if (Platform.OS === "ios")
      void AccessibilityInfo.isReduceTransparencyEnabled().then((value) => {
        if (active) setTransparency(value);
      });
    return () => {
      active = false;
      motion.remove();
      transparency?.remove();
    };
  }, []);
  return (
    <Preferences.Provider value={{ reducedMotion, reducedTransparency }}>
      {children}
    </Preferences.Provider>
  );
}
export function useReducedMotion() {
  return useContext(Preferences).reducedMotion;
}

export function AmbientBackground() {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: "hidden" }]}>
      <LinearGradient
        colors={["#E5EDFF", "#F4F7FC", "#E9F3F4"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={["rgba(159,191,255,0.28)", "rgba(213,228,255,0)"]}
        style={{
          position: "absolute",
          top: -100,
          right: -80,
          width: 360,
          height: 420,
          borderRadius: 220,
        }}
      />
    </View>
  );
}

export function GlassSurface({
  children,
  style,
  material = false,
}: React.PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  material?: boolean;
}>) {
  const { reducedTransparency: reduceTransparency } = useContext(Preferences);
  let nativeGlass = false;
  if (material && Platform.OS === "ios" && !reduceTransparency) {
    try {
      nativeGlass = isGlassEffectAPIAvailable() && isLiquidGlassAvailable();
    } catch {
      /* Older development clients retain the opaque material. */
    }
  }
  const radius = StyleSheet.flatten(style)?.borderRadius ?? 26;
  return (
    <View
      style={[
        glassStyles.card,
        material && !reduceTransparency && glassStyles.webBlur,
        style,
        reduceTransparency && { backgroundColor: c.surfaceStrong },
      ]}
    >
      {nativeGlass && (
        <GlassView
          pointerEvents="none"
          glassEffectStyle="regular"
          tintColor="#F5F8FF"
          style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
        />
      )}
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(255,255,255,0.62)", "rgba(255,255,255,0)"]}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 54,
          borderTopLeftRadius: radius,
          borderTopRightRadius: radius,
        }}
      />
      {children}
    </View>
  );
}

export function GlassButton({
  title,
  onPress,
  icon,
  secondary,
  danger,
  disabled,
  busy,
  style,
}: {
  title: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  secondary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const reduced = useReducedMotion();
  const inactive = disabled || busy;
  const [hovered, setHovered] = useState(false);
  const color = danger ? "#B33F4B" : secondary ? c.blue : c.white;
  const press = (value: number) =>
    Animated.spring(scale, {
      toValue: reduced ? 1 : value,
      speed: 36,
      bounciness: 1,
      useNativeDriver: nativeDriver,
    }).start();
  return (
    <Animated.View
      style={[
        {
          transform: [{ scale }],
          opacity: inactive ? 0.46 : 1,
          marginTop: 8,
          marginBottom: 6,
        },
        style,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !!inactive, busy: !!busy }}
        disabled={inactive}
        onPress={onPress}
        onPressIn={() => press(0.975)}
        onPressOut={() => press(1)}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        style={[
          styles.button,
          secondary && styles.secondary,
          danger && styles.danger,
          hovered &&
            !inactive && { borderColor: secondary ? "#A2BAE5" : "#6DA1FF" },
        ]}
      >
        <LinearGradient
          pointerEvents="none"
          colors={
            danger
              ? ["#FFFFFFAA", "#FFF1F5AA"]
              : secondary
                ? ["#FFFFFFCC", "#EDF3FF88"]
                : ["#ffffff24", "#ffffff00"]
          }
          style={[StyleSheet.absoluteFill, { borderRadius: 18 }]}
        />
        {icon && (
          <Ionicons
            name={busy ? "hourglass-outline" : icon}
            size={18}
            color={color}
          />
        )}
        <Text style={[styles.buttonText, { color }]}>
          {busy ? "Сохранение…" : title}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

// The wrapper stays mounted when its key changes, preserving input focus and form state.
export function ScreenTransition({
  children,
  transitionKey,
  style,
}: React.PropsWithChildren<{
  transitionKey: string;
  style?: StyleProp<ViewStyle>;
}>) {
  const progress = useRef(new Animated.Value(1)).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    progress.setValue(reduced ? 1 : 0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: reduced ? 0 : 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: nativeDriver,
    });
    animation.start();
    return () => animation.stop();
  }, [transitionKey, reduced, progress]);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [0.92, 1],
          }),
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [10, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

export function useModalDismiss(open = true) {
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (open) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      setClosing(false);
    }
  }, [open]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const dismiss = (done: () => void) => {
    if (timer.current) return;
    setClosing(true);
    timer.current = setTimeout(done, reduced ? 0 : 230);
  };
  return { closing, dismiss };
}

export function GlassModal({ children, visible = true, ...props }: ModalProps) {
  const progress = useRef(new Animated.Value(0.02)).current;
  const [rendered, setRendered] = useState(visible);
  const { width } = useWindowDimensions();
  const framed = !props.transparent && width > 740;
  const reduced = useReducedMotion();
  useEffect(() => {
    if (visible) setRendered(true);
    const animation = Animated.timing(progress, {
      toValue: visible ? 1 : 0.02,
      duration: reduced ? 0 : visible ? 300 : 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: nativeDriver,
    });
    animation.start(({ finished }) => {
      if (finished && !visible) setRendered(false);
    });
    return () => animation.stop();
  }, [visible, progress, reduced]);
  return (
    <Modal
      {...props}
      visible={rendered}
      transparent
      animationType="none"
      presentationStyle="overFullScreen"
    >
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: "rgba(26,44,73,0.30)", opacity: progress },
        ]}
      />
      <Animated.View
        pointerEvents={visible ? "auto" : "none"}
        style={{
          flex: 1,
          ...(framed
            ? ({
                width: "100%",
                maxWidth: 720,
                alignSelf: "center",
                marginVertical: 18,
                borderRadius: 28,
                overflow: "hidden",
              } as ViewStyle)
            : {}),
          opacity: progress.interpolate({
            inputRange: [0.02, 1],
            outputRange: [0.92, 1],
          }),
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0.02, 1],
                outputRange: [32, 0],
              }),
            },
          ],
        }}
      >
        {children}
      </Animated.View>
    </Modal>
  );
}

export function GlassSegments<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (value: T) => void;
}) {
  const [width, setWidth] = useState(0);
  const position = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  const index = Math.max(
    0,
    options.findIndex((option) => option[0] === value),
  );
  const cell = Math.max(0, (width - 12) / options.length);
  useEffect(() => {
    if (!width) return;
    if (reduced) {
      position.setValue(index * cell);
      return;
    }
    const animation = Animated.spring(position, {
      toValue: index * cell,
      speed: 24,
      bounciness: 1,
      useNativeDriver: nativeDriver,
    });
    animation.start();
    return () => animation.stop();
  }, [cell, index, position, reduced, width]);
  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={styles.segments}
    >
      {!!width && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.segmentSelection,
            { width: cell, transform: [{ translateX: position }] },
          ]}
        />
      )}
      {options.map(([id, label]) => (
        <Pressable
          key={id}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === id }}
          onPress={() => onChange(id)}
          style={styles.segment}
        >
          <Text style={[styles.segmentText, value === id && { color: c.blue }]}>
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  segments: {
    ...glassStyles.control,
    width: "100%",
    maxWidth: 380,
    alignSelf: "center",
    flexDirection: "row",
    padding: 5,
    marginBottom: 18,
    borderRadius: 22,
    backgroundColor: "rgba(206,219,238,0.48)",
  },
  segmentSelection: {
    position: "absolute",
    top: 5,
    bottom: 5,
    left: 5,
    backgroundColor: c.surfaceStrong,
    borderRadius: 16,
    shadowColor: "#32547E",
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  segment: {
    flex: 1,
    minWidth: 0,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
    paddingVertical: 9,
  },
  segmentText: {
    color: c.muted,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  button: {
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: c.blue,
    borderWidth: 1,
    borderColor: "#4B88FF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    shadowColor: "#2361C4",
    shadowOffset: { width: 0, height: 5 },
    shadowRadius: 12,
    shadowOpacity: 0.16,
    elevation: 2,
  },
  secondary: {
    backgroundColor: "rgba(255,255,255,0.72)",
    borderColor: "rgba(255,255,255,0.95)",
    shadowOpacity: 0.04,
  },
  danger: {
    backgroundColor: "#FFF1F3",
    borderColor: "#F5DCE1",
    shadowOpacity: 0,
  },
  buttonText: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
    textAlign: "center",
    flexShrink: 1,
  },
});
