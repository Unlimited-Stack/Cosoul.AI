/**
 * AiCoreScreen.tsx
 * 「Agent」页面 — 模型切换 + 状态反馈
 *
 * 功能：
 * 1. 通过注入的 LlmService 获取模型列表（静态数据，无网络请求）
 * 2. 按品牌分组展示，点击切换
 * 3. 通过 LlmService.verifyModel() 验证模型可用性
 * 4. 底部常驻状态栏：灰色加载 → 绿色成功（显示模型名）→ 红色失败
 *
 * 架构：
 *   本组件不关心 LLM 请求走代理还是直连，由上层 App 注入 LlmService 决定：
 *   - Web 注入 createProxyLlmService("/api")    → 走 Next.js BFF
 *   - Native 注入 createDirectLlmService(config) → 直连 Coding Plan
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useTheme } from "../theme/ThemeContext";

// ─── 类型（从 @repo/core/llm 对齐） ─────────────────────────────

interface ModelInfo {
  id: string;
  brand: string;
  capabilities: string[];
}

interface VerifyResult {
  ok: boolean;
  model: string;
  reply?: string;
  error?: string;
}

/** LLM 服务接口 — 与 @repo/core/llm 的 LlmService 保持一致 */
export interface LlmServiceLike {
  getModels(): ModelInfo[];
  verifyModel(modelId: string): Promise<VerifyResult>;
}

type SwitchStatus = "idle" | "loading" | "success" | "error";

export interface AiCoreScreenProps {
  /** 注入的 LLM 服务实例（由各 App 层通过 @repo/core/llm 创建） */
  llmService: LlmServiceLike;
}

// ─── 能力标签颜色 ─────────────────────────────────────────────

const CAPABILITY_COLORS: Record<string, string> = {
  "文本生成": "#3B82F6",
  "深度思考": "#8B5CF6",
  "视觉理解": "#F59E0B",
};

// ─── 主组件 ────────────────────────────────────────────────────

export function AiCoreScreen({ llmService }: AiCoreScreenProps) {
  const { colors, isDark } = useTheme();

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [switchStatus, setSwitchStatus] = useState<SwitchStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [activeModelName, setActiveModelName] = useState("");

  // 状态栏淡入动画
  const statusOpacity = useRef(new Animated.Value(0)).current;

  // 加载模型列表（同步，静态数据）
  useEffect(() => {
    setModels(llmService.getModels());
  }, [llmService]);

  // 状态变化时播放动画
  const animateStatusBar = useCallback(() => {
    statusOpacity.setValue(0);
    Animated.timing(statusOpacity, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [statusOpacity]);

  // 切换模型
  const handleSelectModel = useCallback(
    async (modelId: string) => {
      if (switchStatus === "loading") return;
      if (modelId === activeModelName && switchStatus === "success") return;

      setSelectedModel(modelId);
      setSwitchStatus("loading");
      setStatusMessage("正在切换模型中");
      animateStatusBar();

      const data = await llmService.verifyModel(modelId);

      if (data.ok) {
        setSwitchStatus("success");
        setActiveModelName(data.model);
        setStatusMessage("切换成功，现在正在使用：");
      } else {
        setSwitchStatus("error");
        setStatusMessage(data.error ?? "模型切换失败");
      }
      animateStatusBar();
    },
    [llmService, switchStatus, activeModelName, animateStatusBar]
  );

  // 按品牌分组
  const grouped = models.reduce<Record<string, ModelInfo[]>>((acc, m) => {
    (acc[m.brand] ??= []).push(m);
    return acc;
  }, {});

  // 状态栏颜色
  const statusBarBg =
    switchStatus === "loading"
      ? isDark ? "rgba(120,120,128,0.24)" : "rgba(142,142,147,0.12)"
      : switchStatus === "success"
        ? isDark ? "rgba(48,209,88,0.16)" : "rgba(52,199,89,0.12)"
        : switchStatus === "error"
          ? isDark ? "rgba(255,69,58,0.16)" : "rgba(255,59,48,0.12)"
          : "transparent";

  const statusTextColor =
    switchStatus === "loading"
      ? colors.subtitle
      : switchStatus === "success"
        ? isDark ? "#30D158" : "#34C759"
        : switchStatus === "error"
          ? isDark ? "#FF453A" : "#FF3B30"
          : colors.subtitle;

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      {/* 标题 */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Agent</Text>
        <Text style={[styles.subtitle, { color: colors.subtitle }]}>
          AI Agent 智能匹配与社交协作
        </Text>
      </View>

      {/* 顶部状态栏 — 嵌在标题和列表之间，不遮挡内容 */}
      {switchStatus !== "idle" && (
        <Animated.View
          style={[
            styles.statusBar,
            { backgroundColor: statusBarBg, opacity: statusOpacity },
          ]}
        >
          {switchStatus === "loading" && (
            <View style={styles.statusRow}>
              <ActivityIndicator
                size="small"
                color={colors.subtitle}
                style={styles.statusSpinner}
              />
              <Text style={[styles.statusText, { color: statusTextColor }]}>
                {statusMessage}
              </Text>
            </View>
          )}
          {switchStatus === "success" && (
            <View style={styles.statusRow}>
              <Text style={[styles.statusText, { color: statusTextColor }]}>
                {statusMessage}
              </Text>
              <Text style={[styles.statusModelName, { color: statusTextColor }]}>
                {activeModelName}
              </Text>
            </View>
          )}
          {switchStatus === "error" && (
            <View style={styles.statusCol}>
              <Text style={[styles.statusText, { color: statusTextColor }]}>
                切换失败
              </Text>
              <Text
                style={[styles.statusErrorDetail, { color: statusTextColor }]}
                numberOfLines={3}
              >
                {statusMessage}
              </Text>
            </View>
          )}
        </Animated.View>
      )}

      {/* 模型列表 */}
      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.sectionLabel, { color: colors.subtitle }]}>
          选择模型
        </Text>

        {Object.entries(grouped).map(([brand, brandModels]) => (
          <View key={brand} style={styles.brandGroup}>
            <Text style={[styles.brandLabel, { color: colors.subtitle }]}>
              {brand}
            </Text>
            {brandModels.map((m) => {
              const isActive = activeModelName === m.id && switchStatus === "success";
              const isSelected = selectedModel === m.id;
              const cardBorder = isActive
                ? isDark ? "#30D158" : "#34C759"
                : isSelected && switchStatus === "loading"
                  ? colors.accent
                  : "transparent";
              const cardBg = isDark
                ? "rgba(120,120,128,0.16)"
                : "rgba(142,142,147,0.08)";

              return (
                <TouchableOpacity
                  key={m.id}
                  style={[
                    styles.modelCard,
                    {
                      backgroundColor: cardBg,
                      borderColor: cardBorder,
                      borderWidth: isActive || (isSelected && switchStatus === "loading") ? 1.5 : 0.5,
                    },
                  ]}
                  activeOpacity={0.6}
                  onPress={() => handleSelectModel(m.id)}
                  disabled={switchStatus === "loading"}
                >
                  <View style={styles.modelCardTop}>
                    <Text
                      style={[
                        styles.modelName,
                        { color: colors.text },
                        isActive && { color: isDark ? "#30D158" : "#34C759" },
                      ]}
                    >
                      {m.id}
                    </Text>
                    {isActive && (
                      <View style={[styles.activeBadge, { backgroundColor: isDark ? "#30D158" : "#34C759" }]}>
                        <Text style={styles.activeBadgeText}>使用中</Text>
                      </View>
                    )}
                    {isSelected && switchStatus === "loading" && (
                      <ActivityIndicator size="small" color={colors.accent} />
                    )}
                  </View>
                  <View style={styles.capRow}>
                    {m.capabilities.map((cap) => (
                      <View
                        key={cap}
                        style={[
                          styles.capBadge,
                          { backgroundColor: (CAPABILITY_COLORS[cap] ?? "#6B7280") + "20" },
                        ]}
                      >
                        <Text
                          style={[
                            styles.capText,
                            { color: CAPABILITY_COLORS[cap] ?? "#6B7280" },
                          ]}
                        >
                          {cap}
                        </Text>
                      </View>
                    ))}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}

        {models.length === 0 && (
          <View style={styles.emptyBox}>
            <ActivityIndicator size="small" color={colors.subtitle} />
            <Text style={[styles.emptyText, { color: colors.subtitle }]}>
              加载模型列表...
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── 样式 ──────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    paddingTop: 48,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 120,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "500",
    letterSpacing: 0.3,
    marginBottom: 12,
  },
  brandGroup: {
    marginBottom: 20,
  },
  brandLabel: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 8,
    marginLeft: 2,
  },
  modelCard: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 0.5,
  },
  modelCardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  modelName: {
    fontSize: 16,
    fontWeight: "600",
    flex: 1,
  },
  activeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  activeBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  capRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  capBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  capText: {
    fontSize: 11,
    fontWeight: "500",
  },
  emptyBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
    gap: 8,
  },
  emptyText: {
    fontSize: 14,
  },
  // 顶部内联状态栏（标题下方，不遮挡内容）
  statusBar: {
    marginHorizontal: 16,
    marginBottom: 4,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  statusSpinner: {
    marginRight: 6,
  },
  statusCol: {
    gap: 2,
  },
  statusText: {
    fontSize: 13,
    fontWeight: "500",
  },
  statusModelName: {
    fontSize: 15,
    fontWeight: "700",
  },
  statusErrorDetail: {
    fontSize: 12,
    opacity: 0.85,
  },
});
