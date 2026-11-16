import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { unusedChiCost, unusedChiWarning } from "../lib/unused-chi";
import { colors } from "../theme/colors";
import { Button } from "./Button";

/**
 * In-app banner for a chi limit above what the call needs: half of the unused
 * chi is charged (execution revision 14). Renders nothing without a
 * simulation or when the limit costs at most the SDK margin's 1 chi. With
 * `onUseEstimate` (the user chose the limit) it offers the simulated estimate.
 */
export function UnusedChiBanner({
  supplied,
  estimate,
  chiRate,
  onUseEstimate,
}: {
  supplied: number;
  estimate: { estimated: number; supply: number } | null;
  chiRate: number | null;
  onUseEstimate?: () => void;
}) {
  const cost = estimate ? unusedChiCost({ supplied, estimated: estimate.estimated }) : null;
  const warning = cost ? unusedChiWarning(cost, chiRate) : null;
  if (!estimate || !cost || !warning) {
    return null;
  }
  const high = cost.severity === "high";
  return (
    <View testID="unused-chi-banner" style={[styles.banner, high ? styles.danger : styles.caution]}>
      <View style={styles.row}>
        <Feather name="alert-triangle" size={14} color={high ? colors.danger : colors.warning} />
        <Text accessibilityRole="alert" style={styles.text}>
          {warning}
        </Text>
      </View>
      {onUseEstimate ? (
        <Button
          title={`Use estimate (${estimate.supply.toLocaleString()} chi)`}
          variant="secondary"
          onPress={onUseEstimate}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { padding: 12, borderRadius: 12, borderWidth: 1, gap: 10 },
  caution: { backgroundColor: colors.warningSoft, borderColor: colors.warning },
  danger: { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
  row: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  text: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.fg },
});
