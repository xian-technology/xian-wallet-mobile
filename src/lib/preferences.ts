import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFS_KEY = "xian_prefs";

export interface Preferences {
  quickActionsPosition: "top" | "bottom";
  hideQuickActionLabels: boolean;
}

const DEFAULTS: Preferences = {
  quickActionsPosition: "top",
  hideQuickActionLabels: false,
};

export async function loadPreferences(): Promise<Preferences> {
  const raw = await AsyncStorage.getItem(PREFS_KEY);
  if (!raw) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function savePreferences(prefs: Preferences): Promise<void> {
  await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}
