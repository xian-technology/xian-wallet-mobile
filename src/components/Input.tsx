import React from "react";
import { TextInput, View, Text, StyleSheet, type TextInputProps } from "react-native";
import { colors } from "../theme/colors";

interface InputProps extends TextInputProps {
  label?: string;
}

export function Input({ label, style, ...props }: InputProps) {
  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        style={[styles.input, style]}
        placeholderTextColor={colors.muted}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.muted,
  },
  input: {
    backgroundColor: colors.bg2,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: colors.fg,
    borderWidth: 1,
    borderColor: colors.line,
  },
});
