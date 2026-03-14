// Theme
export { ThemeProvider, useTheme, type ThemeMode, type ThemeColors } from "./theme/ThemeContext";

// Components
export { Button, type ButtonProps } from "./button";
export { TabIcon, type TabIconProps } from "./components/TabIcon";
export { LiquidTabBar, type LiquidTabBarProps } from "./components/LiquidTabBar";
export { ThemeToggleButton } from "./components/ThemeToggleButton";
export { PersonaBubbleOverlay, type PersonaBubbleOverlayProps, type BubblePersona } from "./components/PersonaBubbleOverlay";
export { SoulChatSheet, type SoulChatSheetProps } from "./components/SoulChatSheet";
export { PersonaActionSheet, type PersonaActionSheetProps, type PersonaActionItem } from "./components/PersonaActionSheet";
export { PullRefreshScrollView, type PullRefreshScrollViewProps } from "./components/PullRefreshScrollView";
export {
  MessageIcon, CommunityIcon, PlusCircleIcon, CompassIcon, PersonIcon,
  SettingsIcon, ChevronLeftIcon, ChevronRightIcon, PaletteIcon, SidebarToggleIcon,
  SunIcon, MoonIcon, WrenchIcon, ShieldIcon, EditIcon,
} from "./components/TabIcons";

// Screens
export { MessageScreen } from "./screens/MessageScreen";
export { FeedScreen } from "./screens/FeedScreen";
export { AiCoreScreen, AgentDebugScreen, type AiCoreScreenProps, type AgentDebugScreenProps, type LlmServiceLike, type DebugPersonaInfo } from "./screens/AiCoreScreen";
export {
  AgentScreen,
  type AgentScreenProps,
  type PersonaService,
  type Persona,
  type AgentTask,
  type CreatePersonaInput,
  type CreateTaskInput,
} from "./screens/AgentScreen";
export { CardsScreen } from "./screens/CardsScreen";
export { ProfileScreen, type ProfileScreenProps } from "./screens/ProfileScreen";
export { SettingsScreen, type SettingsScreenProps } from "./screens/SettingsScreen";
export { ProfileEditScreen, type ProfileEditScreenProps } from "./screens/ProfileEditScreen";
export { AccountSecurityScreen, type AccountSecurityScreenProps } from "./screens/AccountSecurityScreen";
export { TaskChatScreen, type TaskChatScreenProps, type TaskServiceLike } from "./screens/TaskChatScreen";

// Auth
export { AuthProvider, useAuth, type AuthContextValue, type AuthProviderProps, type AuthUser, type TokenStorage } from "./auth/AuthContext";
export { LoginScreen, type LoginScreenProps } from "./screens/LoginScreen";
export { RegisterScreen, type RegisterScreenProps } from "./screens/RegisterScreen";
export { ForgotPasswordScreen, type ForgotPasswordScreenProps } from "./screens/ForgotPasswordScreen";
