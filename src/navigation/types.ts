import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { CompositeScreenProps } from "@react-navigation/native";

export type HomeTabParamList = {
  Home: undefined;
  Activity: undefined;
  Apps: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Setup: undefined;
  Lock: undefined;
  Main: undefined;
  Send: { token?: string } | undefined;
  Receive: undefined;
  TokenDetail: { contract: string };
  Networks: undefined;
  AdvancedTx: undefined;
};

export type RootStackScreenProps<K extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, K>;

export type HomeTabScreenProps<K extends keyof HomeTabParamList> =
  CompositeScreenProps<
    BottomTabScreenProps<HomeTabParamList, K>,
    NativeStackScreenProps<RootStackParamList>
  >;

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
