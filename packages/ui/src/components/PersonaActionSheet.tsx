/**
 * PersonaActionSheet.tsx
 * 选择人格后弹出的操作浮层 — 展示人格头像 + 可执行操作列表
 *
 * 交互流程：
 *   1. 从气泡浮层选择一个人格 → 弹出本组件
 *   2. 显示人格头像（大圆 + 首字）、人格名称
 *   3. 下方列出可执行操作（"添加任务""浏览发帖"等）
 *   4. 点击操作 → onSelectAction 回调
 *   5. 点击背景 → 关闭
 *
 * 当前仅 "添加任务" 可用，其余操作标记 disabled
 */
import { useCallback, useEffect, useRef } from "react";
import {
  Animated,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { useTheme } from "../theme/ThemeContext";

// ─── 类型 ──────────────────────────────────────────────────────────

export interface PersonaActionItem {
  key: string;
  label: string;
  icon: string;
  disabled?: boolean;
}

export interface PersonaActionSheetProps {
  visible: boolean;
  persona: { personaId: string; name: string } | null;
  onSelectAction: (personaId: string, actionKey: string) => void;
  onClose: () => void;
}

// ─── 默认操作列表 ─────────────────────────────────────────────────

const DEFAULT_ACTIONS: PersonaActionItem[] = [
  { key: "add_task", label: "添加任务", icon: "📋" },
  { key: "browse_posts", label: "浏览发帖", icon: "📖", disabled: true },
];

// ─── 颜色盘（与 PersonaBubbleOverlay 一致） ──────────────────────

const COLORS = [
  "#FF6B6B", "#4FC3F7", "#81C784", "#FFD54F",
  "#CE93D8", "#FF8A65", "#4DB6AC", "#7986CB",
];

/** 根据 personaId 确定性地选颜色 */
function pickColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length];
}

// ─── 常量 ──────────────────────────────────────────────────────────

const AVATAR_SIZE = 80;
const CARD_RADIUS = 24;
const CARD_MARGIN_H = 24;

// ─── 主组件 ────────────────────────────────────────────────────────

export function PersonaActionSheet({
  visible,
  persona,
  onSelectAction,
  onClose,
}: PersonaActionSheetProps) {
  const { colors, isDark } = useTheme();
  const { height: screenH } = useWindowDimensions();

  // ── 动画值 ──
  const bgOpacity = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(0.85)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;

  // ── 入场/退场动画 ──
  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(bgOpacity, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.spring(cardScale, {
          toValue: 1,
          damping: 18,
          stiffness: 240,
          mass: 0.8,
          useNativeDriver: true,
        }),
        Animated.timing(cardOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      bgOpacity.setValue(0);
      cardScale.setValue(0.85);
      cardOpacity.setValue(0);
    }
  }, [visible, bgOpacity, cardScale, cardOpacity]);

  // ── 关闭动画 ──
  const handleClose = useCallback(() => {
    Animated.parallel([
      Animated.timing(bgOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.timing(cardOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.spring(cardScale, { toValue: 0.85, damping: 20, stiffness: 300, useNativeDriver: true }),
    ]).start(() => onClose());
  }, [bgOpacity, cardOpacity, cardScale, onClose]);

  if (!visible || !persona) return null;

  const avatarColor = pickColor(persona.personaId);
  const cardBg = isDark ? "#1c1c1e" : "#f2f2f7";
  const actionBg = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.04)";
  const disabledOpacity = 0.35;

  return (
    <View style={styles.overlay}>
      {/* 暗色半透明背景 */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: isDark ? "rgba(0,0,0,0.75)" : "rgba(0,0,0,0.45)",
            opacity: bgOpacity,
          },
        ]}
      />

      {/* 点击背景关闭 */}
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        onPress={handleClose}
        activeOpacity={1}
      />

      {/* 浮动卡片 */}
      <Animated.View
        style={[
          styles.card,
          {
            backgroundColor: cardBg,
            opacity: cardOpacity,
            transform: [{ scale: cardScale }],
            maxHeight: screenH * 0.55,
          },
        ]}
      >
        {/* ── 人格头像 ── */}
        <View style={styles.avatarSection}>
          <View
            style={[
              styles.avatar,
              { backgroundColor: avatarColor + (isDark ? "DD" : "BB") },
            ]}
          >
            <Text style={styles.avatarChar}>
              {persona.name.slice(0, 1).toUpperCase()}
            </Text>
          </View>
          <Text style={[styles.personaName, { color: colors.text }]}>
            {persona.name}
          </Text>
        </View>

        {/* ── 操作列表 ── */}
        <View style={styles.actionsSection}>
          <Text style={[styles.actionsTitle, { color: colors.subtitle }]}>
            选择操作
          </Text>

          {DEFAULT_ACTIONS.map((action) => (
            <TouchableOpacity
              key={action.key}
              style={[
                styles.actionBtn,
                { backgroundColor: actionBg },
                action.disabled && { opacity: disabledOpacity },
              ]}
              activeOpacity={action.disabled ? 1 : 0.6}
              onPress={() => {
                if (!action.disabled) {
                  onSelectAction(persona.personaId, action.key);
                }
              }}
            >
              <Text style={styles.actionIcon}>{action.icon}</Text>
              <View style={styles.actionTextWrap}>
                <Text style={[styles.actionLabel, { color: colors.text }]}>
                  {action.label}
                </Text>
                {action.disabled && (
                  <Text style={[styles.actionHint, { color: colors.subtitle }]}>
                    即将上线
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── 关闭按钮 ── */}
        <TouchableOpacity style={styles.closeBtnWrap} onPress={handleClose}>
          <Text style={[styles.closeText, { color: colors.subtitle }]}>取消</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

// ─── 样式 ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9997,
    justifyContent: "center",
    alignItems: "center",
  },
  card: {
    width: "100%",
    marginHorizontal: CARD_MARGIN_H,
    borderRadius: CARD_RADIUS,
    overflow: "hidden",
    paddingBottom: 16,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.35,
        shadowRadius: 24,
      },
      android: { elevation: 24 },
      default: {},
    }),
  },

  // 头像区域
  avatarSection: {
    alignItems: "center",
    paddingTop: 28,
    paddingBottom: 20,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
      },
      android: { elevation: 8 },
    }),
  },
  avatarChar: {
    color: "#fff",
    fontSize: 34,
    fontWeight: "800",
  },
  personaName: {
    fontSize: 20,
    fontWeight: "700",
    marginTop: 12,
  },

  // 操作区域
  actionsSection: {
    paddingHorizontal: 20,
  },
  actionsTitle: {
    fontSize: 13,
    fontWeight: "500",
    marginBottom: 10,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 16,
    marginBottom: 10,
  },
  actionIcon: {
    fontSize: 24,
    marginRight: 14,
  },
  actionTextWrap: {
    flex: 1,
  },
  actionLabel: {
    fontSize: 16,
    fontWeight: "600",
  },
  actionHint: {
    fontSize: 12,
    marginTop: 2,
  },

  // 关闭
  closeBtnWrap: {
    alignItems: "center",
    paddingVertical: 14,
    marginTop: 4,
  },
  closeText: {
    fontSize: 15,
    fontWeight: "600",
  },
});
