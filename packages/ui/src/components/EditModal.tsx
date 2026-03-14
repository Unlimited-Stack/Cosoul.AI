/**
 * EditModal.tsx — 通用编辑弹层组件
 *
 * 交互规范：
 *   Web: 屏幕正中居中卡片 + 半透明遮罩
 *   Native: 高斯模糊背景卡片，position="bottom" 底部上滑，position="center" 居中
 * 标题栏格式：取消 — 标题（居中） — 保存
 */
import React from "react";
import {
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { BlurView } from "expo-blur";
import { useTheme } from "../theme/ThemeContext";

export interface EditModalProps {
  visible: boolean;
  title: string;
  onCancel: () => void;
  onSave?: () => void;
  saveDisabled?: boolean;
  saveLabel?: string;
  /** "center" = 居中弹窗, "bottom" = 底部弹出（仅 Native 生效，Web 始终居中） */
  position?: "center" | "bottom";
  children: React.ReactNode;
}

export function EditModal({
  visible,
  title,
  onCancel,
  onSave,
  saveDisabled = false,
  saveLabel = "保存",
  position = "center",
  children,
}: EditModalProps) {
  const { colors, isDark } = useTheme();

  // Web 始终居中，Native 根据 position 参数决定
  const isBottom = Platform.OS !== "web" && position === "bottom";
  const isNative = Platform.OS !== "web";

  // Native 用不透明实色背景防止文字穿透，Web 保持原有半透明风格
  const cardBg = isNative
    ? isDark ? "#2C2C2E" : "#F2F2F7"
    : colors.switcherBg;

  const titleBarContent = (
    <View style={[styles.titleBar, { borderBottomColor: colors.switcherBorder }]}>
      <TouchableOpacity onPress={onCancel} style={styles.titleAction}>
        <Text style={{ fontSize: 16, color: colors.subtitle }}>取消</Text>
      </TouchableOpacity>

      <Text
        style={{ fontSize: 17, fontWeight: "600", color: colors.text, flex: 1, textAlign: "center" }}
        numberOfLines={1}
      >
        {title}
      </Text>

      {onSave ? (
        <TouchableOpacity onPress={onSave} disabled={saveDisabled} style={styles.titleAction}>
          <Text
            style={{
              fontSize: 16,
              fontWeight: "600",
              color: saveDisabled ? colors.switcherBorder : colors.accent,
            }}
          >
            {saveLabel}
          </Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.titleAction} />
      )}
    </View>
  );

  // Native 端使用 BlurView 实现高斯模糊背景
  const cardContent = isNative ? (
    <BlurView
      intensity={80}
      tint={isDark ? "dark" : "light"}
      style={[
        isBottom ? styles.bottomCard : styles.centerCard,
        // BlurView 上叠加半透明底色，增强遮挡效果
        { backgroundColor: isDark ? "rgba(44,44,46,0.85)" : "rgba(242,242,247,0.85)" },
      ]}
    >
      {titleBarContent}
      {children}
    </BlurView>
  ) : (
    <View
      style={[
        isBottom ? styles.bottomCard : styles.centerCard,
        { backgroundColor: cardBg },
      ]}
    >
      {titleBarContent}
      {children}
    </View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType={isBottom ? "slide" : "fade"}
      onRequestClose={onCancel}
    >
      <KeyboardAvoidingView
        style={[styles.overlay, isBottom && styles.overlayBottom]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* 遮罩：点击关闭 */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />

        {cardContent}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const { width: SW } = Dimensions.get("window");

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  overlayBottom: { justifyContent: "flex-end", alignItems: "stretch" },
  centerCard: {
    width: Platform.OS === "web" ? 400 : SW * 0.85,
    maxWidth: 440,
    borderRadius: 14,
    overflow: "hidden",
  },
  bottomCard: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingBottom: 34,
    overflow: "hidden",
  },
  titleBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleAction: {
    minWidth: 48,
    alignItems: "center",
    paddingHorizontal: 4,
  },
});
