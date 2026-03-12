/**
 * (tabs)/_layout.tsx
 * Tab 导航布局 + 长按 Agent Tab 弹出人格气泡浮层 + 操作选择 + 灵动对话框
 *
 * 职责：
 *   1. 将默认底部栏替换为 LiquidTabBar（液态玻璃风格）
 *   2. 声明五个 Tab 页面
 *   3. 长按 Agent Tab → 显示 PersonaBubbleOverlay（人格气泡弧形浮层）
 *   4. 选择已有人格 → 显示 PersonaActionSheet（操作选择浮层）
 *   5. 选择操作 → 跳转到对应页面（如 agent-task-chat）
 *   6. 选择"新增" → 底部弹出 SoulChatSheet（灵动对话框）
 */
import { useCallback, useState } from "react";
import { View, StyleSheet } from "react-native";
import { Tabs, useRouter } from "expo-router";
import {
  LiquidTabBar,
  PersonaBubbleOverlay,
  PersonaActionSheet,
  SoulChatSheet,
  type LiquidTabBarProps,
  type BubblePersona,
} from "@repo/ui";
import { createPersonaServiceForPlatform } from "@repo/core/persona";
import { getPersonaPlatformConfig } from "../../lib/getApiUrl";

export default function TabLayout() {
  const router = useRouter();

  // ── 气泡浮层状态 ──
  const [showBubbles, setShowBubbles] = useState(false);
  const [personas, setPersonas] = useState<BubblePersona[]>([]);

  // ── 操作选择浮层状态 ──
  const [showActions, setShowActions] = useState(false);
  const [selectedPersona, setSelectedPersona] = useState<BubblePersona | null>(null);

  // ── 灵动对话框状态 ──
  const [showSoulChat, setShowSoulChat] = useState(false);
  const [creatingPersona, setCreatingPersona] = useState(false);

  // ── 点击「创建人格」→ 调用已有的 POST /api/personas（与 AgentScreen 对齐） ──
  const handleCreatePersona = useCallback(async (conversationTurns: string[]) => {
    setCreatingPersona(true);
    try {
      const config = getPersonaPlatformConfig();
      const baseUrl = config.proxyBaseUrl ?? "/api";

      // 从对话中提取人格信息（与 AgentScreen createPersona 参数对齐）
      const userTurns = conversationTurns
        .filter((t) => t.startsWith("用户："))
        .map((t) => t.replace("用户：", "").trim());
      const firstMsg = userTurns[0] ?? "新人格";
      const name = firstMsg.length > 20 ? firstMsg.slice(0, 20) + "…" : firstMsg;
      const bio = userTurns.join("\n");

      // 直接走已有的人格创建接口
      const res = await fetch(`${baseUrl}/personas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, bio, coreIdentity: bio, preferences: "" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      console.log("[SoulChat] 人格创建成功:", data);
      // 创建成功 → 关闭对话框
      setShowSoulChat(false);
    } catch (err) {
      console.warn("[SoulChat] 创建人格失败:", err);
    } finally {
      setCreatingPersona(false);
    }
  }, []);

  // ── 长按 Agent Tab 时加载人格列表并弹出浮层 ──
  const handleTabLongPress = useCallback(async (routeName: string) => {
    if (routeName !== "agent") return;
    try {
      const service = createPersonaServiceForPlatform(getPersonaPlatformConfig());
      const list = await service.listPersonas();
      setPersonas(list.map((p) => ({ personaId: p.personaId, name: p.name })));
    } catch {
      setPersonas([]);
    }
    setShowBubbles(true);
  }, []);

  // ── 选择已有人格 → 弹出操作选择浮层 ──
  const handleSelectPersona = useCallback((personaId: string) => {
    setShowBubbles(false);
    const p = personas.find((x) => x.personaId === personaId);
    if (p) {
      setSelectedPersona(p);
      setShowActions(true);
    }
  }, [personas]);

  // ── 选择操作 → 跳转到对应页面 ──
  const handleSelectAction = useCallback((personaId: string, actionKey: string) => {
    setShowActions(false);
    setSelectedPersona(null);
    if (actionKey === "add_task") {
      const persona = personas.find((x) => x.personaId === personaId);
      router.push({
        pathname: "/agent-task-chat",
        params: {
          personaId,
          personaName: persona?.name ?? "未知",
          actionKey,
        },
      });
    }
    // 其他 actionKey 后续扩展
  }, [router, personas]);

  // ── 选择"新增" → 弹出底部灵动对话框 ──
  const handleAddNew = useCallback(() => {
    setShowBubbles(false);
    setShowSoulChat(true);
  }, []);

  // ── 关闭回调 ──
  const handleClose = useCallback(() => setShowBubbles(false), []);
  const handleCloseActions = useCallback(() => {
    setShowActions(false);
    setSelectedPersona(null);
  }, []);
  const handleCloseSoulChat = useCallback(() => setShowSoulChat(false), []);

  return (
    <View style={styles.root}>
      <Tabs
        tabBar={(props) => (
          <LiquidTabBar
            {...(props as unknown as LiquidTabBarProps)}
            onTabLongPress={handleTabLongPress}
          />
        )}
        screenOptions={{ headerShown: false }}
      >
        <Tabs.Screen name="home" options={{ title: "首页" }} />
        <Tabs.Screen name="discover" options={{ title: "发现" }} />
        <Tabs.Screen name="agent" options={{ title: "Agent" }} />
        <Tabs.Screen name="messages" options={{ title: "消息" }} />
        <Tabs.Screen name="profile" options={{ title: "我的" }} />
      </Tabs>

      {/* 人格气泡浮层 — 以 Agent Tab 为圆心弧形展开 */}
      <PersonaBubbleOverlay
        visible={showBubbles}
        personas={personas}
        onSelectPersona={handleSelectPersona}
        onAddNew={handleAddNew}
        onClose={handleClose}
      />

      {/* 操作选择浮层 — 选择人格后展示可执行操作 */}
      <PersonaActionSheet
        visible={showActions}
        persona={selectedPersona}
        onSelectAction={handleSelectAction}
        onClose={handleCloseActions}
      />

      {/* 灵动对话框 — 底部弹出式对话创建人格 */}
      <SoulChatSheet
        visible={showSoulChat}
        onClose={handleCloseSoulChat}
        onCreatePersona={handleCreatePersona}
        creating={creatingPersona}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
