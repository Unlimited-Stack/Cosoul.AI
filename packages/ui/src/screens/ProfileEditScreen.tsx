/**
 * ProfileEditScreen.tsx — 编辑资料页
 *
 * 字段：昵称、头像、性别、生日、院校、常住地
 * （bio 和 interests 在 Persona Agent 中设置，此处不展示）
 *
 * 编辑交互：
 *   Web: 屏幕正中弹出编辑框（EditModal），滚轮选择性别/生日
 *   Native: 文本字段居中弹窗；性别/生日底部弹出滚轮选择器
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useTheme } from "../theme/ThemeContext";
import { ChevronLeftIcon, ChevronRightIcon, PersonIcon } from "../components/TabIcons";
import { EditModal } from "../components/EditModal";

// ─── 类型 ──────────────────────────────────────────────────────────

export interface UserProfile {
  userId: string;
  email: string;
  phone: string | null;
  name: string | null;
  avatarUrl: string | null;
  gender: string | null;
  birthday: string | null;
  bio: string | null;
  interests: string[];
  school: string | null;
  location: string | null;
  subscriptionTier: string;
  subscriptionExpiresAt: string | null;
  createdAt: string;
}

export interface UserServiceLike {
  getProfile(): Promise<UserProfile>;
  updateProfile(input: Record<string, unknown>): Promise<UserProfile>;
}

export interface ProfileEditScreenProps {
  userService: UserServiceLike;
  onGoBack?: () => void;
}

// ─── 性别常量 ──────────────────────────────────────────────────────

const genderOptions = [
  { key: "male", label: "男" },
  { key: "female", label: "女" },
  { key: "other", label: "其他" },
  { key: "secret", label: "保密" },
];
const genderLabels: Record<string, string> = Object.fromEntries(
  genderOptions.map((o) => [o.key, o.label]),
);

// ─── 日期范围 ──────────────────────────────────────────────────────

const MIN_YEAR = 1920;
const MAX_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: MAX_YEAR - MIN_YEAR + 1 }, (_, i) => MIN_YEAR + i);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

// ─── 滚轮列组件 ───────────────────────────────────────────────────

const ITEM_H = 40;
const VISIBLE = 5;

function WheelColumn({
  items,
  selectedIndex,
  onIndexChange,
}: {
  items: string[];
  selectedIndex: number;
  onIndexChange: (index: number) => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const containerRef = useRef<View>(null);
  const { colors } = useTheme();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idxRef = useRef(selectedIndex);

  // 同步外部 selectedIndex 变化
  useEffect(() => {
    idxRef.current = selectedIndex;
  }, [selectedIndex]);

  // 初始滚动到选中位置
  useEffect(() => {
    const t = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: selectedIndex * ITEM_H, animated: false });
    }, 60);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 滚动到指定索引并触发回调
  const scrollToIndex = useCallback(
    (idx: number, animated = true) => {
      const clamped = Math.max(0, Math.min(idx, items.length - 1));
      scrollRef.current?.scrollTo({ y: clamped * ITEM_H, animated });
      if (clamped !== idxRef.current) {
        idxRef.current = clamped;
        onIndexChange(clamped);
      }
    },
    [items.length, onIndexChange],
  );

  // 点击某项直接跳转
  const handleItemPress = useCallback(
    (i: number) => scrollToIndex(i),
    [scrollToIndex],
  );

  // Native 端滚动结束检测（定时器方式，兼容 Web 和 Native）
  const handleScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number } } }) => {
      const y = e.nativeEvent.contentOffset.y;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const idx = Math.max(0, Math.min(Math.round(y / ITEM_H), items.length - 1));
        if (idx !== idxRef.current) {
          idxRef.current = idx;
          onIndexChange(idx);
        }
      }, 120);
    },
    [items.length, onIndexChange],
  );

  // Web 端鼠标滚轮支持（RNW ref 直接返回 DOM 元素）
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const el = containerRef.current as unknown as HTMLElement;
    if (!el?.addEventListener) return;

    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const direction = e.deltaY > 0 ? 1 : -1;
      scrollToIndex(idxRef.current + direction);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [scrollToIndex]);

  return (
    <View
      ref={containerRef}
      style={{ height: ITEM_H * VISIBLE, flex: 1, overflow: "hidden" }}
    >
      {/* 选中区域高亮带 */}
      <View
        style={{
          position: "absolute",
          top: ITEM_H * Math.floor(VISIBLE / 2),
          left: 4,
          right: 4,
          height: ITEM_H,
          backgroundColor: colors.switcherBorder,
          borderRadius: 6,
        }}
        pointerEvents="none"
      />
      <ScrollView
        ref={scrollRef}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={handleScroll}
        contentContainerStyle={{ paddingVertical: ITEM_H * Math.floor(VISIBLE / 2) }}
      >
        {items.map((label, i) => (
          <TouchableOpacity
            key={`${i}-${label}`}
            onPress={() => handleItemPress(i)}
            activeOpacity={0.7}
            style={{ height: ITEM_H, justifyContent: "center", alignItems: "center" }}
          >
            <Text
              style={{
                fontSize: i === selectedIndex ? 18 : 14,
                fontWeight: i === selectedIndex ? "600" : "400",
                color: i === selectedIndex ? colors.text : colors.subtitle,
              }}
            >
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

// ─── 可点击行组件 ──────────────────────────────────────────────────

function EditRow({
  label,
  hint,
  value,
  onPress,
  children,
}: {
  label: string;
  hint?: string;
  value?: string;
  onPress?: () => void;
  children?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const content = (
    <View style={[styles.row, { borderBottomColor: colors.switcherBorder }]}>
      <View style={styles.rowLeft}>
        <Text style={[styles.rowLabel, { color: colors.text }]}>{label}</Text>
        {hint ? <Text style={[styles.rowHint, { color: colors.subtitle }]}>{hint}</Text> : null}
      </View>
      <View style={styles.rowRight}>
        {children || (
          <Text
            style={[styles.rowValue, { color: value ? colors.subtitle : colors.switcherBorder }]}
            numberOfLines={1}
          >
            {value || "去填写"}
          </Text>
        )}
        <ChevronRightIcon size={16} color={colors.switcherBorder} />
      </View>
    </View>
  );
  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.6}>
        {content}
      </TouchableOpacity>
    );
  }
  return content;
}

// ─── 主组件 ────────────────────────────────────────────────────────

type ModalType = "text" | "gender" | "date";

export function ProfileEditScreen({ userService, onGoBack }: ProfileEditScreenProps) {
  const { colors } = useTheme();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // 弹窗控制
  const [modalType, setModalType] = useState<ModalType | null>(null);
  const [modalField, setModalField] = useState("");
  const [modalTitle, setModalTitle] = useState("");

  // 文本编辑
  const [textValue, setTextValue] = useState("");
  // 性别选择
  const [genderValue, setGenderValue] = useState("");
  // 日期选择
  const [dateYear, setDateYear] = useState(2000);
  const [dateMonth, setDateMonth] = useState(1);
  const [dateDay, setDateDay] = useState(1);

  // ── 数据加载 ──
  const loadProfile = useCallback(async () => {
    try {
      const data = await userService.getProfile();
      setProfile(data);
    } catch (e) {
      console.error("[ProfileEdit] 加载失败:", e);
    } finally {
      setLoading(false);
    }
  }, [userService]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  // ── 字段更新 ──
  const updateField = useCallback(
    async (field: string, value: unknown) => {
      if (!profile) return;
      try {
        const updated = await userService.updateProfile({ [field]: value });
        setProfile(updated);
      } catch (e) {
        console.error("[ProfileEdit] 更新失败:", e);
      }
    },
    [profile, userService],
  );

  // ── 打开弹窗 ──
  const openText = (field: string, title: string, current: string) => {
    setModalType("text");
    setModalField(field);
    setModalTitle(title);
    setTextValue(current);
  };

  const openGender = () => {
    setModalType("gender");
    setModalField("gender");
    setModalTitle("选择性别");
    setGenderValue(profile?.gender || "male");
  };

  const openDate = () => {
    setModalType("date");
    setModalField("birthday");
    setModalTitle("选择生日");
    const parts = (profile?.birthday || "2000-01-01").split("-").map(Number);
    setDateYear(parts[0] || 2000);
    setDateMonth(parts[1] || 1);
    setDateDay(parts[2] || 1);
  };

  // ── 保存 ──
  const handleSave = () => {
    if (!modalType) return;
    let value: unknown;
    switch (modalType) {
      case "text":
        value = textValue;
        break;
      case "gender":
        value = genderValue;
        break;
      case "date":
        value = `${dateYear}-${String(dateMonth).padStart(2, "0")}-${String(effectiveDay).padStart(2, "0")}`;
        break;
    }
    updateField(modalField, value);
    setModalType(null);
  };

  const closeModal = () => setModalType(null);

  // 日期天数计算（月份变化时自动修正天数）
  const daysInMonth = new Date(dateYear, dateMonth, 0).getDate();
  const effectiveDay = Math.min(dateDay, daysInMonth);
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  // ── Loading ──
  if (loading || !profile) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: colors.bg }]}>
        <Text style={{ color: colors.subtitle }}>加载中...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* 顶部导航 */}
        <View style={styles.header}>
          {onGoBack && (
            <TouchableOpacity onPress={onGoBack} style={styles.backBtn} activeOpacity={0.6}>
              <ChevronLeftIcon size={24} color={colors.text} />
            </TouchableOpacity>
          )}
          <Text style={[styles.title, { color: colors.text }]}>编辑资料</Text>
          <View style={{ width: 32 }} />
        </View>

        {/* ── 资料卡片 ── */}
        <View style={[styles.card, { backgroundColor: colors.switcherBg }]}>
          <EditRow
            label="昵称"
            value={profile.name || ""}
            onPress={() => openText("name", "修改昵称", profile.name || "")}
          />

          <EditRow label="头像">
            {profile.avatarUrl ? (
              <Image source={{ uri: profile.avatarUrl }} style={styles.avatarPreview} />
            ) : (
              <View style={[styles.avatarPreview, { backgroundColor: colors.switcherBorder }]}>
                <PersonIcon size={20} color={colors.subtitle} />
              </View>
            )}
          </EditRow>

          <EditRow
            label="性别"
            hint="个性化推荐"
            value={profile.gender ? genderLabels[profile.gender] || profile.gender : ""}
            onPress={openGender}
          />

          <EditRow
            label="生日"
            hint="生日当天送你祝福"
            value={profile.birthday || ""}
            onPress={openDate}
          />

          <EditRow
            label="院校名称"
            hint="发现校友"
            value={profile.school || ""}
            onPress={() => openText("school", "修改院校名称", profile.school || "")}
          />

          <EditRow
            label="常住地"
            hint="发现同乡"
            value={profile.location || ""}
            onPress={() => openText("location", "修改常住地", profile.location || "")}
          />
        </View>

        {/* ── 订阅信息 ── */}
        <Text style={[styles.sectionTitle, { color: colors.subtitle }]}>订阅信息</Text>
        <View style={[styles.card, { backgroundColor: colors.switcherBg }]}>
          <EditRow
            label="订阅等级"
            value={
              profile.subscriptionTier === "premium"
                ? "高级版"
                : profile.subscriptionTier === "pro"
                  ? "中级版"
                  : "免费版"
            }
          />
          {profile.subscriptionExpiresAt && (
            <EditRow
              label="到期时间"
              value={new Date(profile.subscriptionExpiresAt).toLocaleDateString("zh-CN")}
            />
          )}
        </View>
      </ScrollView>

      {/* ═══ 文本编辑弹窗 ═══ */}
      <EditModal
        visible={modalType === "text"}
        title={modalTitle}
        onCancel={closeModal}
        onSave={handleSave}
        saveDisabled={!textValue.trim()}
      >
        <View style={styles.modalBody}>
          <TextInput
            style={[
              styles.textInput,
              { color: colors.text, borderColor: colors.switcherBorder, backgroundColor: colors.bg },
            ]}
            value={textValue}
            onChangeText={setTextValue}
            autoFocus
            placeholder="请输入..."
            placeholderTextColor={colors.switcherBorder}
            returnKeyType="done"
            onSubmitEditing={handleSave}
          />
        </View>
      </EditModal>

      {/* ═══ 性别选择弹窗 ═══ */}
      <EditModal
        visible={modalType === "gender"}
        title={modalTitle}
        onCancel={closeModal}
        onSave={handleSave}
        position="bottom"
      >
        <View style={styles.modalBody}>
          {genderOptions.map((opt) => (
            <TouchableOpacity
              key={opt.key}
              onPress={() => setGenderValue(opt.key)}
              style={[
                styles.optionRow,
                {
                  backgroundColor: genderValue === opt.key ? colors.accent + "20" : "transparent",
                  borderBottomColor: colors.switcherBorder,
                },
              ]}
              activeOpacity={0.6}
            >
              <Text style={{ fontSize: 16, color: colors.text }}>{opt.label}</Text>
              {genderValue === opt.key && (
                <Text style={{ fontSize: 18, color: colors.accent }}>✓</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </EditModal>

      {/* ═══ 生日选择弹窗（滚轮选择器） ═══ */}
      <EditModal
        visible={modalType === "date"}
        title={modalTitle}
        onCancel={closeModal}
        onSave={handleSave}
        position="bottom"
      >
        <View style={styles.wheelContainer}>
          <WheelColumn
            key={`year-${YEARS.length}`}
            items={YEARS.map((y) => `${y}年`)}
            selectedIndex={dateYear - MIN_YEAR}
            onIndexChange={(i) => setDateYear(MIN_YEAR + i)}
          />
          <WheelColumn
            key={`month-${MONTHS.length}`}
            items={MONTHS.map((m) => `${m}月`)}
            selectedIndex={dateMonth - 1}
            onIndexChange={(i) => setDateMonth(i + 1)}
          />
          <WheelColumn
            key={`day-${daysInMonth}`}
            items={days.map((d) => `${d}日`)}
            selectedIndex={effectiveDay - 1}
            onIndexChange={(i) => setDateDay(i + 1)}
          />
        </View>
      </EditModal>
    </View>
  );
}

// ─── 样式 ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  content: { padding: 20, paddingTop: 48 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  backBtn: { padding: 4 },
  title: { fontSize: 18, fontWeight: "600" },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "500",
    letterSpacing: 0.3,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: { borderRadius: 12, overflow: "hidden", marginBottom: 24 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 50,
    borderBottomWidth: 0.5,
  },
  rowLeft: { flexShrink: 1 },
  rowLabel: { fontSize: 16 },
  rowHint: { fontSize: 11, marginTop: 2 },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
    maxWidth: "60%",
  },
  rowValue: { fontSize: 14 },
  avatarPreview: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  // 弹窗内容区
  modalBody: { padding: 16 },
  textInput: {
    fontSize: 16,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  wheelContainer: {
    flexDirection: "row",
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
});
