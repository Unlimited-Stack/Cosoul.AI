/**
 * SoulChatSheet.tsx
 * 浮动卡片式灵动对话框 — 参考小米"超级小爱"交互风格
 *
 * 设计要点（对标小爱同学）：
 *   - 浮动卡片（非全宽 Sheet），左右有 margin，四角圆角
 *   - 背景模糊暗化，点击背景或 ✕ 关闭
 *   - 键盘弹出时卡片自动上推（KeyboardAvoidingView）
 *   - 固定最大高度，内部聊天区可上下滚动
 *   - AI 回复靠左，用户消息靠右
 *   - 输入框内嵌在卡片底部
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useTheme } from "../theme/ThemeContext";

// ─── 类型 ──────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface SoulChatSheetProps {
  visible: boolean;
  onClose: () => void;
  /** 点击「创建人格」— 传入对话历史，由上层调 persona-agent 处理 */
  onCreatePersona?: (conversationTurns: string[]) => void;
  /** 创建中 loading 状态（上层控制） */
  creating?: boolean;
}

// ─── 常量 ──────────────────────────────────────────────────────────

const SCREEN = Dimensions.get("window");
/** 卡片最大高度 — 屏幕 48% */
const CARD_MAX_HEIGHT = SCREEN.height * 0.48;
/** 左右留白 */
const CARD_MARGIN_H = 14;
/** 卡片底部距屏幕底部的距离（无键盘时） */
const CARD_BOTTOM = 90;
/** 圆角 */
const CARD_RADIUS = 24;

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "你好！我是你的人格创建助手。\n\n告诉我你想创建什么样的分身人格？\n例如：「我想创建一个探店达人的分身，喜欢小众餐厅和独立咖啡馆」",
};

// ─── 主组件 ────────────────────────────────────────────────────────

export function SoulChatSheet({ visible, onClose, onCreatePersona, creating }: SoulChatSheetProps) {
  const { colors, isDark } = useTheme();
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [input, setInput] = useState("");
  const flatListRef = useRef<FlatList>(null);

  // ── 动画 ──
  const cardScale = useRef(new Animated.Value(0)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const bgOpacity = useRef(new Animated.Value(0)).current;

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
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      cardScale.setValue(0);
      cardOpacity.setValue(0);
      bgOpacity.setValue(0);
      setMessages([WELCOME]);
      setInput("");
    }
  }, [visible, cardScale, cardOpacity, bgOpacity]);

  // ── 关闭时先收起键盘再关 ──
  const handleClose = useCallback(() => {
    Keyboard.dismiss();
    // 退场动画
    Animated.parallel([
      Animated.timing(bgOpacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(cardOpacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.spring(cardScale, {
        toValue: 0.85,
        damping: 20,
        stiffness: 300,
        useNativeDriver: true,
      }),
    ]).start(() => onClose());
  }, [bgOpacity, cardOpacity, cardScale, onClose]);

  // ── 用户消息数 ≥1 时才显示创建按钮 ──
  const userMsgCount = messages.filter((m) => m.role === "user").length;

  // ── 点击「创建人格」将对话历史序列化后回调 ──
  const handleCreate = useCallback(() => {
    if (!onCreatePersona) return;
    const turns = messages
      .filter((m) => m.id !== "welcome")
      .map((m) => `${m.role === "user" ? "用户" : "AI"}：${m.content}`);
    onCreatePersona(turns);
  }, [messages, onCreatePersona]);

  // ── 发送消息（占位回复，后续接 LLM） ──
  const handleSend = useCallback(() => {
    if (!input.trim()) return;
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
    };
    const aiReply: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: "assistant",
      content: `收到！我记下了：「${input.trim()}」\n\n（占位回复 — 后续接入 LLM 生成 Soul.md）\n\n还有什么要补充的吗？`,
    };
    setMessages((prev) => [...prev, userMsg, aiReply]);
    setInput("");
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 120);
  }, [input]);

  if (!visible) return null;

  // 动态颜色
  const cardBg = isDark ? "#1c1c1e" : "#f2f2f7";
  const aiBubbleBg = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.04)";
  const userBubbleBg = isDark ? "rgba(255,55,95,0.18)" : "rgba(255,45,85,0.10)";
  const inputBg = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.04)";
  const divider = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";

  return (
    <View style={styles.overlay}>
      {/* 暗色半透明背景 */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: isDark ? "rgba(0,0,0,0.72)" : "rgba(0,0,0,0.42)",
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

      {/* KeyboardAvoidingView 让卡片随键盘上推 */}
      <KeyboardAvoidingView
        style={styles.avoidingView}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 10 : 0}
      >
        {/* 浮动卡片 */}
        <Animated.View
          style={[
            styles.card,
            {
              backgroundColor: cardBg,
              maxHeight: CARD_MAX_HEIGHT,
              opacity: cardOpacity,
              transform: [
                { scale: cardScale },
              ],
            },
          ]}
        >
          {/* ── 顶栏：把手 + ✕ ── */}
          <View style={styles.cardHeader}>
            <View style={[styles.handle, { backgroundColor: colors.subtitle + "40" }]} />
            <View style={styles.headerRow}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>
                创建人格
              </Text>
              <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
                <Text style={[styles.closeBtnText, { color: colors.subtitle }]}>
                  ✕
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* ── 聊天区域（内部滚动） ── */}
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.chatContent}
            style={styles.chatList}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <View
                style={[
                  styles.msgRow,
                  item.role === "user" && styles.msgRowUser,
                ]}
              >
                <View
                  style={[
                    styles.chatBubble,
                    {
                      backgroundColor:
                        item.role === "assistant" ? aiBubbleBg : userBubbleBg,
                      borderTopLeftRadius:
                        item.role === "assistant" ? 6 : 18,
                      borderTopRightRadius:
                        item.role === "user" ? 6 : 18,
                    },
                  ]}
                >
                  <Text style={[styles.msgText, { color: colors.text }]}>
                    {item.content}
                  </Text>
                </View>
              </View>
            )}
          />

          {/* ── 输入栏 ── */}
          <View style={[styles.inputWrap, { borderTopColor: divider }]}>
            <View style={styles.inputRowOuter}>
              {/* 左侧「创建人格」按钮 — 至少有 1 条用户消息时显示 */}
              {userMsgCount >= 1 && onCreatePersona && (
                <TouchableOpacity
                  style={[
                    styles.actionBtn,
                    { backgroundColor: colors.accent },
                    creating && styles.actionBtnDisabled,
                  ]}
                  onPress={handleCreate}
                  disabled={creating}
                  activeOpacity={0.7}
                >
                  <Text style={styles.actionBtnText}>
                    {creating ? "创建中..." : "✦ 创建人格"}
                  </Text>
                </TouchableOpacity>
              )}
              <View style={[styles.inputRow, { backgroundColor: inputBg }]}>
                <TextInput
                  style={[styles.input, { color: colors.text }]}
                  placeholder="描述你的人格..."
                  placeholderTextColor={colors.subtitle + "80"}
                  value={input}
                  onChangeText={setInput}
                  onSubmitEditing={handleSend}
                  returnKeyType="send"
                  multiline
                  blurOnSubmit
                />
                <TouchableOpacity
                  style={[
                    styles.sendBtn,
                    { backgroundColor: colors.accent },
                    !input.trim() && styles.sendBtnDisabled,
                  ]}
                  onPress={handleSend}
                  disabled={!input.trim()}
                >
                  <Text style={styles.sendText}>发送</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── 样式 ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9998,
  },
  avoidingView: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    paddingHorizontal: CARD_MARGIN_H,
    paddingBottom: CARD_BOTTOM,
  },
  card: {
    borderRadius: CARD_RADIUS,
    overflow: "hidden",
    // 阴影
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.35,
        shadowRadius: 24,
      },
      android: { elevation: 24 },
      // web fallback
      default: {},
    }),
  },

  // 顶栏
  cardHeader: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 6,
    paddingHorizontal: 16,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    justifyContent: "space-between",
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(120,120,128,0.16)",
  },
  closeBtnText: {
    fontSize: 14,
    fontWeight: "700",
  },

  // 聊天
  chatList: {
    flexGrow: 0,
    flexShrink: 1,
  },
  chatContent: {
    paddingHorizontal: 14,
    paddingBottom: 6,
    paddingTop: 6,
  },
  msgRow: {
    marginBottom: 10,
    alignItems: "flex-start",
  },
  msgRowUser: {
    alignItems: "flex-end",
  },
  chatBubble: {
    maxWidth: "85%",
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  msgText: {
    fontSize: 15,
    lineHeight: 22,
  },

  // 输入
  inputWrap: {
    borderTopWidth: 0.5,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 12,
  },
  inputRowOuter: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 20,
    alignSelf: "flex-end",
    marginBottom: 2,
  },
  actionBtnDisabled: {
    opacity: 0.5,
  },
  actionBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  inputRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    borderRadius: 20,
    paddingLeft: 14,
    paddingRight: 4,
    paddingVertical: 4,
    gap: 6,
  },
  input: {
    flex: 1,
    fontSize: 15,
    maxHeight: 80,
    paddingVertical: Platform.OS === "ios" ? 8 : 6,
  },
  sendBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 18,
    marginBottom: 2,
  },
  sendBtnDisabled: {
    opacity: 0.35,
  },
  sendText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
});
