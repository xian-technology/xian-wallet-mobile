import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Stop,
  SvgUri,
  SvgXml,
} from "react-native-svg";

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

const ASSET_GRADIENTS: ReadonlyArray<readonly [string, string]> = [
  ["#5B6CFF", "#3730A3"],
  ["#FF6B9D", "#BE185D"],
  ["#FF8A4C", "#C2410C"],
  ["#2DD4BF", "#0F766E"],
  ["#A78BFA", "#6D28D9"],
  ["#FBBF24", "#B45309"],
  ["#FB7185", "#9F1239"],
  ["#60A5FA", "#1D4ED8"],
  ["#F472B6", "#86198F"],
  ["#818CF8", "#3730A3"],
];

function assetGradientPair(key: string): readonly [string, string] {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }
  return (
    ASSET_GRADIENTS[Math.abs(hash) % ASSET_GRADIENTS.length] ??
    ASSET_GRADIENTS[0]!
  );
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
  const isNativeXianLogo = contract === "currency" && Boolean(trimmedIcon);
  const iconSize = isNativeXianLogo ? Math.round(size * 0.7) : size;
  const iconRadius = isNativeXianLogo ? 0 : size / 2;
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
          <SvgXml xml={trimmedIcon} width={iconSize} height={iconSize} />
        </View>
      );
    }
    if (isSvgUri(trimmedIcon)) {
      return (
        <View style={containerStyle}>
          <SvgUri uri={trimmedIcon} width={iconSize} height={iconSize} />
        </View>
      );
    }
    return (
      <View style={containerStyle}>
        <Image
          source={{ uri: trimmedIcon }}
          style={{ width: iconSize, height: iconSize, borderRadius: iconRadius }}
          resizeMode="contain"
        />
      </View>
    );
  }

  const [gradientStart, gradientEnd] = assetGradientPair(contract);
  return (
    <View
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: "transparent",
        },
      ]}
    >
      <Svg
        width={size}
        height={size}
        style={StyleSheet.absoluteFill}
      >
        <Defs>
          <LinearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={gradientStart} />
            <Stop offset="1" stopColor={gradientEnd} />
          </LinearGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill="url(#g)" />
      </Svg>
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
