import React, { useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  PanResponder,
  type LayoutChangeEvent,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "../theme/colors";

const SWIPE_THRESHOLD = 80;

interface SwipeableRowProps {
  children: React.ReactNode;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  leftLabel?: string;
  rightLabel?: string;
  leftColor?: string;
  rightColor?: string;
  leftIcon?: string;
  rightIcon?: string;
  enabled?: boolean;
}

export function SwipeableRow({
  children,
  onSwipeLeft,
  onSwipeRight,
  leftLabel = "Send",
  rightLabel = "Hide",
  leftColor = colors.accent,
  rightColor = colors.danger,
  leftIcon = "arrow-up",
  rightIcon = "eye-off",
  enabled = true,
}: SwipeableRowProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const rowWidth = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => {
        // Only activate for horizontal swipes
        return enabled && Math.abs(gesture.dx) > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy * 1.5);
      },
      onPanResponderMove: (_, gesture) => {
        // Limit to left (negative) if no onSwipeLeft, right (positive) if no onSwipeRight
        let dx = gesture.dx;
        if (!onSwipeLeft && dx < 0) dx = 0;
        if (!onSwipeRight && dx > 0) dx = 0;
        // Apply resistance past threshold
        const max = rowWidth.current * 0.4;
        if (Math.abs(dx) > max) {
          dx = Math.sign(dx) * (max + (Math.abs(dx) - max) * 0.3);
        }
        translateX.setValue(dx);
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dx > SWIPE_THRESHOLD && onSwipeRight) {
          // Swipe right → animate out then trigger (hide)
          Animated.timing(translateX, {
            toValue: rowWidth.current,
            duration: 200,
            useNativeDriver: true,
          }).start(() => {
            translateX.setValue(0);
            onSwipeRight();
          });
        } else if (gesture.dx < -SWIPE_THRESHOLD && onSwipeLeft) {
          // Swipe left → snap back then navigate (send)
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            tension: 100,
            friction: 10,
          }).start(() => {
            onSwipeLeft();
          });
        } else {
          // Snap back
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            tension: 100,
            friction: 10,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
          tension: 100,
          friction: 10,
        }).start();
      },
    })
  ).current;

  const handleLayout = (e: LayoutChangeEvent) => {
    rowWidth.current = e.nativeEvent.layout.width;
  };

  // Background opacity based on swipe distance
  const leftOpacity = translateX.interpolate({
    inputRange: [-SWIPE_THRESHOLD * 2, -SWIPE_THRESHOLD, 0],
    outputRange: [1, 0.8, 0],
    extrapolate: "clamp",
  });

  const rightOpacity = translateX.interpolate({
    inputRange: [0, SWIPE_THRESHOLD, SWIPE_THRESHOLD * 2],
    outputRange: [0, 0.8, 1],
    extrapolate: "clamp",
  });

  return (
    <View style={styles.container} onLayout={handleLayout}>
      {/* Left background (shown when swiping left → Send) */}
      {onSwipeLeft && (
        <Animated.View style={[styles.bg, styles.bgLeft, { backgroundColor: leftColor, opacity: leftOpacity }]}>
          <Feather name={leftIcon as any} size={18} color="#fff" />
          <Text style={styles.bgText}>{leftLabel}</Text>
        </Animated.View>
      )}

      {/* Right background (shown when swiping right → Hide) */}
      {onSwipeRight && (
        <Animated.View style={[styles.bg, styles.bgRight, { backgroundColor: rightColor, opacity: rightOpacity }]}>
          <Text style={styles.bgText}>{rightLabel}</Text>
          <Feather name={rightIcon as any} size={18} color="#fff" />
        </Animated.View>
      )}

      {/* Foreground row */}
      <Animated.View
        style={{ transform: [{ translateX }] }}
        {...panResponder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
    borderRadius: 12,
  },
  bg: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  bgLeft: {
    justifyContent: "flex-end",
  },
  bgRight: {
    justifyContent: "flex-start",
  },
  bgText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
});
