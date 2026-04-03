import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import * as Clipboard from "expo-clipboard";
import QRCode from "react-native-qrcode-svg";
import { colors } from "../theme/colors";
import { useWallet } from "../lib/wallet-context";

export function ReceiveScreen() {
  const { state, showToast } = useWallet();
  const [copied, setCopied] = useState(false);
  const address = state.publicKey ?? "";

  const handleCopy = async () => {
    await Clipboard.setStringAsync(address);
    setCopied(true);
    showToast("Address copied.", "success");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Receive</Text>
      <Text style={styles.sub}>Share your address to receive tokens.</Text>

      <View style={styles.qrContainer}>
        <QRCode
          value={address || "empty"}
          size={200}
          backgroundColor={colors.fg}
          color={colors.bg0}
        />
      </View>

      <View style={styles.addressBox}>
        <Text style={styles.address} selectable>
          {address}
        </Text>
      </View>

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
    width: "100%",
  },
  address: {
    fontFamily: "monospace",
    fontSize: 13,
    color: colors.fg,
    textAlign: "center",
    lineHeight: 22,
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
