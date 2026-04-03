import * as Haptics from "expo-haptics";

export function lightTap() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function mediumTap() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

export function successTap() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

export function errorTap() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
}

export function selectionTap() {
  Haptics.selectionAsync().catch(() => {});
}
