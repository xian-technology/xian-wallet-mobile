import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import QRCode from "react-native-qrcode-svg";
import { colors } from "../theme/colors";
import { useWallet } from "../lib/wallet-context";

export function ReceiveScreen() {
  const { state, showToast } = useWallet();
  const [copied, setCopied] = useState(false);
  const address = state.publicKey ?? "";

  const handleCopy = async () => {
    if (!address) return;
    await Clipboard.setStringAsync(address);
    setCopied(true);
    showToast("Address copied.", "success");
    setTimeout(() => setCopied(false), 2000);
  };

  if (!address) {
    return (
      <View style={[styles.container, styles.emptyState]}>
        <Feather name="lock" size={32} color={colors.muted} />
        <Text style={styles.heading}>No address available</Text>
        <Text style={styles.sub}>Unlock your wallet to view your receive address.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Receive</Text>
      <Text style={styles.sub}>Share your address to receive tokens.</Text>

      <View style={styles.qrContainer}>
        <QRCode
          value={address}
          size={200}
          backgroundColor={colors.fg}
          color={colors.bg0}
        />
      </View>

      <TouchableOpacity style={styles.addressBox} onPress={handleCopy} activeOpacity={0.7}>
        {[0, 1, 2, 3].map((row) => (
          <View key={row} style={styles.addressRow}>
            {[0, 1, 2, 3].map((col) => {
              const i = row * 4 + col;
              const chunk = address.slice(i * 4, i * 4 + 4);
              return (
                <Text
                  key={col}
                  style={[styles.addressChunk, i % 2 === 0 ? styles.chunkBright : styles.chunkDim]}
                >
                  {chunk}
                </Text>
              );
            })}
          </View>
        ))}
      </TouchableOpacity>

      <TouchableOpacity style={styles.copyBtn} onPress={handleCopy}>
        <Text style={styles.copyText}>
          {copied ? "Copied!" : "Copy Address"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg0,
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
  },
  emptyState: {
    gap: 12,
  },
  heading: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.fg,
  },
  sub: {
    fontSize: 14,
    color: colors.muted,
  },
  qrContainer: {
    padding: 16,
    backgroundColor: colors.fg,
    borderRadius: 16,
  },
  addressBox: {
    backgroundColor: colors.bg2,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    gap: 6,
  },
  addressRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
  },
  addressChunk: {
    fontFamily: "monospace",
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: 1,
  },
  chunkBright: {
    color: colors.fg,
  },
  chunkDim: {
    color: colors.muted,
  },
  copyBtn: {
    backgroundColor: colors.accentSoft,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 999,
  },
  copyText: {
    color: colors.accent,
    fontWeight: "600",
    fontSize: 14,
  },
});
