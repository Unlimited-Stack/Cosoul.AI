/**
 * AiCoreScreen.tsx
 * 「AI 锐评」核心页面——整个应用最核心的交互区。
 *
 * 功能流程：
 *   1. 用户点击图片区域，通过平台注入的 onPickImage 选择/拍摄照片
 *   2. 选择锐评人格风格（毒舌 / 彩虹屁 / 专业摄影师）
 *   3. 选择 AI 模型（Kimi K2.5 / Qwen 3.5+）
 *   4. 点击「开始锐评」调用 API，流式展示 AI 评价结果
 *
 * 跨平台策略：
 *   - Web 端使用 SSE 流式输出（fetch + ReadableStream）
 *   - Native 端回退为非流式模式（一次性返回完整结果）
 *   - 图片选择通过 props 注入，各平台独立实现
 */
import { useState, useRef, useCallback } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useTheme } from "../theme/ThemeContext";
import { PERSONAS, MODELS, type PersonaKey } from "./critiquePrompts";
import { parseSSEStream } from "./sseParser";

export interface AiCoreScreenProps {
  onPickImage: () => Promise<string | null>; // 平台注入的图片选择函数，返回 base64 data URI
  apiBaseUrl: string;                         // API 代理地址（Web: "/api/critique"，Native: 完整 URL）
}

export function AiCoreScreen({ onPickImage, apiBaseUrl }: AiCoreScreenProps) {
  const { colors, isDark } = useTheme();

  // ── 组件状态 ────────────────────────────────────────────────────────
  const [imageBase64, setImageBase64] = useState<string | null>(null);  // 已选图片的 base64
  const [persona, setPersona] = useState<PersonaKey>("roast");          // 当前选中的锐评人格
  const [model, setModel] = useState(MODELS[0].id);                    // 当前选中的 AI 模型
  const [critiqueText, setCritiqueText] = useState("");                 // 累积的锐评文本（流式追加）
  const [isLoading, setIsLoading] = useState(false);                   // 是否正在请求中
  const [error, setError] = useState<string | null>(null);             // 错误信息
  const abortRef = useRef<AbortController | null>(null);               // 用于中止请求
  const scrollRef = useRef<ScrollView>(null);

  // 调用平台注入的图片选择器，获取 base64 结果
  const handlePickImage = useCallback(async () => {
    try {
      const result = await onPickImage();
      if (result) {
        setImageBase64(result);
        setError(null);
        setCritiqueText("");
      }
    } catch {
      setError("图片选择失败");
    }
  }, [onPickImage]);

  // 提交锐评请求：向 API 代理发送图片 + 人格 + 模型参数
  const handleSubmit = useCallback(async () => {
    if (!imageBase64 || isLoading) return;

    setIsLoading(true);
    setError(null);
    setCritiqueText("");

    abortRef.current = new AbortController();

    // Web 端支持 ReadableStream，启用 SSE 流式；Native 端回退为非流式
    const useStream = Platform.OS === "web";

    try {
      const res = await fetch(apiBaseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          persona,
          imageBase64,
          stream: useStream,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `API 错误: ${res.status}`);
      }

      if (useStream && res.body) {
        // 流式模式：逐块解析 SSE 并追加到结果文本
        const reader = res.body.getReader();
        for await (const chunk of parseSSEStream(reader)) {
          setCritiqueText((prev) => prev + chunk);
        }
      } else {
        // 非流式模式（Native fallback）：一次性读取完整响应
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content || "无响应内容";
        setCritiqueText(content);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      const message = err instanceof Error ? err.message : "未知错误";
      setError(message);
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, [imageBase64, isLoading, apiBaseUrl, model, persona]);

  // 中止当前正在进行的请求
  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setIsLoading(false);
  }, []);

  // 清除已选图片并重置结果
  const handleClearImage = useCallback(() => {
    setImageBase64(null);
    setCritiqueText("");
    setError(null);
  }, []);

  return (
    <ScrollView
      ref={scrollRef}
      style={[styles.scrollView, { backgroundColor: colors.bg }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* 标题区 */}
      <Text style={styles.emoji}>✨</Text>
      <Text style={[styles.title, { color: colors.accent }]}>AI 锐评核心</Text>
      <Text style={styles.badge}>CORE</Text>

      {/* 图片区 */}
      <TouchableOpacity
        style={[
          styles.imageArea,
          {
            borderColor: imageBase64 ? colors.accent : colors.subtitle,
            backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)",
          },
        ]}
        onPress={handlePickImage}
        activeOpacity={0.7}
      >
        {imageBase64 ? (
          <View style={styles.imageWrapper}>
            <Image
              source={{ uri: imageBase64 }}
              style={styles.imagePreview}
              resizeMode="cover"
            />
            <TouchableOpacity
              style={styles.clearButton}
              onPress={handleClearImage}
              activeOpacity={0.7}
            >
              <Text style={styles.clearButtonText}>✕</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.imagePlaceholder}>
            <Text style={styles.uploadEmoji}>📷</Text>
            <Text style={[styles.uploadText, { color: colors.subtitle }]}>
              点击上传或拍摄照片
            </Text>
          </View>
        )}
      </TouchableOpacity>

      {/* 锐评风格选择器 */}
      <Text style={[styles.sectionLabel, { color: colors.subtitle }]}>锐评风格</Text>
      <View style={styles.selectorRow}>
        {PERSONAS.map((p) => {
          const isActive = persona === p.key;
          return (
            <TouchableOpacity
              key={p.key}
              style={[
                styles.pill,
                {
                  backgroundColor: isActive
                    ? colors.accent
                    : isDark
                      ? "rgba(255,255,255,0.08)"
                      : "rgba(0,0,0,0.05)",
                  borderColor: isActive ? colors.accent : "transparent",
                },
              ]}
              onPress={() => setPersona(p.key)}
              activeOpacity={0.7}
            >
              <Text style={styles.pillEmoji}>{p.emoji}</Text>
              <Text
                style={[
                  styles.pillLabel,
                  { color: isActive ? "#FFFFFF" : colors.text },
                ]}
              >
                {p.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* AI 模型选择器 */}
      <Text style={[styles.sectionLabel, { color: colors.subtitle }]}>AI 模型</Text>
      <View style={styles.selectorRow}>
        {MODELS.map((m) => {
          const isActive = model === m.id;
          return (
            <TouchableOpacity
              key={m.id}
              style={[
                styles.modelPill,
                {
                  backgroundColor: isActive
                    ? colors.accent
                    : isDark
                      ? "rgba(255,255,255,0.08)"
                      : "rgba(0,0,0,0.05)",
                },
              ]}
              onPress={() => setModel(m.id)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.modelLabel,
                  { color: isActive ? "#FFFFFF" : colors.text },
                ]}
              >
                {m.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* 提交 / 停止按钮 */}
      {isLoading ? (
        <TouchableOpacity
          style={[styles.submitButton, { backgroundColor: colors.subtitle }]}
          onPress={handleStop}
          activeOpacity={0.7}
        >
          <Text style={styles.submitText}>⏹ 停止生成</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[
            styles.submitButton,
            {
              backgroundColor: imageBase64 ? colors.accent : colors.subtitle,
              opacity: imageBase64 ? 1 : 0.5,
            },
          ]}
          onPress={handleSubmit}
          disabled={!imageBase64}
          activeOpacity={0.7}
        >
          <Text style={styles.submitText}>🎬 开始锐评</Text>
        </TouchableOpacity>
      )}

      {/* 加载指示器 */}
      {isLoading && (
        <ActivityIndicator
          size="small"
          color={colors.accent}
          style={styles.loadingIndicator}
        />
      )}

      {/* 错误提示 */}
      {error && (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>⚠️ {error}</Text>
        </View>
      )}

      {/* 锐评结果 */}
      {critiqueText.length > 0 && (
        <View
          style={[
            styles.resultCard,
            {
              backgroundColor: isDark
                ? "rgba(255,255,255,0.06)"
                : "rgba(0,0,0,0.03)",
              borderColor: isDark
                ? "rgba(255,255,255,0.1)"
                : "rgba(0,0,0,0.08)",
            },
          ]}
        >
          <Text style={[styles.resultLabel, { color: colors.accent }]}>
            AI 锐评结果
          </Text>
          <Text style={[styles.resultText, { color: colors.text }]}>
            {critiqueText}
            {isLoading && <Text style={styles.cursor}>▌</Text>}
          </Text>
        </View>
      )}

      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
}

// ── 样式定义 ──────────────────────────────────────────────────────────
// 动态颜色（深浅色适配）通过 useTheme() 内联传入，此处仅定义布局与尺寸
const styles = StyleSheet.create({
  // 根滚动容器
  scrollView: {
    flex: 1,
  },
  content: {
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 60,
  },
  emoji: {
    fontSize: 56,
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 8,
  },
  badge: {
    backgroundColor: "#FF2D55",
    color: "#fff",
    fontSize: 12,
    fontWeight: "bold",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 24,
    overflow: "hidden",
  },
  // 图片选择/预览区域：虚线边框 + 4:3 宽高比
  imageArea: {
    width: "100%",
    maxWidth: 360,
    aspectRatio: 4 / 3,
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: "dashed",
    overflow: "hidden",
    marginBottom: 24,
  },
  imageWrapper: {
    flex: 1,
    position: "relative",
  },
  imagePreview: {
    width: "100%",
    height: "100%",
  },
  // 图片右上角的清除按钮
  clearButton: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  clearButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "bold",
  },
  imagePlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  uploadEmoji: {
    fontSize: 40,
    marginBottom: 8,
  },
  uploadText: {
    fontSize: 14,
  },
  // 分区标题（"锐评风格"、"AI 模型"）
  sectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.3,
    marginBottom: 10,
  },
  selectorRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 20,
  },
  // 人格选择器药丸按钮
  pill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    gap: 4,
  },
  pillEmoji: {
    fontSize: 16,
  },
  pillLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  // 模型选择器药丸按钮
  modelPill: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
  },
  modelLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  // "开始锐评" / "停止生成" 主按钮
  submitButton: {
    paddingHorizontal: 40,
    paddingVertical: 14,
    borderRadius: 25,
    marginTop: 4,
  },
  submitText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "bold",
  },
  loadingIndicator: {
    marginTop: 12,
  },
  errorCard: {
    backgroundColor: "rgba(255,59,48,0.12)",
    borderRadius: 12,
    padding: 12,
    marginTop: 16,
    width: "100%",
    maxWidth: 360,
  },
  errorText: {
    color: "#FF3B30",
    fontSize: 14,
  },
  // 锐评结果展示卡片
  resultCard: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginTop: 20,
  },
  resultLabel: {
    fontSize: 15,
    fontWeight: "bold",
    marginBottom: 10,
  },
  resultText: {
    fontSize: 15,
    lineHeight: 24,
  },
  // 流式输出时的闪烁光标
  cursor: {
    color: "#FF2D55",
  },
  // 底部留白，避免内容被浮空 TabBar 遮挡
  bottomSpacer: {
    height: 120,
  },
});
