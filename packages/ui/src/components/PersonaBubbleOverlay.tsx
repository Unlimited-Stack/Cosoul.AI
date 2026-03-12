/**
 * PersonaBubbleOverlay.tsx
 * 长按 Agent Tab 弹出的人格气泡浮层
 *
 * 交互：
 *   1. 长按 Agent Tab → 浮层出现，背景模糊
 *   2. 手指按住可拖动到目标气泡，高亮放大反馈
 *   3. 松手触发：人格气泡 → onSelectPersona；"新增"气泡 → onAddNew
 *   4. 松手在空白区域 → 关闭浮层
 *
 * 布局规则：
 *   - 以 Agent Tab 为圆心（屏幕底部中央），弧形向上展开
 *   - "新增"气泡始终在弧顶（正上方）
 *   - 已有人格沿弧线左右对称分布
 *   - 使用 useWindowDimensions 动态获取屏幕尺寸，适配所有设备
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useTheme } from "../theme/ThemeContext";

// ─── 类型 ──────────────────────────────────────────────────────────

export interface BubblePersona {
  personaId: string;
  name: string;
}

export interface PersonaBubbleOverlayProps {
  visible: boolean;
  personas: BubblePersona[];
  onSelectPersona: (personaId: string) => void;
  onAddNew: () => void;
  onClose: () => void;
}

// ─── 常量 ──────────────────────────────────────────────────────────

const MAX_SIZE = 56;
const MIN_SIZE = 36;
/** 弧心距屏幕底部的偏移（Tab 栏高度约 56） */
const ARC_BOTTOM_OFFSET = 56;
/** 弧形半径（圆心到气泡圆心的距离） */
const ARC_RADIUS_BASE = 130;
/** 弧形张角（度），气泡沿此角度范围分布 */
const ARC_SPAN_DEG = 150;

/** 气泡颜色调色盘 */
const COLORS = [
  "#FF6B6B", "#4FC3F7", "#81C784", "#FFD54F",
  "#CE93D8", "#FF8A65", "#4DB6AC", "#7986CB",
];
const NEW_COLOR = "#FF375F";

// ─── 气泡数据 ─────────────────────────────────────────────────────

interface BubbleItem {
  id: string;
  name: string;
  char: string;
  isNew: boolean;
  color: string;
}

/** 构建气泡列表：左侧人格 + 中间新增 + 右侧人格 */
function buildItems(personas: BubblePersona[]): BubbleItem[] {
  const leftCount = Math.ceil(personas.length / 2);
  const left = personas.slice(0, leftCount);
  const right = personas.slice(leftCount);
  const items: BubbleItem[] = [];

  left.forEach((p, i) =>
    items.push({
      id: p.personaId,
      name: p.name,
      char: p.name.slice(0, 1).toUpperCase(),
      isNew: false,
      color: COLORS[i % COLORS.length],
    }),
  );

  items.push({ id: "__new__", name: "新增", char: "+", isNew: true, color: NEW_COLOR });

  right.forEach((p, i) =>
    items.push({
      id: p.personaId,
      name: p.name,
      char: p.name.slice(0, 1).toUpperCase(),
      isNew: false,
      color: COLORS[(leftCount + i) % COLORS.length],
    }),
  );

  return items;
}

// ─── 弧形布局计算 ─────────────────────────────────────────────────

interface LayoutResult {
  size: number;
  arcCenterX: number;
  arcCenterY: number;
  positions: Array<{ cx: number; cy: number }>;
}

/**
 * 以 Agent Tab 为圆心的弧形布局（接收动态屏幕尺寸）
 * - 弧心锚定在屏幕底部中央（Tab 栏上方）
 * - 气泡沿上方弧线分布，"新增"在弧顶（90°正上方）
 * - ≤5 个保持 MAX_SIZE，>5 个等比缩小
 */
function computeArcLayout(
  total: number,
  screenWidth: number,
  screenHeight: number,
): LayoutResult {
  const arcCenterX = screenWidth / 2;
  const arcCenterY = screenHeight - ARC_BOTTOM_OFFSET;

  if (total === 0) return { size: MAX_SIZE, arcCenterX, arcCenterY, positions: [] };

  const size = total <= 5 ? MAX_SIZE : Math.max(MIN_SIZE, Math.round(MAX_SIZE * 5 / total));
  const radius = total <= 5 ? ARC_RADIUS_BASE : ARC_RADIUS_BASE + (total - 5) * 6;

  if (total === 1) {
    return {
      size,
      arcCenterX,
      arcCenterY,
      positions: [{ cx: arcCenterX, cy: arcCenterY - radius }],
    };
  }

  const halfSpan = ARC_SPAN_DEG / 2;
  const positions: Array<{ cx: number; cy: number }> = [];

  for (let i = 0; i < total; i++) {
    const t = i / (total - 1);
    const angleDeg = 90 + halfSpan - t * ARC_SPAN_DEG;
    const angleRad = (angleDeg * Math.PI) / 180;

    positions.push({
      cx: arcCenterX + radius * Math.cos(angleRad),
      cy: arcCenterY - radius * Math.sin(angleRad),
    });
  }

  return { size, arcCenterX, arcCenterY, positions };
}

// ─── 主组件 ────────────────────────────────────────────────────────

export function PersonaBubbleOverlay({
  visible,
  personas,
  onSelectPersona,
  onAddNew,
  onClose,
}: PersonaBubbleOverlayProps) {
  const { isDark } = useTheme();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState(-1);

  const items = useMemo(() => buildItems(personas), [personas]);
  const layout = useMemo(
    () => computeArcLayout(items.length, screenW, screenH),
    [items.length, screenW, screenH],
  );
  const centerIdx = Math.ceil(personas.length / 2);

  // ── Ref 防闭包过期 ──
  const layoutRef = useRef(layout);
  const itemsRef = useRef(items);
  const activeRef = useRef(-1);
  const cbRef = useRef({ onSelectPersona, onAddNew, onClose });
  layoutRef.current = layout;
  itemsRef.current = items;
  cbRef.current = { onSelectPersona, onAddNew, onClose };

  // ── 动画值 ──
  const bgOpacity = useRef(new Animated.Value(0)).current;
  const scaleAnims = useRef<Animated.Value[]>([]);
  if (scaleAnims.current.length !== items.length) {
    scaleAnims.current = items.map(() => new Animated.Value(0));
  }

  // ── 入场/退场 ──
  useEffect(() => {
    if (visible) {
      Animated.timing(bgOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
      scaleAnims.current.forEach((anim, i) => {
        anim.setValue(0);
        const delay = Math.abs(i - centerIdx) * 65;
        setTimeout(() => {
          Animated.spring(anim, {
            toValue: 1,
            damping: 13,
            stiffness: 200,
            mass: 0.7,
            useNativeDriver: true,
          }).start();
        }, delay);
      });
    } else {
      bgOpacity.setValue(0);
      scaleAnims.current.forEach((a) => a.setValue(0));
      setActiveIndex(-1);
      activeRef.current = -1;
    }
  }, [visible, bgOpacity, centerIdx, items.length]);

  // ── 命中检测（含 16px 容差） ──
  const hitTest = useCallback((pageX: number, pageY: number) => {
    const { positions, size } = layoutRef.current;
    const hitRadius = size / 2 + 16;
    for (let i = 0; i < positions.length; i++) {
      const dx = pageX - positions[i].cx;
      const dy = pageY - positions[i].cy;
      if (dx * dx + dy * dy < hitRadius * hitRadius) return i;
    }
    return -1;
  }, []);

  // ── PanResponder：拖选 + 捕获阶段拦截 ──
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,

        onPanResponderGrant: (evt) => {
          const idx = hitTest(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
          activeRef.current = idx;
          setActiveIndex(idx);
        },

        onPanResponderMove: (evt) => {
          const idx = hitTest(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
          if (idx !== activeRef.current) {
            activeRef.current = idx;
            setActiveIndex(idx);
          }
        },

        onPanResponderRelease: () => {
          const idx = activeRef.current;
          const { onSelectPersona: sel, onAddNew: add, onClose: close } =
            cbRef.current;
          if (idx >= 0 && idx < itemsRef.current.length) {
            const item = itemsRef.current[idx];
            if (item.isNew) add();
            else sel(item.id);
          }
          close();
          activeRef.current = -1;
          setActiveIndex(-1);
        },
      }),
    [hitTest],
  );

  if (!visible) return null;

  return (
    <View style={styles.overlay} {...panResponder.panHandlers}>
      {/* 暗色半透明背景 */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: isDark
              ? "rgba(0,0,0,0.78)"
              : "rgba(0,0,0,0.52)",
            opacity: bgOpacity,
          },
        ]}
      />

      {/* 提示文字 — 在弧形上方 */}
      <Animated.View
        style={[
          styles.hintWrap,
          {
            top: layout.arcCenterY - ARC_RADIUS_BASE - layout.size / 2 - 44,
            opacity: bgOpacity,
          },
        ]}
      >
        <Text style={styles.hintText}>选择人格 · 长按拖动</Text>
      </Animated.View>

      {/* 气泡圈 — 弧形分布 */}
      {items.map((item, i) => {
        const { cx, cy } = layout.positions[i] ?? { cx: 0, cy: 0 };
        const isActive = activeIndex === i;
        const anim = scaleAnims.current[i];

        return (
          <Animated.View
            key={item.id}
            style={[
              styles.bubbleWrap,
              {
                left: cx - layout.size / 2,
                top: cy - layout.size / 2,
                width: layout.size,
                transform: [{ scale: anim }],
              },
            ]}
            pointerEvents="none"
          >
            {isActive && (
              <View
                style={[
                  styles.highlightRing,
                  {
                    width: layout.size + 10,
                    height: layout.size + 10,
                    borderRadius: (layout.size + 10) / 2,
                    left: -5,
                    top: -5,
                  },
                ]}
              />
            )}

            <View
              style={[
                styles.bubble,
                {
                  width: layout.size,
                  height: layout.size,
                  borderRadius: layout.size / 2,
                  backgroundColor: item.isNew
                    ? NEW_COLOR
                    : item.color + (isDark ? "DD" : "BB"),
                  transform: [{ scale: isActive ? 1.25 : 1 }],
                },
              ]}
            >
              <Text
                style={[
                  styles.bubbleChar,
                  { fontSize: item.isNew ? 26 : layout.size * 0.38 },
                ]}
              >
                {item.char}
              </Text>
            </View>

            <Text
              style={[
                styles.bubbleName,
                isActive && styles.bubbleNameActive,
                { maxWidth: layout.size + 20 },
              ]}
              numberOfLines={1}
            >
              {item.isNew ? "新增" : item.name.slice(0, 2)}
            </Text>
          </Animated.View>
        );
      })}
    </View>
  );
}

// ─── 样式 ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
  },
  hintWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  hintText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    fontWeight: "500",
    letterSpacing: 0.5,
  },
  bubbleWrap: {
    position: "absolute",
    alignItems: "center",
  },
  highlightRing: {
    position: "absolute",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.5)",
  },
  bubble: {
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.35,
        shadowRadius: 12,
      },
      android: { elevation: 12 },
    }),
  },
  bubbleChar: {
    color: "#fff",
    fontWeight: "800",
  },
  bubbleName: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 11,
    fontWeight: "500",
    marginTop: 7,
    textAlign: "center",
  },
  bubbleNameActive: {
    color: "#fff",
    fontWeight: "700",
  },
});
