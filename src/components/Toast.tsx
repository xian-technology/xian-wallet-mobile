import React, { useEffect, useRef } from "react";
import {
  Animated,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "../theme/colors";
import type { ToastAction, ToastIcon, ToastTone } from "../lib/wallet-context";

interface ToastProps {
  message: string;
  tone?: ToastTone;
  detail?: string;
  action?: ToastAction;
  icon?: ToastIcon;
  onDismiss: () => void;
  duration?: number;
}

const toneColors: Record<ToastTone, string> = {
  success: "rgba(34, 197, 94, 0.85)",
  danger: "rgba(255, 77, 79, 0.85)",
  warning: "rgba(250, 173, 20, 0.85)",
  info: "rgba(28, 36, 18, 0.98)",
};

const toneBorders: Record<ToastTone, string> = {
  success: colors.success,
  danger: colors.danger,
  warning: colors.warning,
  info: "rgba(173, 255, 47, 0.32)",
};

const toneIcons: Record<Exclude<ToastIcon, "none">, keyof typeof Feather.glyphMap> = {
  success: "check-circle",
  danger: "x-circle",
  warning: "alert-triangle",
  info: "zap",
};

export function Toast({
  message,
  tone = "info",
  detail,
  action,
  icon,
  onDismiss,
  duration = action ? 6000 : 3000,
}: ToastProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    opacity.setValue(0);
    translateY.setValue(20);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(onDismiss);
    }, duration);

    return () => clearTimeout(timer);
  }, [
    opacity,
    translateY,
    onDismiss,
    duration,
    message,
    tone,
    detail,
    action?.label,
    action?.url,
    icon,
  ]);

  const resolvedIcon = icon ?? tone;

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
      {resolvedIcon !== "none" && (
        <Feather
          name={toneIcons[resolvedIcon]}
          size={18}
          color="#fff"
          style={styles.icon}
        />
      )}
      <View style={styles.content}>
        <Text style={styles.text}>{message}</Text>
        {detail ? (
          <Text style={styles.detail} numberOfLines={1}>{detail}</Text>
        ) : null}
        {action ? (
          <TouchableOpacity
            accessibilityRole="link"
            style={styles.action}
            onPress={() => void Linking.openURL(action.url)}
          >
            <Text style={styles.actionText}>{action.label}</Text>
            <Feather name="external-link" size={12} color="#fff" />
          </TouchableOpacity>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 90,
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    zIndex: 100,
  },
  icon: {
    marginTop: 1,
  },
  content: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  text: {
    fontSize: 13,
    fontWeight: "600",
    color: "#fff",
  },
  detail: {
    fontSize: 12,
    fontWeight: "500",
    color: "#fff",
    opacity: 0.82,
  },
  action: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  actionText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#fff",
    textDecorationLine: "underline",
  },
});
