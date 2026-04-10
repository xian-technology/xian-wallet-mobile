import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { SvgUri, SvgXml } from "react-native-svg";

import { colors } from "../theme/colors";

function isInlineSvg(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("<svg") || trimmed.startsWith("<?xml");
}

function isSvgUri(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith("data:image/svg+xml")) {
    return true;
  }
  return /^https?:\/\//.test(trimmed) && /\.svg(?:[?#].*)?$/.test(trimmed);
}

export function TokenAvatar({
  contract,
  symbol,
  icon,
  size = 36,
  textSize = 14,
  backgroundColor = colors.bg2,
}: {
  contract: string;
  symbol: string;
  icon?: string;
  size?: number;
  textSize?: number;
  backgroundColor?: string;
}) {
  const trimmedIcon = icon?.trim();
  const letter = (symbol || contract.slice(0, 6)).charAt(0).toUpperCase();
  const containerStyle = [
    styles.container,
    {
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor,
    },
  ];

  if (trimmedIcon) {
    if (isInlineSvg(trimmedIcon)) {
      return (
        <View style={containerStyle}>
          <SvgXml xml={trimmedIcon} width={size} height={size} />
        </View>
      );
    }
    if (isSvgUri(trimmedIcon)) {
      return (
        <View style={containerStyle}>
          <SvgUri uri={trimmedIcon} width={size} height={size} />
        </View>
      );
    }
    return (
      <View style={containerStyle}>
        <Image
          source={{ uri: trimmedIcon }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          resizeMode="contain"
        />
      </View>
    );
  }

  return (
    <View style={containerStyle}>
      <Text style={[styles.letter, { fontSize: textSize }]}>{letter}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  letter: {
    color: colors.fg,
    fontWeight: "700",
  },
});
