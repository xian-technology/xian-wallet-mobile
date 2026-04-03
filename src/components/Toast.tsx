import React, { useEffect, useRef } from "react";
import { Animated, Text, StyleSheet } from "react-native";
import { colors } from "../theme/colors";

type Tone = "success" | "danger" | "warning" | "info";

interface ToastProps {
  message: string;
  tone?: Tone;
  onDismiss: () => void;
  duration?: number;
}

const toneColors: Record<Tone, string> = {
  success: colors.successSoft,
  danger: colors.dangerSoft,
  warning: colors.warningSoft,
  info: colors.bg2,
};

const toneBorders: Record<Tone, string> = {
  success: colors.success,
  danger: colors.danger,
  warning: colors.warning,
  info: colors.line,
};

export function Toast({ message, tone = "info", onDismiss, duration = 3000 }: ToastProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(onDismiss);
    }, duration);

    return () => clearTimeout(timer);
  }, [opacity, translateY, onDismiss, duration]);

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor: toneColors[tone],
          borderColor: toneBorders[tone],
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 90,
    left: 16,
    right: 16,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    zIndex: 100,
  },
  text: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.fg,
  },
});
