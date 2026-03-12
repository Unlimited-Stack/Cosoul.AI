/**
 * TaskChatScreen.tsx
 * 任务对话页 — 选择人格操作后进入的全屏聊天界面
 *
 * 设计要点：
 *   - 顶部：人格头像 + 返回按钮 + 操作标题
 *   - 中间：聊天消息列表（AI 左、用户右）
 *   - 底部：液态玻璃风格输入栏（对标 LiquidTabBar 的毛玻璃效果）
 *   - 输入栏随键盘弹出自适应上移
 *   - 放在 packages/ui 供 Web/Native 复用
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/ThemeContext";

// ─── 类型 ──────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface TaskChatScreenProps {
  personaId: string;
  personaName: string;
  /** 操作类型标识，如 "add_task" */
  actionKey: string;
  /** 返回上一页 */
  onGoBack: () => void;
}

// ─── 颜色盘（与 PersonaBubbleOverlay 一致） ──────────────────────

const COLORS = [
  "#FF6B6B", "#4FC3F7", "#81C784", "#FFD54F",
  "#CE93D8", "#FF8A65", "#4DB6AC", "#7986CB",
];

function pickColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length];
}

// ─── 操作标题映射 ─────────────────────────────────────────────────

const ACTION_TITLES: Record<string, string> = {
  add_task: "添加任务",
  browse_posts: "浏览发帖",
};

// ─── 常量 ──────────────────────────────────────────────────────────

const INPUT_BAR_RADIUS = 28;
const AVATAR_SIZE = 36;
const HEADER_AVATAR_SIZE = 32;

// ─── 主组件 ────────────────────────────────────────────────────────

export function TaskChatScreen({
  personaId,
  personaName,
  actionKey,
  onGoBack,
}: TaskChatScreenProps) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();

  const avatarColor = pickColor(personaId);
  const actionTitle = ACTION_TITLES[actionKey] ?? actionKey;

  // ── 消息状态 ──
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: `你好！我是「${personaName}」。\n\n请告诉我你想${actionTitle === "添加任务" ? "添加什么任务" : "做什么"}？\n描述越详细，我执行得越精准。`,
    },
  ]);
  const [input, setInput] = useState("");
  const flatListRef = useRef<FlatList>(null);

  // ── 入场动画 ──
  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

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
      content: `收到！我已记录：「${input.trim()}」\n\n（占位回复 — 后续接入 LLM 执行${actionTitle}）\n\n还有什么需要补充的吗？`,
    };
    setMessages((prev) => [...prev, userMsg, aiReply]);
    setInput("");
    Keyboard.dismiss();
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 120);
  }, [input, actionTitle]);

  // ── 颜色变量 ──
  const headerBg = isDark ? "rgba(28,28,30,0.92)" : "rgba(242,242,247,0.92)";
  const aiBubbleBg = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.04)";
  const userBubbleBg = isDark ? "rgba(255,55,95,0.18)" : "rgba(255,45,85,0.10)";
  const inputBg = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)";
  const blurTint = isDark ? "systemUltraThinMaterialDark" : "systemUltraThinMaterial";
  const isIOS = Platform.OS === "ios";

  return (
    <Animated.View style={[styles.root, { backgroundColor: colors.bg, opacity: fadeAnim }]}>
      {/* ══ 顶部导航栏 ══ */}
      <View style={[styles.header, { backgroundColor: headerBg, paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={onGoBack} activeOpacity={0.6}>
          <Text style={[styles.backArrow, { color: colors.accent }]}>‹</Text>
        </TouchableOpacity>

        <View
          style={[
            styles.headerAvatar,
            { backgroundColor: avatarColor + (isDark ? "DD" : "BB") },
          ]}
        >
          <Text style={styles.headerAvatarChar}>
            {personaName.slice(0, 1).toUpperCase()}
          </Text>
        </View>

        <View style={styles.headerTextWrap}>
          <Text style={[styles.headerName, { color: colors.text }]} numberOfLines={1}>
            {personaName}
          </Text>
          <Text style={[styles.headerAction, { color: colors.subtitle }]}>
            {actionTitle}
          </Text>
        </View>
      </View>

      {/* ══ 聊天消息区 ══ */}
      <KeyboardAvoidingView
        style={styles.chatArea}
        behavior={isIOS ? "padding" : "height"}
        keyboardVerticalOffset={isIOS ? 0 : 0}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={[
            styles.chatContent,
            { paddingBottom: 100 + insets.bottom },
          ]}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: true })
          }
          renderItem={({ item }) => {
            const isUser = item.role === "user";
            return (
              <View style={[styles.msgRow, isUser && styles.msgRowUser]}>
                {/* AI 消息左侧小头像 */}
                {!isUser && (
                  <View
                    style={[
                      styles.msgAvatar,
                      { backgroundColor: avatarColor + "99" },
                    ]}
                  >
                    <Text style={styles.msgAvatarChar}>
                      {personaName.slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                )}
                <View
                  style={[
                    styles.chatBubble,
                    {
                      backgroundColor: isUser ? userBubbleBg : aiBubbleBg,
                      borderTopLeftRadius: isUser ? 18 : 6,
                      borderTopRightRadius: isUser ? 6 : 18,
                      maxWidth: screenW * 0.72,
                    },
                  ]}
                >
                  <Text style={[styles.msgText, { color: colors.text }]}>
                    {item.content}
                  </Text>
                </View>
              </View>
            );
          }}
        />

        {/* ══ 液态玻璃输入栏 ══ */}
        <View style={[styles.inputBarWrap, { bottom: insets.bottom + 12 }]}>
          {isIOS ? (
            <BlurView intensity={70} tint={blurTint} style={styles.inputBarGlass}>
              {renderInputRow()}
            </BlurView>
          ) : (
            <View style={[styles.inputBarGlass, { backgroundColor: colors.tabBarBg }]}>
              {renderInputRow()}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Animated.View>
  );

  /** 输入行内容（复用于 iOS BlurView / Android 降级） */
  function renderInputRow() {
    return (
      <View style={styles.inputRow}>
        <View style={[styles.inputField, { backgroundColor: inputBg }]}>
          <TextInput
            style={[styles.input, { color: colors.text }]}
            placeholder="输入消息..."
            placeholderTextColor={colors.subtitle + "80"}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={handleSend}
            returnKeyType="send"
            multiline
            blurOnSubmit
          />
        </View>
        <TouchableOpacity
          style={[
            styles.sendBtn,
            { backgroundColor: colors.accent },
            !input.trim() && styles.sendBtnDisabled,
          ]}
          onPress={handleSend}
          disabled={!input.trim()}
          activeOpacity={0.7}
        >
          <Text style={styles.sendText}>↑</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

// ─── 样式 ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },

  // ── 顶部导航 ──
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: "rgba(128,128,128,0.15)",
  },
  backBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  backArrow: {
    fontSize: 28,
    fontWeight: "300",
    marginTop: -2,
  },
  headerAvatar: {
    width: HEADER_AVATAR_SIZE,
    height: HEADER_AVATAR_SIZE,
    borderRadius: HEADER_AVATAR_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  headerAvatarChar: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "800",
  },
  headerTextWrap: {
    flex: 1,
  },
  headerName: {
    fontSize: 16,
    fontWeight: "700",
  },
  headerAction: {
    fontSize: 12,
    marginTop: 1,
  },

  // ── 聊天区 ──
  chatArea: {
    flex: 1,
  },
  chatContent: {
    paddingHorizontal: 14,
    paddingTop: 16,
  },
  msgRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginBottom: 14,
  },
  msgRowUser: {
    flexDirection: "row-reverse",
  },
  msgAvatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
    marginBottom: 2,
  },
  msgAvatarChar: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  chatBubble: {
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  msgText: {
    fontSize: 15,
    lineHeight: 22,
  },

  // ── 液态玻璃输入栏 ──
  inputBarWrap: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 100,
  },
  inputBarGlass: {
    borderRadius: INPUT_BAR_RADIUS,
    overflow: "hidden",
    borderWidth: 0.5,
    borderColor: "rgba(255,255,255,0.5)",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
      },
      android: { elevation: 12 },
      default: {},
    }),
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  inputField: {
    flex: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 8 : 6,
  },
  input: {
    fontSize: 15,
    maxHeight: 80,
    minHeight: 22,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Platform.OS === "ios" ? 0 : 1,
  },
  sendBtnDisabled: {
    opacity: 0.35,
  },
  sendText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
});
