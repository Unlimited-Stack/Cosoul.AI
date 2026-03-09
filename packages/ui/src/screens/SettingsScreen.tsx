/**
 * SettingsScreen.tsx — 设置页面
 * 包含外观（深浅色模式切换）等设置项。
 * ThemeSwitcher 从原 ProfileScreen 迁移至此。
 * 每条设置项占一行，列表式布局。
 */
import { useRef, useState, useCallback } from "react";
import {
  Animated,
  LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useTheme, type ThemeMode } from "../theme/ThemeContext";
import { SettingsIcon, ChevronLeftIcon } from "../components/TabIcons";

// 三个主题选项
const MODES: { key: ThemeMode; label: string }[] = [
  { key: "system", label: "系统" },
  { key: "light",  label: "浅色" },
  { key: "dark",   label: "深色" },
];

const SWITCHER_HEIGHT = 36;
const SWITCHER_BORDER_RADIUS = 10;
const PILL_MARGIN = 3;

/** 紧凑型主题切换器——单行内嵌 */
function ThemeSwitcherCompact() {
  const { mode, setMode, colors, isDark } = useTheme();
  const [switcherWidth, setSwitcherWidth] = useState(0);
  const [pillReady, setPillReady] = useState(false);
  const pillWidth = switcherWidth > 0 ? switcherWidth / 3 - PILL_MARGIN * 2 : 0;
  const currentIndex = MODES.findIndex((m) => m.key === mode);
  const pillX = useRef(new Animated.Value(0)).current;

  const handleLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const w = e.nativeEvent.layout.width;
      setSwitcherWidth(w);
      const tw = w / 3;
      pillX.setValue(currentIndex * tw + PILL_MARGIN);
      setPillReady(true);
    },
    [currentIndex, pillX]
  );

  const handlePress = useCallback(
    (index: number, key: ThemeMode) => {
      setMode(key);
      if (switcherWidth > 0) {
        const tw = switcherWidth / 3;
        Animated.spring(pillX, {
          toValue: index * tw + PILL_MARGIN,
          damping: 18,
          stiffness: 180,
          mass: 0.9,
          useNativeDriver: true,
        }).start();
      }
    },
    [setMode, switcherWidth, pillX]
  );

  return (
    <View
      style={[
        styles.switcher,
        { backgroundColor: colors.switcherBg, borderColor: colors.switcherBorder },
      ]}
      onLayout={handleLayout}
    >
      {pillReady && pillWidth > 0 && (
        <Animated.View
          style={[
            styles.switcherPill,
            {
              width: pillWidth,
              backgroundColor: isDark ? "rgba(99,99,102,0.6)" : "#FFFFFF",
              transform: [{ translateX: pillX }],
            },
          ]}
        />
      )}
      {MODES.map((item, index) => {
        const isActive = mode === item.key;
        return (
          <TouchableOpacity
            key={item.key}
            style={styles.switcherTab}
            onPress={() => handlePress(index, item.key)}
            activeOpacity={0.6}
          >
            <Text style={[
              styles.switcherLabel,
              { color: isActive ? colors.text : colors.subtitle, fontWeight: isActive ? "700" : "400" },
            ]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/** 单行设置项 */
function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, { borderBottomColor: colors.switcherBorder }]}>
      <Text style={[styles.rowLabel, { color: colors.text }]}>{label}</Text>
      <View style={styles.rowRight}>{children}</View>
    </View>
  );
}

export interface SettingsScreenProps {
  onGoBack?: () => void;
}

/** 设置页面主体 */
export function SettingsScreen({ onGoBack }: SettingsScreenProps) {
  const { colors } = useTheme();

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.bg }]}
      contentContainerStyle={styles.content}
    >
      {/* 页面标题 */}
      <View style={styles.header}>
        {onGoBack && (
          <TouchableOpacity onPress={onGoBack} style={styles.backBtn} activeOpacity={0.6}>
            <ChevronLeftIcon size={24} color={colors.text} />
          </TouchableOpacity>
        )}
        <SettingsIcon size={28} color={colors.text} />
        <Text style={[styles.title, { color: colors.text }]}>设置</Text>
      </View>

      {/* 外观设置区 */}
      <Text style={[styles.sectionTitle, { color: colors.subtitle }]}>外观</Text>
      <View style={[styles.card, { backgroundColor: colors.switcherBg }]}>
        <SettingRow label="主题模式">
          <ThemeSwitcherCompact />
        </SettingRow>
      </View>

      {/* 预留：更多设置区 */}
      <Text style={[styles.sectionTitle, { color: colors.subtitle }]}>关于</Text>
      <View style={[styles.card, { backgroundColor: colors.switcherBg }]}>
        <SettingRow label="版本">
          <Text style={[styles.rowValue, { color: colors.subtitle }]}>1.0.0 MVP</Text>
        </SettingRow>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, paddingTop: 48 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 28 },
  backBtn: { marginRight: 4, padding: 4 },
  title: { fontSize: 24, fontWeight: "bold" },
  sectionTitle: { fontSize: 13, fontWeight: "500", letterSpacing: 0.3, marginBottom: 8, marginLeft: 4 },
  card: { borderRadius: 12, overflow: "hidden", marginBottom: 24 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 12, minHeight: 48, borderBottomWidth: 0.5 },
  rowLabel: { fontSize: 16 },
  rowRight: { flexShrink: 0 },
  rowValue: { fontSize: 14 },
  // 紧凑主题切换器
  switcher: { flexDirection: "row", height: SWITCHER_HEIGHT, width: 160,
    borderRadius: SWITCHER_BORDER_RADIUS, borderWidth: 0.5, overflow: "hidden",
    position: "relative", alignItems: "center" },
  switcherPill: { position: "absolute", height: SWITCHER_HEIGHT - PILL_MARGIN * 2,
    top: PILL_MARGIN, borderRadius: SWITCHER_BORDER_RADIUS - 2,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  switcherTab: { flex: 1, height: SWITCHER_HEIGHT, alignItems: "center", justifyContent: "center" },
  switcherLabel: { fontSize: 12 },
});
