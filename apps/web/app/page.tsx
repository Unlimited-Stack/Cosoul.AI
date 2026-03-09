/**
 * page.tsx — 根路径重定向
 * 访问 "/" 时自动跳转到默认页面（首页），
 * 因为实际导航由左侧 Sidebar 控制。
 */
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/feed");
}
