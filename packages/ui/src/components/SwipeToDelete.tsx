/**
 * SwipeToDelete.tsx
 * 轻量左滑删除组件 — 左滑时删除按钮紧贴内容右侧随之滑入
 *
 * 布局：行内排列（内容 + 删除按钮），容器 overflow:hidden 裁切
 * 滑动时整行左移，删除按钮从右侧边缘缓缓出现
 */
import { useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type LayoutChangeEvent,
  type ViewStyle,
} from "react-native";

export interface SwipeToDeleteProps {
  children: React.ReactNode;
  onDelete: () => void;
  /** 是否禁用滑动（如正在删除中） */
  disabled?: boolean;
  style?: ViewStyle;
}

/** 删除按钮宽度 */
const DELETE_BTN_WIDTH = 72;
/** 触发阈值 */
const SWIPE_THRESHOLD = 40;

export function SwipeToDelete({ children, onDelete, disabled, style }: SwipeToDeleteProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const [containerWidth, setContainerWidth] = useState(0);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // 只响应明确的水平左滑（避免与垂直滚动冲突）
        return !disabled && Math.abs(gestureState.dx) > 8 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy * 1.5);
      },
      onPanResponderMove: (_, gestureState) => {
        // 只允许左滑（dx < 0），限制最大位移
        if (gestureState.dx < 0) {
          const clampedX = Math.max(gestureState.dx, -DELETE_BTN_WIDTH - 10);
          translateX.setValue(clampedX);
        } else if (gestureState.dx > 0) {
          // 允许右滑回弹
          const clampedX = Math.min(gestureState.dx, 0);
          translateX.setValue(clampedX);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx < -SWIPE_THRESHOLD) {
          // 滑够了 → 吸附到展开位置
          Animated.spring(translateX, {
            toValue: -DELETE_BTN_WIDTH,
            damping: 20,
            stiffness: 200,
            useNativeDriver: true,
          }).start();
        } else {
          // 不够 → 弹回
          Animated.spring(translateX, {
            toValue: 0,
            damping: 20,
            stiffness: 200,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  // 点击删除后先收回再回调
  const handleDelete = () => {
    Animated.timing(translateX, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => onDelete());
  };

  const handleLayout = (e: LayoutChangeEvent) => {
    setContainerWidth(e.nativeEvent.layout.width);
  };

  return (
    <View style={[styles.container, style]} onLayout={handleLayout}>
      {/* 行内排列：内容 + 删除按钮，整体可左滑 */}
      <Animated.View
        style={[styles.row, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        {/* 内容区域 — 宽度等于容器宽度，保证初始状态完全遮住删除按钮 */}
        <View style={{ width: containerWidth || "100%" }}>
          {children}
        </View>
        {/* 删除按钮 — 紧贴内容右侧 */}
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={handleDelete}
          activeOpacity={0.7}
        >
          <Text style={styles.deleteIcon}>🗑</Text>
          <Text style={styles.deleteText}>删除</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  deleteBtn: {
    width: DELETE_BTN_WIDTH,
    backgroundColor: "#FF3B30",
    justifyContent: "center",
    alignItems: "center",
  },
  deleteIcon: {
    fontSize: 20,
    marginBottom: 2,
  },
  deleteText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
});
