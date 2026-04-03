import { StyleSheet } from "react-native";
import { colors } from "./colors";

export const typography = StyleSheet.create({
  h1: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.fg,
  },
  h2: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.fg,
  },
  h3: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.fg,
  },
  body: {
    fontSize: 14,
    color: colors.fg,
  },
  bodySmall: {
    fontSize: 13,
    color: colors.fg,
  },
  caption: {
    fontSize: 12,
    color: colors.muted,
  },
  mono: {
    fontSize: 12,
    fontFamily: "monospace",
    color: colors.muted,
  },
});
