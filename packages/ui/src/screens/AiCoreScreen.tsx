/**
 * AiCoreScreen.tsx → AgentDebugScreen
 * Agent 调试页面 — 模型连接测试 + PersonaAgent 数据监控
 *
 * 上半部分：模型连接（横向紧凑行，点击展开 + 验证变绿）
 * 下半部分：PersonaAgent 数据可视化（Soul.md / Tasks / DB 数据流）
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
import { ChevronLeftIcon } from "../components/TabIcons";

// ─── 类型 ──────────────────────────────────────────────────────

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

/** LLM 服务接口 */
export interface LlmServiceLike {
  getModels(): ModelInfo[];
  verifyModel(modelId: string): Promise<VerifyResult>;
}

/** 调试用分身完整数据（含 Soul.md + tasks） */
export interface DebugPersonaInfo {
  personaId: string;
  name: string;
  bio?: string | null;
  createdAt?: string | null;
  profileText?: string | null;
  preferences?: Record<string, unknown> | null;
  tasks: Array<{
    taskId: string;
    rawDescription: string;
    status: string;
    interactionType: string;
    targetActivity?: string | null;
  }>;
}

export interface AiCoreScreenProps {
  llmService: LlmServiceLike;
  onGoBack?: () => void;
  /** 获取调试用分身完整数据（含 Soul.md + tasks） */
  fetchDebugPersonas?: () => Promise<DebugPersonaInfo[]>;
}

export type AgentDebugScreenProps = AiCoreScreenProps;

// ─── 常量 ──────────────────────────────────────────────────────

type ModelStatus = "idle" | "loading" | "success" | "error";

const STATUS_COLORS = {
  Drafting: "#007AFF",
  Matching: "#FF9500",
  Waiting_Human: "#FF6B00",
  Done: "#34C759",
  Cancelled: "#FF3B30",
} as Record<string, string>;

// ─── 主组件 ────────────────────────────────────────────────────

export function AiCoreScreen({
  llmService,
  onGoBack,
  fetchDebugPersonas,
}: AiCoreScreenProps) {
  const { colors, isDark } = useTheme();

  // ── 模型相关状态 ──
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsExpanded, setModelsExpanded] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");
  const [loadingModel, setLoadingModel] = useState("");
  const [modelStatuses, setModelStatuses] = useState<
    Record<string, { status: ModelStatus; msg?: string }>
  >({});

  // 展开动画
  const expandAnim = useRef(new Animated.Value(0)).current;

  // ── PersonaAgent 调试数据 ──
  const [debugPersonas, setDebugPersonas] = useState<DebugPersonaInfo[]>([]);
  const [loadingPersonas, setLoadingPersonas] = useState(false);
  const [personaError, setPersonaError] = useState("");
  const [expandedPersonaId, setExpandedPersonaId] = useState<string | null>(
    null
  );

  // ── 加载模型列表 ──
  useEffect(() => {
    setModels(llmService.getModels());
  }, [llmService]);

  // ── 初始加载 PersonaAgent 数据 ──
  const loadDebugPersonas = useCallback(async () => {
    if (!fetchDebugPersonas) return;
    setLoadingPersonas(true);
    setPersonaError("");
    try {
      const data = await fetchDebugPersonas();
      setDebugPersonas(data);
    } catch (err: unknown) {
      setPersonaError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingPersonas(false);
    }
  }, [fetchDebugPersonas]);

  useEffect(() => {
    loadDebugPersonas();
  }, [loadDebugPersonas]);

  // ── 展开模型行 ──
  const handleExpandModels = useCallback(() => {
    setModelsExpanded(true);
    expandAnim.setValue(0);
    Animated.timing(expandAnim, {
      toValue: 1,
      duration: 380,
      useNativeDriver: true,
    }).start();
  }, [expandAnim]);

  // ── 验证模型 ──
  const handleVerifyModel = useCallback(
    async (modelId: string) => {
      if (loadingModel) return;
      setSelectedModel(modelId);
      setLoadingModel(modelId);
      setModelStatuses((prev) => ({
        ...prev,
        [modelId]: { status: "loading" },
      }));

      try {
        const result = await llmService.verifyModel(modelId);
        if (result.ok) {
          setModelStatuses((prev) => ({
            ...prev,
            [modelId]: { status: "success", msg: result.reply },
          }));
        } else {
          setModelStatuses((prev) => ({
            ...prev,
            [modelId]: { status: "error", msg: result.error },
          }));
        }
      } catch (err: unknown) {
        setModelStatuses((prev) => ({
          ...prev,
          [modelId]: {
            status: "error",
            msg: err instanceof Error ? err.message : "未知错误",
          },
        }));
      } finally {
        setLoadingModel("");
      }
    },
    [llmService, loadingModel]
  );

  // ── 样式动态值 ──
  const cardBg = isDark
    ? "rgba(120,120,128,0.16)"
    : "rgba(142,142,147,0.08)";
  const inputBg = isDark
    ? "rgba(120,120,128,0.24)"
    : "rgba(142,142,147,0.12)";
  const borderColor = isDark
    ? "rgba(255,255,255,0.08)"
    : "rgba(0,0,0,0.06)";
  const greenColor = isDark ? "#30D158" : "#34C759";
  const redColor = isDark ? "#FF453A" : "#FF3B30";

  // ── 当前选中模型的验证结果 ──
  const selectedStatus = selectedModel
    ? modelStatuses[selectedModel]
    : undefined;

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      {/* 标题栏 */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          {onGoBack && (
            <TouchableOpacity
              onPress={onGoBack}
              style={styles.backBtn}
              activeOpacity={0.6}
            >
              <ChevronLeftIcon size={22} color={colors.accent} />
            </TouchableOpacity>
          )}
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.text }]}>
              调试工具
            </Text>
            <Text style={[styles.subtitle, { color: colors.subtitle }]}>
              Coding Plan + PersonaAgent 调试监控
            </Text>
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ══════════ 模型连接测试区 ══════════ */}
        <Text style={[styles.sectionLabel, { color: colors.subtitle }]}>
          模型连接测试
        </Text>

        {!modelsExpanded ? (
          /* 初始态：一个全宽按钮 */
          <TouchableOpacity
            style={[styles.expandBtn, { backgroundColor: colors.accent }]}
            onPress={handleExpandModels}
            activeOpacity={0.7}
          >
            <Text style={styles.expandBtnText}>测试模型连接</Text>
          </TouchableOpacity>
        ) : (
          /* 展开态：紧凑横向行 */
          <View style={styles.modelRowWrap}>
            {/* 左侧「测试」标签 */}
            <View
              style={[
                styles.modelRowLabel,
                { backgroundColor: colors.accent },
              ]}
            >
              <Text style={styles.modelRowLabelText}>测试</Text>
            </View>

            {/* 模型横向滚动列表，从右侧滑入 */}
            <Animated.View
              style={[
                styles.modelRowAnimWrap,
                {
                  opacity: expandAnim,
                  transform: [
                    {
                      translateX: expandAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [160, 0],
                      }),
                    },
                  ],
                },
              ]}
            >
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.modelChipsContainer}
              >
                {models.map((m) => {
                  const ms = modelStatuses[m.id];
                  const isLoading = loadingModel === m.id;
                  const isSuccess = ms?.status === "success";
                  const isError = ms?.status === "error";

                  const chipBorderColor = isSuccess
                    ? greenColor
                    : isError
                      ? redColor
                      : isLoading
                        ? colors.accent
                        : borderColor;

                  return (
                    <TouchableOpacity
                      key={m.id}
                      style={[
                        styles.modelChip,
                        {
                          backgroundColor: cardBg,
                          borderColor: chipBorderColor,
                          borderWidth: isSuccess || isError || isLoading ? 1.5 : 0.5,
                        },
                      ]}
                      onPress={() => handleVerifyModel(m.id)}
                      disabled={!!loadingModel}
                      activeOpacity={0.6}
                    >
                      {isLoading ? (
                        <ActivityIndicator size="small" color={colors.accent} />
                      ) : (
                        <Text
                          style={[
                            styles.modelChipText,
                            { color: colors.text },
                            isSuccess && { color: greenColor, fontWeight: "700" },
                            isError && { color: redColor },
                          ]}
                          numberOfLines={1}
                        >
                          {m.id}
                        </Text>
                      )}
                      {isSuccess && (
                        <Text style={[styles.chipDot, { color: greenColor }]}>
                          {"\u2713"}
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </Animated.View>
          </View>
        )}

        {/* 验证结果状态条 */}
        {selectedStatus && selectedStatus.status !== "idle" && (
          <View
            style={[
              styles.verifyResult,
              {
                backgroundColor:
                  selectedStatus.status === "success"
                    ? greenColor + "18"
                    : selectedStatus.status === "error"
                      ? redColor + "18"
                      : inputBg,
                borderColor:
                  selectedStatus.status === "success"
                    ? greenColor + "40"
                    : selectedStatus.status === "error"
                      ? redColor + "40"
                      : borderColor,
              },
            ]}
          >
            <Text
              style={[
                styles.verifyResultText,
                {
                  color:
                    selectedStatus.status === "success"
                      ? greenColor
                      : selectedStatus.status === "error"
                        ? redColor
                        : colors.subtitle,
                },
              ]}
            >
              {selectedStatus.status === "loading" && `正在验证 ${selectedModel}...`}
              {selectedStatus.status === "success" &&
                `${selectedModel} 连接成功`}
              {selectedStatus.status === "error" &&
                `${selectedModel} 失败: ${selectedStatus.msg}`}
            </Text>
          </View>
        )}

        {/* ══════════ PersonaAgent 数据监控区 ══════════ */}
        <View style={styles.sectionDivider} />
        <View style={styles.personaSectionHeader}>
          <Text style={[styles.sectionLabel, { color: colors.subtitle, marginBottom: 0 }]}>
            PersonaAgent 数据监控
          </Text>
          <TouchableOpacity
            style={[styles.refreshBtn, { backgroundColor: inputBg }]}
            onPress={loadDebugPersonas}
            disabled={loadingPersonas}
            activeOpacity={0.6}
          >
            {loadingPersonas ? (
              <ActivityIndicator size="small" color={colors.subtitle} />
            ) : (
              <Text style={[styles.refreshBtnText, { color: colors.accent }]}>
                刷新数据
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* 数据总览 */}
        <View style={[styles.overviewRow, { backgroundColor: cardBg, borderColor }]}>
          <View style={styles.overviewItem}>
            <Text style={[styles.overviewNum, { color: colors.text }]}>
              {debugPersonas.length}
            </Text>
            <Text style={[styles.overviewLabel, { color: colors.subtitle }]}>
              分身
            </Text>
          </View>
          <View style={[styles.overviewDivider, { backgroundColor: borderColor }]} />
          <View style={styles.overviewItem}>
            <Text style={[styles.overviewNum, { color: colors.text }]}>
              {debugPersonas.reduce((sum, p) => sum + p.tasks.length, 0)}
            </Text>
            <Text style={[styles.overviewLabel, { color: colors.subtitle }]}>
              任务
            </Text>
          </View>
          <View style={[styles.overviewDivider, { backgroundColor: borderColor }]} />
          <View style={styles.overviewItem}>
            <Text style={[styles.overviewNum, { color: colors.text }]}>
              {debugPersonas.filter((p) => p.profileText).length}
            </Text>
            <Text style={[styles.overviewLabel, { color: colors.subtitle }]}>
              Soul.md
            </Text>
          </View>
        </View>

        {/* 错误提示 */}
        {personaError ? (
          <View style={[styles.errorBox, { backgroundColor: redColor + "18" }]}>
            <Text style={[styles.errorText, { color: redColor }]}>
              加载失败: {personaError}
            </Text>
          </View>
        ) : null}

        {/* 无数据提示 */}
        {!loadingPersonas && debugPersonas.length === 0 && !personaError && (
          <View style={styles.emptyBox}>
            <Text style={[styles.emptyText, { color: colors.subtitle }]}>
              暂无分身数据 — 请先在 Agent 页面创建人格
            </Text>
          </View>
        )}

        {/* 分身卡片列表 */}
        {debugPersonas.map((persona) => {
          const isExpanded = expandedPersonaId === persona.personaId;
          return (
            <View
              key={persona.personaId}
              style={[styles.personaCard, { backgroundColor: cardBg, borderColor }]}
            >
              {/* 卡片头部 — 点击展开/收起 */}
              <TouchableOpacity
                style={styles.personaCardHead}
                onPress={() =>
                  setExpandedPersonaId(isExpanded ? null : persona.personaId)
                }
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.personaDot,
                    { backgroundColor: persona.profileText ? greenColor : colors.subtitle },
                  ]}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.personaName, { color: colors.text }]}>
                    {persona.name}
                  </Text>
                  <Text
                    style={[styles.personaIdText, { color: colors.subtitle }]}
                    numberOfLines={1}
                  >
                    {persona.personaId}
                  </Text>
                </View>
                <View style={styles.personaBadges}>
                  {persona.profileText && (
                    <View style={[styles.badge, { backgroundColor: greenColor + "20" }]}>
                      <Text style={[styles.badgeText, { color: greenColor }]}>
                        Soul.md
                      </Text>
                    </View>
                  )}
                  <View style={[styles.badge, { backgroundColor: colors.accent + "20" }]}>
                    <Text style={[styles.badgeText, { color: colors.accent }]}>
                      {persona.tasks.length} 任务
                    </Text>
                  </View>
                </View>
                <Text style={[styles.chevron, { color: colors.subtitle }]}>
                  {isExpanded ? "\u25B2" : "\u25BC"}
                </Text>
              </TouchableOpacity>

              {/* 展开详情 */}
              {isExpanded && (
                <View style={[styles.personaDetail, { borderTopColor: borderColor }]}>
                  {/* 基本信息 */}
                  <View style={styles.detailSection}>
                    <Text style={[styles.detailLabel, { color: colors.subtitle }]}>
                      基本信息
                    </Text>
                    <DataRow label="personaId" value={persona.personaId} colors={colors} />
                    <DataRow label="name" value={persona.name} colors={colors} />
                    <DataRow label="bio" value={persona.bio ?? "(空)"} colors={colors} />
                    <DataRow
                      label="createdAt"
                      value={persona.createdAt ?? "(空)"}
                      colors={colors}
                    />
                  </View>

                  {/* Soul.md 原文 */}
                  <View style={styles.detailSection}>
                    <Text style={[styles.detailLabel, { color: colors.subtitle }]}>
                      Soul.md (persona_profiles.profileText)
                    </Text>
                    {persona.profileText ? (
                      <SoulMdViewer
                        text={persona.profileText}
                        isDark={isDark}
                      />
                    ) : (
                      <Text style={[styles.noData, { color: colors.subtitle }]}>
                        (暂无 Soul.md — 未写入 persona_profiles)
                      </Text>
                    )}
                  </View>

                  {/* preferences JSON */}
                  {persona.preferences &&
                    Object.keys(persona.preferences).length > 0 && (
                      <View style={styles.detailSection}>
                        <Text style={[styles.detailLabel, { color: colors.subtitle }]}>
                          preferences (JSONB)
                        </Text>
                        <View
                          style={[
                            styles.codeBlock,
                            { backgroundColor: isDark ? "#1a1a2e" : "#f0f0f5" },
                          ]}
                        >
                          <Text
                            style={[
                              styles.codeText,
                              { color: isDark ? "#e0e0e0" : "#333" },
                            ]}
                          >
                            {JSON.stringify(persona.preferences, null, 2)}
                          </Text>
                        </View>
                      </View>
                    )}

                  {/* 任务列表 */}
                  <View style={styles.detailSection}>
                    <Text style={[styles.detailLabel, { color: colors.subtitle }]}>
                      Tasks ({persona.tasks.length})
                    </Text>
                    {persona.tasks.length === 0 ? (
                      <Text style={[styles.noData, { color: colors.subtitle }]}>
                        (暂无任务)
                      </Text>
                    ) : (
                      persona.tasks.map((task) => (
                        <View
                          key={task.taskId}
                          style={[
                            styles.taskRow,
                            {
                              backgroundColor: isDark
                                ? "rgba(120,120,128,0.12)"
                                : "rgba(142,142,147,0.06)",
                              borderColor,
                            },
                          ]}
                        >
                          <View style={styles.taskRowTop}>
                            <Text
                              style={[styles.taskDesc, { color: colors.text }]}
                              numberOfLines={2}
                            >
                              {task.rawDescription}
                            </Text>
                            <View
                              style={[
                                styles.statusBadge,
                                {
                                  backgroundColor:
                                    (STATUS_COLORS[task.status] ?? "#666") + "22",
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.statusText,
                                  { color: STATUS_COLORS[task.status] ?? "#666" },
                                ]}
                              >
                                {task.status}
                              </Text>
                            </View>
                          </View>
                          <DataRow label="taskId" value={task.taskId} colors={colors} />
                          <DataRow
                            label="interactionType"
                            value={task.interactionType}
                            colors={colors}
                          />
                        </View>
                      ))
                    )}
                  </View>

                  {/* 数据链路指示器 */}
                  <View style={styles.detailSection}>
                    <Text style={[styles.detailLabel, { color: colors.subtitle }]}>
                      数据链路
                    </Text>
                    <DataFlowIndicator persona={persona} isDark={isDark} colors={colors} />
                  </View>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─── 子组件：数据行 ──────────────────────────────────────────────

function DataRow({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: { text: string; subtitle: string };
}) {
  return (
    <View style={styles.dataRow}>
      <Text style={[styles.dataRowLabel, { color: colors.subtitle }]}>
        {label}:
      </Text>
      <Text
        style={[styles.dataRowValue, { color: colors.text }]}
        numberOfLines={1}
        selectable
      >
        {value}
      </Text>
    </View>
  );
}

// ─── 子组件：Soul.md 语法高亮渲染 ────────────────────────────────

function SoulMdViewer({ text, isDark }: { text: string; isDark: boolean }) {
  const lines = text.split("\n");
  return (
    <View
      style={[
        styles.soulMdBox,
        { backgroundColor: isDark ? "#1a1a2e" : "#f8f8fc" },
      ]}
    >
      {lines.map((line, i) => {
        let color = isDark ? "#d0d0d0" : "#333";
        let fontWeight: "400" | "700" = "400";
        let fontSize = 12;

        if (line.startsWith("# ")) {
          color = isDark ? "#FF6B6B" : "#C0392B";
          fontWeight = "700";
          fontSize = 14;
        } else if (line.startsWith("## ")) {
          color = isDark ? "#4FC3F7" : "#2980B9";
          fontWeight = "700";
          fontSize = 13;
        } else if (line.startsWith("---")) {
          color = isDark ? "#666" : "#aaa";
        } else if (/^\w[\w_]*\s*:/.test(line)) {
          color = isDark ? "#A5D6A7" : "#27AE60";
        }

        return (
          <Text
            key={i}
            style={{ color, fontWeight, fontSize, lineHeight: fontSize * 1.6 }}
            selectable
          >
            {line || " "}
          </Text>
        );
      })}
    </View>
  );
}

// ─── 子组件：数据链路指示器 ──────────────────────────────────────

function DataFlowIndicator({
  persona,
  isDark,
  colors,
}: {
  persona: DebugPersonaInfo;
  isDark: boolean;
  colors: { text: string; subtitle: string };
}) {
  const hasProfile = !!persona.profileText;
  const hasTasks = persona.tasks.length > 0;
  const hasPrefs =
    !!persona.preferences && Object.keys(persona.preferences).length > 0;

  const green = isDark ? "#30D158" : "#34C759";
  const gray = isDark ? "#555" : "#ccc";

  const steps = [
    { label: "personas 表", ok: true },
    { label: "persona_profiles", ok: hasProfile },
    { label: "Soul.md 生成", ok: hasProfile },
    { label: "preferences JSON", ok: hasPrefs },
    { label: "tasks 表", ok: hasTasks },
  ];

  return (
    <View style={styles.flowRow}>
      {steps.map((step, i) => (
        <View key={step.label} style={styles.flowStepWrap}>
          <View style={styles.flowStep}>
            <View
              style={[
                styles.flowDot,
                { backgroundColor: step.ok ? green : gray },
              ]}
            />
            <Text
              style={[
                styles.flowLabel,
                { color: step.ok ? colors.text : colors.subtitle },
              ]}
            >
              {step.label}
            </Text>
          </View>
          {i < steps.length - 1 && (
            <Text style={[styles.flowArrow, { color: step.ok ? green : gray }]}>
              {"\u2192"}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}

// ─── 样式 ──────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingTop: 48, paddingHorizontal: 20, paddingBottom: 8 },
  headerRow: { flexDirection: "row", alignItems: "center" },
  backBtn: { marginRight: 8, padding: 4 },
  title: { fontSize: 24, fontWeight: "bold", marginBottom: 4 },
  subtitle: { fontSize: 14 },

  scrollArea: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 120 },

  sectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.3,
    marginBottom: 10,
    textTransform: "uppercase",
  },

  // ── 模型展开按钮（初始态） ──
  expandBtn: {
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  expandBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  // ── 模型横向行（展开态） ──
  modelRowWrap: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    height: 44,
  },
  modelRowLabel: {
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  modelRowLabelText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  modelRowAnimWrap: { flex: 1, height: 44 },
  modelChipsContainer: { gap: 6, alignItems: "center", height: 44 },
  modelChip: {
    height: 40,
    paddingHorizontal: 10,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  modelChipText: { fontSize: 11, fontWeight: "500" },
  chipDot: { fontSize: 12, fontWeight: "700" },

  // ── 验证结果条 ──
  verifyResult: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 0.5,
    marginBottom: 12,
  },
  verifyResultText: { fontSize: 13, fontWeight: "500" },

  // ── PersonaAgent 区 ──
  sectionDivider: {
    height: 1,
    marginVertical: 16,
    opacity: 0.1,
    backgroundColor: "#888",
  },
  personaSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  refreshBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  refreshBtnText: { fontSize: 13, fontWeight: "600" },

  // 总览条
  overviewRow: {
    flexDirection: "row",
    borderRadius: 12,
    borderWidth: 0.5,
    padding: 14,
    marginBottom: 12,
  },
  overviewItem: { flex: 1, alignItems: "center" },
  overviewNum: { fontSize: 22, fontWeight: "800" },
  overviewLabel: { fontSize: 12, marginTop: 2 },
  overviewDivider: { width: 1, marginVertical: 4 },

  errorBox: { padding: 12, borderRadius: 10, marginBottom: 12 },
  errorText: { fontSize: 13 },
  emptyBox: { paddingVertical: 30, alignItems: "center" },
  emptyText: { fontSize: 14 },

  // 分身卡片
  personaCard: {
    borderRadius: 14,
    borderWidth: 0.5,
    marginBottom: 12,
    overflow: "hidden",
  },
  personaCardHead: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 10,
  },
  personaDot: { width: 10, height: 10, borderRadius: 5 },
  personaName: { fontSize: 16, fontWeight: "600" },
  personaIdText: { fontSize: 11, marginTop: 1 },
  personaBadges: { flexDirection: "row", gap: 4 },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  badgeText: { fontSize: 10, fontWeight: "600" },
  chevron: { fontSize: 11, marginLeft: 4 },

  // 展开详情
  personaDetail: { borderTopWidth: 0.5, padding: 14 },
  detailSection: { marginBottom: 14 },
  detailLabel: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.3,
    marginBottom: 6,
    textTransform: "uppercase",
  },

  // 数据行
  dataRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 2,
  },
  dataRowLabel: { fontSize: 11, fontWeight: "600", minWidth: 90 },
  dataRowValue: { fontSize: 12, flex: 1 },

  // Soul.md 渲染
  soulMdBox: { borderRadius: 10, padding: 12, marginTop: 4 },

  // 代码块
  codeBlock: { borderRadius: 10, padding: 12, marginTop: 4 },
  codeText: { fontSize: 11, fontFamily: "monospace", lineHeight: 18 },

  // 无数据
  noData: { fontSize: 12, fontStyle: "italic", paddingVertical: 4 },

  // 任务行
  taskRow: { borderRadius: 10, borderWidth: 0.5, padding: 10, marginBottom: 6 },
  taskRowTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 6,
  },
  taskDesc: { flex: 1, fontSize: 13 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  statusText: { fontSize: 11, fontWeight: "600" },

  // 数据链路
  flowRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 2,
    marginTop: 4,
  },
  flowStepWrap: { flexDirection: "row", alignItems: "center" },
  flowStep: { flexDirection: "row", alignItems: "center", gap: 4 },
  flowDot: { width: 8, height: 8, borderRadius: 4 },
  flowLabel: { fontSize: 11 },
  flowArrow: { fontSize: 14, marginHorizontal: 4 },
});

/** 别名导出 */
export const AgentDebugScreen = AiCoreScreen;
