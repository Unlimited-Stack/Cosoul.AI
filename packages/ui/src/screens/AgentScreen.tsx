/**
 * AgentScreen.tsx
 * Agent 主页面 — 人格 Agent 管理 + 任务 Agent 管理
 *
 * 架构：
 *   本组件不直接请求后端，PersonaService 由上层 App 注入：
 *   - Web   注入 createWebPersonaService()   → fetch /api/personas (Next.js BFF)
 *   - Native 注入 createNativePersonaService() → 直连后端
 */
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useTheme } from "../theme/ThemeContext";
import { WrenchIcon } from "../components/TabIcons";

// ─── 领域类型 ─────────────────────────────────────────────────────

export interface Persona {
  personaId: string;
  name: string;
  bio?: string;
}

export interface AgentTask {
  taskId: string;
  rawDescription: string;
  status: string;
  targetActivity?: string;
  interactionType: string;
}

/** 创建人格 Agent 的入参 — 对应 personas + persona_profiles 两张表 */
export interface CreatePersonaInput {
  name: string;                 // → personas.name
  bio: string;                  // → personas.bio
  coreIdentity: string;         // → persona_profiles.profileText 的 Core Identity 段
  preferences: string;          // → persona_profiles.profileText 的 Preferences 段
}

/** 创建任务 Agent 的入参 — 对应 tasks 表 */
export interface CreateTaskInput {
  rawDescription: string;               // → tasks.raw_description
  interactionType: "online" | "offline" | "any"; // → tasks.interaction_type
}

/** PersonaService 接口 — 上层 App 注入，屏蔽 Web/Native 差异 */
export interface PersonaService {
  listPersonas(): Promise<Persona[]>;
  createPersona(input: CreatePersonaInput): Promise<Persona>;
  listTasks(personaId: string): Promise<AgentTask[]>;
  createTask(personaId: string, input: CreateTaskInput): Promise<AgentTask>;
}

export interface AgentScreenProps {
  /** 点击扳手图标时的回调 */
  onNavigateDebug: () => void;
  /** 注入的人格服务（Web/Native 实现不同） */
  personaService: PersonaService;
}

// ─── 交互类型选项 ─────────────────────────────────────────────────

const INTERACTION_TYPES: { value: CreateTaskInput["interactionType"]; label: string }[] = [
  { value: "any",     label: "不限" },
  { value: "online",  label: "线上" },
  { value: "offline", label: "线下" },
];

// ─── 主组件 ────────────────────────────────────────────────────────

export function AgentScreen({ onNavigateDebug, personaService }: AgentScreenProps) {
  const { colors, isDark } = useTheme();

  // 人格列表
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loadingPersonas, setLoadingPersonas] = useState(true);

  // 每个人格的任务列表 { personaId: tasks[] }
  const [taskMap, setTaskMap] = useState<Record<string, AgentTask[]>>({});

  // 展开的人格（显示任务列表）
  const [expandedPersona, setExpandedPersona] = useState<string | null>(null);

  // 创建人格表单的展开状态
  const [showCreatePersona, setShowCreatePersona] = useState(false);
  const [creatingPersona, setCreatingPersona] = useState(false);
  const [personaForm, setPersonaForm] = useState<CreatePersonaInput>({
    name: "",
    bio: "",
    coreIdentity: "",
    preferences: "",
  });

  // 每个人格的创建任务表单展开状态
  const [showCreateTaskFor, setShowCreateTaskFor] = useState<string | null>(null);
  const [creatingTask, setCreatingTask] = useState(false);
  const [taskForm, setTaskForm] = useState<CreateTaskInput>({
    rawDescription: "",
    interactionType: "any",
  });

  // ── 加载人格列表 ──────────────────────────────────────────────
  const loadPersonas = useCallback(async () => {
    setLoadingPersonas(true);
    try {
      const list = await personaService.listPersonas();
      setPersonas(list);
    } finally {
      setLoadingPersonas(false);
    }
  }, [personaService]);

  useEffect(() => { loadPersonas(); }, [loadPersonas]);

  // ── 展开人格时加载其任务 ──────────────────────────────────────
  const handleTogglePersona = useCallback(async (personaId: string) => {
    if (expandedPersona === personaId) {
      setExpandedPersona(null);
      return;
    }
    setExpandedPersona(personaId);
    if (!taskMap[personaId]) {
      const tasks = await personaService.listTasks(personaId);
      setTaskMap((prev) => ({ ...prev, [personaId]: tasks }));
    }
  }, [expandedPersona, taskMap, personaService]);

  // ── 创建人格 Agent ────────────────────────────────────────────
  const handleCreatePersona = useCallback(async () => {
    if (!personaForm.name.trim()) return;
    setCreatingPersona(true);
    try {
      const created = await personaService.createPersona(personaForm);
      setPersonas((prev) => [...prev, created]);
      setPersonaForm({ name: "", bio: "", coreIdentity: "", preferences: "" });
      setShowCreatePersona(false);
    } finally {
      setCreatingPersona(false);
    }
  }, [personaForm, personaService]);

  // ── 创建任务 Agent ────────────────────────────────────────────
  const handleCreateTask = useCallback(async (personaId: string) => {
    if (!taskForm.rawDescription.trim()) return;
    setCreatingTask(true);
    try {
      const created = await personaService.createTask(personaId, taskForm);
      setTaskMap((prev) => ({
        ...prev,
        [personaId]: [...(prev[personaId] ?? []), created],
      }));
      setTaskForm({ rawDescription: "", interactionType: "any" });
      setShowCreateTaskFor(null);
    } finally {
      setCreatingTask(false);
    }
  }, [taskForm, personaService]);

  // ── 样式动态值 ────────────────────────────────────────────────
  const cardBg = isDark ? "rgba(120,120,128,0.16)" : "rgba(142,142,147,0.08)";
  const inputBg = isDark ? "rgba(120,120,128,0.20)" : "rgba(142,142,147,0.10)";
  const dividerColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
  const accentBg = isDark ? "rgba(255,55,95,0.15)" : "rgba(255,45,85,0.10)";

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>

      {/* ── 标题栏 ── */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.text }]}>Agent</Text>
            <Text style={[styles.subtitle, { color: colors.subtitle }]}>
              AI Agent 智能匹配与社交协作
            </Text>
          </View>
          <TouchableOpacity
            onPress={onNavigateDebug}
            style={[styles.debugBtn, { backgroundColor: cardBg }]}
            activeOpacity={0.6}
          >
            <WrenchIcon size={20} color={colors.subtitle} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >

        {/* ══ 人格 Agent 区块 ══ */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>我的人格 Agent</Text>
          <Text style={[styles.sectionHint, { color: colors.subtitle }]}>
            每个人格拥有独立的 Soul.md 和 Memory
          </Text>
        </View>

        {/* 加载中 */}
        {loadingPersonas && (
          <View style={styles.centerRow}>
            <ActivityIndicator size="small" color={colors.subtitle} />
            <Text style={[styles.hintText, { color: colors.subtitle }]}>加载人格列表...</Text>
          </View>
        )}

        {/* 人格卡片列表 */}
        {personas.map((persona) => {
          const isExpanded = expandedPersona === persona.personaId;
          const tasks = taskMap[persona.personaId] ?? [];
          const showTaskForm = showCreateTaskFor === persona.personaId;

          return (
            <View
              key={persona.personaId}
              style={[styles.personaCard, { backgroundColor: cardBg, borderColor: dividerColor }]}
            >
              {/* 人格头部 — 点击展开/收起 */}
              <TouchableOpacity
                style={styles.personaCardHead}
                onPress={() => handleTogglePersona(persona.personaId)}
                activeOpacity={0.7}
              >
                <View style={[styles.personaAvatar, { backgroundColor: accentBg }]}>
                  <Text style={styles.personaAvatarText}>
                    {persona.name.slice(0, 1).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.personaName, { color: colors.text }]}>{persona.name}</Text>
                  {persona.bio ? (
                    <Text style={[styles.personaBio, { color: colors.subtitle }]} numberOfLines={1}>
                      {persona.bio}
                    </Text>
                  ) : null}
                </View>
                <Text style={[styles.chevron, { color: colors.subtitle }]}>
                  {isExpanded ? "▲" : "▼"}
                </Text>
              </TouchableOpacity>

              {/* 任务列表（展开后显示） */}
              {isExpanded && (
                <View style={[styles.taskSection, { borderTopColor: dividerColor }]}>
                  <Text style={[styles.taskSectionLabel, { color: colors.subtitle }]}>
                    任务 Agent
                  </Text>

                  {tasks.length === 0 && (
                    <Text style={[styles.hintText, { color: colors.subtitle }]}>
                      暂无任务，点击下方按钮创建
                    </Text>
                  )}

                  {tasks.map((task) => (
                    <View
                      key={task.taskId}
                      style={[styles.taskCard, { backgroundColor: inputBg, borderColor: dividerColor }]}
                    >
                      <View style={styles.taskCardTop}>
                        <Text style={[styles.taskDesc, { color: colors.text }]} numberOfLines={2}>
                          {task.rawDescription}
                        </Text>
                        <View style={[styles.statusBadge, { backgroundColor: statusColor(task.status, isDark) + "22" }]}>
                          <Text style={[styles.statusText, { color: statusColor(task.status, isDark) }]}>
                            {task.status}
                          </Text>
                        </View>
                      </View>
                      <Text style={[styles.taskMeta, { color: colors.subtitle }]}>
                        互动方式：{task.interactionType === "any" ? "不限" : task.interactionType === "online" ? "线上" : "线下"}
                      </Text>
                    </View>
                  ))}

                  {/* 添加任务表单 */}
                  {showTaskForm ? (
                    <View style={[styles.formBox, { backgroundColor: inputBg, borderColor: dividerColor }]}>
                      <Text style={[styles.formLabel, { color: colors.subtitle }]}>任务描述</Text>
                      <TextInput
                        style={[styles.textArea, { color: colors.text, backgroundColor: cardBg, borderColor: dividerColor }]}
                        placeholder="例：找人周末去小众餐厅探店，聊聊美食和生活"
                        placeholderTextColor={colors.subtitle}
                        value={taskForm.rawDescription}
                        onChangeText={(v) => setTaskForm((f) => ({ ...f, rawDescription: v }))}
                        multiline
                        numberOfLines={3}
                      />

                      <Text style={[styles.formLabel, { color: colors.subtitle, marginTop: 12 }]}>互动方式</Text>
                      <View style={styles.segmentRow}>
                        {INTERACTION_TYPES.map((opt) => (
                          <TouchableOpacity
                            key={opt.value}
                            style={[
                              styles.segmentBtn,
                              { borderColor: dividerColor, backgroundColor: cardBg },
                              taskForm.interactionType === opt.value && { backgroundColor: colors.accent, borderColor: colors.accent },
                            ]}
                            onPress={() => setTaskForm((f) => ({ ...f, interactionType: opt.value }))}
                          >
                            <Text style={[
                              styles.segmentText,
                              { color: colors.subtitle },
                              taskForm.interactionType === opt.value && { color: "#fff", fontWeight: "700" },
                            ]}>
                              {opt.label}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>

                      <View style={styles.formActions}>
                        <TouchableOpacity
                          style={[styles.cancelBtn, { borderColor: dividerColor }]}
                          onPress={() => { setShowCreateTaskFor(null); setTaskForm({ rawDescription: "", interactionType: "any" }); }}
                        >
                          <Text style={[styles.cancelText, { color: colors.subtitle }]}>取消</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.submitBtn, { backgroundColor: colors.accent }, (!taskForm.rawDescription.trim() || creatingTask) && styles.disabledBtn]}
                          onPress={() => handleCreateTask(persona.personaId)}
                          disabled={!taskForm.rawDescription.trim() || creatingTask}
                        >
                          {creatingTask
                            ? <ActivityIndicator size="small" color="#fff" />
                            : <Text style={styles.submitText}>派发任务</Text>
                          }
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={[styles.addTaskBtn, { borderColor: colors.accent + "50" }]}
                      onPress={() => { setShowCreateTaskFor(persona.personaId); setShowCreatePersona(false); }}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.addBtnText, { color: colors.accent }]}>+ 添加任务 Agent</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          );
        })}

        {/* ── 添加人格 Agent 表单 / 按钮 ── */}
        {showCreatePersona ? (
          <View style={[styles.createPersonaForm, { backgroundColor: cardBg, borderColor: dividerColor }]}>
            <Text style={[styles.formTitle, { color: colors.text }]}>新建人格 Agent</Text>
            <Text style={[styles.formHint, { color: colors.subtitle }]}>
              填写后将写入 personas 表 + persona_profiles（Soul.md 结构）
            </Text>

            {/* 基础信息 */}
            <Text style={[styles.formLabel, { color: colors.subtitle }]}>人格名称 *</Text>
            <TextInput
              style={[styles.input, { color: colors.text, backgroundColor: inputBg, borderColor: dividerColor }]}
              placeholder="例：探店达人 / 技术宅 / 运动爱好者"
              placeholderTextColor={colors.subtitle}
              value={personaForm.name}
              onChangeText={(v) => setPersonaForm((f) => ({ ...f, name: v }))}
            />

            <Text style={[styles.formLabel, { color: colors.subtitle }]}>一句话简介</Text>
            <TextInput
              style={[styles.input, { color: colors.text, backgroundColor: inputBg, borderColor: dividerColor }]}
              placeholder="例：喜欢在小众地方发现惊喜"
              placeholderTextColor={colors.subtitle}
              value={personaForm.bio}
              onChangeText={(v) => setPersonaForm((f) => ({ ...f, bio: v }))}
            />

            {/* Soul.md — Core Identity 段 */}
            <Text style={[styles.formLabel, { color: colors.subtitle }]}>核心身份 · Core Identity</Text>
            <Text style={[styles.formHint, { color: colors.subtitle }]}>
              兴趣标签、背景、你是谁 → 写入 Soul.md Core Identity 段
            </Text>
            <TextInput
              style={[styles.textArea, { color: colors.text, backgroundColor: inputBg, borderColor: dividerColor }]}
              placeholder={"例：25岁产品经理，热爱探店和美食摄影\n标签：#美食 #小众 #独立咖啡馆 #街拍"}
              placeholderTextColor={colors.subtitle}
              value={personaForm.coreIdentity}
              onChangeText={(v) => setPersonaForm((f) => ({ ...f, coreIdentity: v }))}
              multiline
              numberOfLines={4}
            />

            {/* Soul.md — Preferences 段 */}
            <Text style={[styles.formLabel, { color: colors.subtitle }]}>匹配偏好 · Preferences</Text>
            <Text style={[styles.formHint, { color: colors.subtitle }]}>
              你喜欢什么样的人、Deal Breakers → 写入 Soul.md Preferences 段
            </Text>
            <TextInput
              style={[styles.textArea, { color: colors.text, backgroundColor: inputBg, borderColor: dividerColor }]}
              placeholder={"例：偏好同龄人，话题能聊美食/创意/生活方式\nDeal Breakers：过度推销、只谈工作"}
              placeholderTextColor={colors.subtitle}
              value={personaForm.preferences}
              onChangeText={(v) => setPersonaForm((f) => ({ ...f, preferences: v }))}
              multiline
              numberOfLines={4}
            />

            <View style={styles.formActions}>
              <TouchableOpacity
                style={[styles.cancelBtn, { borderColor: dividerColor }]}
                onPress={() => { setShowCreatePersona(false); setPersonaForm({ name: "", bio: "", coreIdentity: "", preferences: "" }); }}
              >
                <Text style={[styles.cancelText, { color: colors.subtitle }]}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.submitBtn, { backgroundColor: colors.accent }, (!personaForm.name.trim() || creatingPersona) && styles.disabledBtn]}
                onPress={handleCreatePersona}
                disabled={!personaForm.name.trim() || creatingPersona}
              >
                {creatingPersona
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.submitText}>创建人格</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.addPersonaBtn, { borderColor: colors.accent, backgroundColor: accentBg }]}
            onPress={() => { setShowCreatePersona(true); setExpandedPersona(null); }}
            activeOpacity={0.7}
          >
            <Text style={[styles.addPersonaBtnText, { color: colors.accent }]}>+ 添加人格 Agent</Text>
            <Text style={[styles.addPersonaBtnHint, { color: colors.accent + "99" }]}>
              创建新的分身，拥有独立 Soul.md 和 Memory
            </Text>
          </TouchableOpacity>
        )}

      </ScrollView>
    </View>
  );
}

// ─── 工具函数 ──────────────────────────────────────────────────────

function statusColor(status: string, isDark: boolean): string {
  switch (status) {
    case "Drafting":      return isDark ? "#64D2FF" : "#007AFF";
    case "Matching":      return isDark ? "#FFD60A" : "#FF9500";
    case "Waiting_Human": return isDark ? "#FF9F0A" : "#FF6B00";
    case "Done":          return isDark ? "#30D158" : "#34C759";
    case "Cancelled":     return isDark ? "#FF453A" : "#FF3B30";
    default:              return isDark ? "#9e9ea3" : "#666";
  }
}

// ─── 样式 ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingTop: 48, paddingHorizontal: 20, paddingBottom: 8 },
  headerRow: { flexDirection: "row", alignItems: "center" },
  title: { fontSize: 24, fontWeight: "bold", marginBottom: 4 },
  subtitle: { fontSize: 14 },
  debugBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", marginLeft: 12 },

  scrollArea: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 120 },

  sectionHeader: { marginBottom: 12 },
  sectionTitle: { fontSize: 17, fontWeight: "700" },
  sectionHint: { fontSize: 12, marginTop: 2 },

  centerRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 24, gap: 8 },
  hintText: { fontSize: 13 },

  // 人格卡片
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
    gap: 12,
  },
  personaAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  personaAvatarText: { fontSize: 18, fontWeight: "700", color: "#FF375F" },
  personaName: { fontSize: 16, fontWeight: "600" },
  personaBio: { fontSize: 13, marginTop: 2 },
  chevron: { fontSize: 11, marginLeft: 4 },

  // 任务区
  taskSection: { borderTopWidth: 0.5, padding: 14, paddingTop: 10 },
  taskSectionLabel: { fontSize: 12, fontWeight: "600", letterSpacing: 0.4, marginBottom: 8, textTransform: "uppercase" },

  taskCard: {
    borderRadius: 10,
    borderWidth: 0.5,
    padding: 12,
    marginBottom: 8,
  },
  taskCardTop: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 4 },
  taskDesc: { flex: 1, fontSize: 14 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  statusText: { fontSize: 11, fontWeight: "600" },
  taskMeta: { fontSize: 12 },

  addTaskBtn: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
    marginTop: 4,
  },
  addBtnText: { fontSize: 14, fontWeight: "600" },

  // 创建人格表单
  createPersonaForm: {
    borderRadius: 14,
    borderWidth: 0.5,
    padding: 16,
    marginBottom: 12,
  },
  formTitle: { fontSize: 17, fontWeight: "700", marginBottom: 4 },
  formHint: { fontSize: 12, marginBottom: 12, lineHeight: 17 },
  formLabel: { fontSize: 13, fontWeight: "600", marginBottom: 6, marginTop: 4 },

  input: {
    borderRadius: 10,
    borderWidth: 0.5,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 12,
  },
  textArea: {
    borderRadius: 10,
    borderWidth: 0.5,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 12,
    minHeight: 90,
    textAlignVertical: "top",
  },

  // 任务表单
  formBox: {
    borderRadius: 10,
    borderWidth: 0.5,
    padding: 12,
    marginTop: 4,
  },
  segmentRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
  },
  segmentText: { fontSize: 14 },

  // 按钮
  formActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
  },
  cancelText: { fontSize: 15, fontWeight: "600" },
  submitBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  submitText: { fontSize: 15, fontWeight: "700", color: "#fff" },
  disabledBtn: { opacity: 0.45 },

  // 添加人格按钮
  addPersonaBtn: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderRadius: 14,
    padding: 18,
    alignItems: "center",
    marginTop: 4,
  },
  addPersonaBtnText: { fontSize: 16, fontWeight: "700", marginBottom: 4 },
  addPersonaBtnHint: { fontSize: 12 },
});
