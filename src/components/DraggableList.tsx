import React, { useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  Animated,
  type LayoutChangeEvent,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "../theme/colors";
import { selectionTap } from "../lib/haptics";

interface Item {
  key: string;
  label: string;
  sublabel: string;
  iconLetter: string;
  iconColor: string;
  hidden?: boolean;
}

interface DraggableListProps {
  items: Item[];
  onReorder: (fromIndex: number, toIndex: number) => void;
  onToggleHide: (key: string) => void;
}

export function DraggableList({ items, onReorder, onToggleHide }: DraggableListProps) {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const dragY = useRef(new Animated.Value(0)).current;
  const rowHeights = useRef<number[]>([]);
  const startIndex = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 5,
      onPanResponderGrant: () => {
        dragY.setValue(0);
      },
      onPanResponderMove: (_, g) => {
        dragY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (draggingIndex == null) return;
        const avgH = rowHeights.current.length > 0
          ? rowHeights.current.reduce((a, b) => a + b, 0) / rowHeights.current.length
          : 60;
        const offset = Math.round(g.dy / avgH);
        const target = Math.max(0, Math.min(items.length - 1, startIndex.current + offset));
        if (target !== startIndex.current) {
          selectionTap();
          onReorder(startIndex.current, target);
        }
        setDraggingIndex(null);
        dragY.setValue(0);
      },
      onPanResponderTerminate: () => {
        setDraggingIndex(null);
        dragY.setValue(0);
      },
    })
  ).current;

  const handleRowLayout = (index: number, e: LayoutChangeEvent) => {
    rowHeights.current[index] = e.nativeEvent.layout.height;
  };

  return (
    <View>
      {items.map((item, index) => {
        const isDragging = draggingIndex === index;

        return (
          <Animated.View
            key={item.key}
            style={[
              styles.row,
              item.hidden && styles.rowHidden,
              isDragging && styles.rowDragging,
              isDragging && { transform: [{ translateY: dragY }] },
            ]}
            onLayout={(e) => handleRowLayout(index, e)}
          >
            {/* Drag handle */}
            <View
              style={styles.handle}
              onTouchStart={() => {
                selectionTap();
                startIndex.current = index;
                setDraggingIndex(index);
              }}
              {...panResponder.panHandlers}
            >
              <Feather name="menu" size={18} color={colors.muted} />
            </View>

            {/* Icon */}
            <View style={[styles.icon, { backgroundColor: item.iconColor }]}>
              <Text style={styles.iconLetter}>{item.iconLetter}</Text>
            </View>

            {/* Info */}
            <View style={styles.body}>
              <Text style={styles.label}>{item.label}</Text>
              <Text style={styles.sublabel} numberOfLines={1}>{item.sublabel}</Text>
            </View>

            {/* Hide toggle */}
            <View
              style={styles.hideBtn}
              onTouchEnd={() => onToggleHide(item.key)}
            >
              <Feather
                name={item.hidden ? "eye-off" : "eye"}
                size={16}
                color={item.hidden ? colors.muted : colors.fg}
              />
            </View>
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: colors.bg0,
  },
  rowHidden: { opacity: 0.4 },
  rowDragging: {
    backgroundColor: colors.bg2,
    zIndex: 10,
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  handle: {
    width: 28,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  iconLetter: { fontSize: 14, fontWeight: "700", color: colors.fg },
  body: { flex: 1, minWidth: 0 },
  label: { fontSize: 14, fontWeight: "600", color: colors.fg },
  sublabel: { fontSize: 11, color: colors.muted },
  hideBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.bg2,
    alignItems: "center",
    justifyContent: "center",
  },
});
