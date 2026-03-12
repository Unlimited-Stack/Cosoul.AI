/**
 * TaskChatScreen.tsx
 * 任务对话页 — 选择人格操作后进入的全屏聊天界面
 *
 * 策略 A 实现：
 *   1. 用户发消息 → 调 taskService.extract() → LLM 提取结构化字段
 *   2. complete=false → followUpQuestion 做 AI 回复，继续对话
 *   3. complete=true  → 展示确认摘要，启用「创建任务」按钮
 *   4. 用户确认 → 调 taskService.createFromIntake() → TaskAgent 创建 + FSM 启动
 *
 * UI 要点：
 *   - 顶部：人格头像 + 返回按钮 + 操作标题
 *   - 中间：聊天消息列表（AI 左、用户右）
 *   - 底部：液态玻璃风格输入栏 + 创建任务按钮
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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
  /** 标记为提取完成的确认摘要消息 */
  isSummary?: boolean;
}

/** 提取结果（与 @repo/core/task ExtractionResult 对齐） */
interface ExtractionResult {
  fields: {
    interaction_type: string;
    rawDescription: string;
    targetActivity: string;
    targetVibe: string;
    detailedPlan: string;
  };
  complete: boolean;
  missingFields: string[];
  followUpQuestion: string | null;
}

/** TaskService 接口 — 由 App 层注入 */
export interface TaskServiceLike {
  extract(params: {
    personaId: string;
    userMessage: string;
    conversationHistory: string[];
  }): Promise<ExtractionResult>;

  createFromIntake(params: {
    personaId: string;
    conversationTurns: string[];
  }): Promise<{ taskId: string; status: string }>;
}

export interface TaskChatScreenProps {
  personaId: string;
  personaName: string;
  /** 操作类型标识，如 "add_task" */
  actionKey: string;
  /** 返回上一页 */
  onGoBack: () => void;
  /** TaskService — 注入后启用真实 LLM 提取流程 */
  taskService?: TaskServiceLike;
  /** 兼容旧模式：无 taskService 时的回退回调 */
  onCreateTask?: (personaId: string, conversationTurns: string[]) => void;
  /** 兼容旧模式：创建中 loading 状态 */
  creating?: boolean;
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

// ─── 辅助：格式化确认摘要 ────────────────────────────────────────

function formatSummary(fields: ExtractionResult["fields"]): string {
  const lines = ["任务信息提取完成，请确认：\n"];
  if (fields.rawDescription) lines.push(`📋 核心需求：${fields.rawDescription}`);
  if (fields.targetActivity) lines.push(`🎯 目标活动：${fields.targetActivity}`);
  if (fields.targetVibe) lines.push(`✨ 期望氛围：${fields.targetVibe}`);
  if (fields.interaction_type) {
    const typeMap: Record<string, string> = { online: "线上", offline: "线下", any: "都行" };
    lines.push(`📍 互动方式：${typeMap[fields.interaction_type] ?? fields.interaction_type}`);
  }
  lines.push("\n点击下方「创建任务」按钮确认并开始匹配！");
  return lines.join("\n");
}

// ─── 主组件 ────────────────────────────────────────────────────────

export function TaskChatScreen({
  personaId,
  personaName,
  actionKey,
  onGoBack,
  taskService,
  onCreateTask,
  creating: externalCreating,
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

  // ── LLM 提取状态 ──
  const [extracting, setExtracting] = useState(false);
  const [extractionComplete, setExtractionComplete] = useState(false);
  const [creating, setCreating] = useState(false);
  const isCreating = creating || externalCreating;

  // ── 入场动画 ──
  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  // ── 用户消息数 ──
  const userMsgCount = messages.filter((m) => m.role === "user").length;

  // ── 序列化对话历史（用于 API 调用） ──
  const serializeHistory = useCallback(() => {
    return messages
      .filter((m) => m.id !== "welcome" && !m.isSummary)
      .map((m) => `${m.role === "user" ? "用户" : "AI"}：${m.content}`);
  }, [messages]);

  // ── 发送消息 — 策略 A 核心流程 ──
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || extracting) return;

    // 1. 添加用户消息到聊天列表
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    Keyboard.dismiss();

    // 2. 如果有 taskService → 调 LLM 提取
    if (taskService) {
      setExtracting(true);
      try {
        const history = serializeHistory();
        const result = await taskService.extract({
          personaId,
          userMessage: text,
          conversationHistory: history,
        });

        if (result.complete) {
          // 提取完成 → 展示确认摘要
          const summaryMsg: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: formatSummary(result.fields),
            isSummary: true,
          };
          setMessages((prev) => [...prev, summaryMsg]);
          setExtractionComplete(true);
        } else if (result.followUpQuestion) {
          // 未完成 → AI 追问
          const aiReply: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: result.followUpQuestion,
          };
          setMessages((prev) => [...prev, aiReply]);
        } else {
          // 兜底：没有追问也没完成
          const aiReply: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: "收到！还有什么想补充的吗？说得越详细，匹配越精准。",
          };
          setMessages((prev) => [...prev, aiReply]);
        }
      } catch (err) {
        console.warn("[TaskChat] extract 失败:", err);
        const errorMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "抱歉，分析过程中出现了问题，请再试一次。",
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setExtracting(false);
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 120);
      }
    } else {
      // 无 taskService → 占位回复（旧模式兜底）
      const aiReply: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `收到！我已记录：「${text}」\n\n还有什么需要补充的吗？`,
      };
      setMessages((prev) => [...prev, aiReply]);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 120);
    }
  }, [input, extracting, taskService, personaId, serializeHistory]);

  // ── 点击「创建任务」确认 ──
  const handleCreateTask = useCallback(async () => {
    if (isCreating) return;
    const turns = serializeHistory();

    if (taskService) {
      // 策略 A：通过 TaskService 创建
      setCreating(true);
      try {
        const result = await taskService.createFromIntake({
          personaId,
          conversationTurns: turns,
        });
        console.log("[TaskChat] 任务创建成功:", result);

        // 添加成功消息
        const successMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: `任务已创建成功！正在为你启动匹配...\n\n任务 ID: ${result.taskId}\n状态: ${result.status}`,
        };
        setMessages((prev) => [...prev, successMsg]);

        // 短暂展示后返回
        setTimeout(() => onGoBack(), 1500);
      } catch (err) {
        console.warn("[TaskChat] 创建任务失败:", err);
        const errorMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "创建任务时出现问题，请重试。",
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setCreating(false);
      }
    } else if (onCreateTask) {
      // 旧模式兜底
      onCreateTask(personaId, turns);
    }
  }, [isCreating, taskService, onCreateTask, personaId, serializeHistory, onGoBack]);

  // ── 颜色变量 ──
  const headerBg = isDark ? "rgba(28,28,30,0.92)" : "rgba(242,242,247,0.92)";
  const aiBubbleBg = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.04)";
  const userBubbleBg = isDark ? "rgba(255,55,95,0.18)" : "rgba(255,45,85,0.10)";
  const inputBg = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)";
  const blurTint = isDark ? "systemUltraThinMaterialDark" : "systemUltraThinMaterial";
  const isIOS = Platform.OS === "ios";

  // ── 是否显示创建按钮 ──
  // 有 taskService 时：extractionComplete=true 才显示
  // 无 taskService（旧模式）：用户发过消息就显示
  const showCreateBtn = taskService
    ? extractionComplete && !creating
    : userMsgCount >= 1 && !!onCreateTask;

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
                    // 确认摘要消息添加高亮边框
                    item.isSummary && {
                      borderWidth: 1,
                      borderColor: colors.accent + "40",
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

        {/* ── LLM 提取中指示器 ── */}
        {extracting && (
          <View style={styles.typingWrap}>
            <View style={[styles.msgAvatar, { backgroundColor: avatarColor + "99" }]}>
              <Text style={styles.msgAvatarChar}>
                {personaName.slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <View style={[styles.chatBubble, { backgroundColor: aiBubbleBg }]}>
              <ActivityIndicator size="small" color={colors.accent} />
            </View>
          </View>
        )}

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
        {/* 左侧「创建任务」按钮 */}
        {showCreateBtn && (
          <TouchableOpacity
            style={[
              styles.actionBtn,
              { backgroundColor: colors.accent },
              isCreating && styles.actionBtnDisabled,
            ]}
            onPress={handleCreateTask}
            disabled={isCreating}
            activeOpacity={0.7}
          >
            <Text style={styles.actionBtnText}>
              {isCreating ? "..." : "✦"}
            </Text>
          </TouchableOpacity>
        )}
        <View style={[styles.inputField, { backgroundColor: inputBg, flex: 1 }]}>
          <TextInput
            style={[styles.input, { color: colors.text }]}
            placeholder={extractionComplete ? "补充说明（可选）..." : "输入消息..."}
            placeholderTextColor={colors.subtitle + "80"}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={handleSend}
            returnKeyType="send"
            multiline
            blurOnSubmit
            editable={!extracting}
          />
        </View>
        <TouchableOpacity
          style={[
            styles.sendBtn,
            { backgroundColor: colors.accent },
            (!input.trim() || extracting) && styles.sendBtnDisabled,
          ]}
          onPress={handleSend}
          disabled={!input.trim() || extracting}
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

  // ── LLM 思考中指示器 ──
  typingWrap: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 14,
    marginBottom: 14,
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
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  actionBtnDisabled: {
    opacity: 0.5,
  },
  actionBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
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
