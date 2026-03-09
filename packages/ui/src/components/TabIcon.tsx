import { Text } from "react-native";

export interface TabIconProps {
  label: string;
  color: string;
}

export function TabIcon({ label, color }: TabIconProps) {
  return <Text style={{ fontSize: 20, color }}>{label}</Text>;
}
