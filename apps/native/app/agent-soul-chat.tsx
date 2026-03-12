/**
 * agent-soul-chat.tsx
 * 对话式人格创建页（从气泡浮层选择"新增"后跳转）
 *
 * 通过 AI 对话交互完善 Soul.md（核心身份 / 偏好 / 价值观）。
 * 当前为占位验证页面，后续接入 LLM 对话流。
 */
import { useCallback, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "@repo/ui";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "你好！我是你的人格创建助手。\n\n告诉我你想创建什么样的分身人格？\n例如：「我想创建一个探店达人的分身，喜欢小众餐厅和独立咖啡馆」",
};

export default function AgentSoulChatPage() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [input, setInput] = useState("");

  const cardBg = isDark ? "rgba(120,120,128,0.16)" : "rgba(142,142,147,0.08)";
  const userBubble = isDark ? "rgba(255,55,95,0.2)" : "rgba(255,45,85,0.12)";

  // 占位回复（后续接 LLM）
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
  }, [input]);

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
    >
      {/* 顶部栏 */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={[styles.backText, { color: colors.accent }]}>返回</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>创建人格</Text>
        <TouchableOpacity style={styles.doneBtn}>
          <Text style={[styles.doneText, { color: colors.accent }]}>完成</Text>
        </TouchableOpacity>
      </View>

      {/* 对话列表 */}
      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.chatContent}
        renderItem={({ item }) => (
          <View
            style={[
              styles.msgRow,
              item.role === "user" && styles.msgRowUser,
            ]}
          >
            <View
              style={[
                styles.bubble,
                {
                  backgroundColor:
                    item.role === "assistant" ? cardBg : userBubble,
                  alignSelf:
                    item.role === "user" ? "flex-end" : "flex-start",
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

      {/* 输入栏 */}
      <View style={[styles.inputBar, { backgroundColor: cardBg }]}>
        <TextInput
          style={[styles.input, { color: colors.text }]}
          placeholder="描述你的人格..."
          placeholderTextColor={colors.subtitle}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={handleSend}
          returnKeyType="send"
          multiline
        />
        <TouchableOpacity
          style={[
            styles.sendBtn,
            { backgroundColor: colors.accent },
            !input.trim() && { opacity: 0.4 },
          ]}
          onPress={handleSend}
          disabled={!input.trim()}
        >
          <Text style={styles.sendText}>发送</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  backBtn: { marginRight: 12 },
  backText: { fontSize: 16, fontWeight: "600" },
  title: { flex: 1, fontSize: 20, fontWeight: "bold" },
  doneBtn: { marginLeft: 12 },
  doneText: { fontSize: 16, fontWeight: "600" },
  chatContent: { paddingHorizontal: 16, paddingBottom: 8 },
  msgRow: { marginBottom: 12 },
  msgRowUser: { alignItems: "flex-end" },
  bubble: {
    maxWidth: "80%",
    borderRadius: 16,
    padding: 14,
  },
  msgText: { fontSize: 15, lineHeight: 22 },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingVertical: 8,
    paddingBottom: 32,
    gap: 8,
  },
  input: { flex: 1, fontSize: 16, maxHeight: 100, paddingVertical: 8 },
  sendBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
  },
  sendText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
