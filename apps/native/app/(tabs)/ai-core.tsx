/**
 * ai-core.tsx — Native 端「AI 锐评」Tab 页
 * 作为 AiCoreScreen 的平台包装器，负责注入 Expo 专属的图片选择逻辑。
 * 使用 expo-image-picker 调用系统相册选择器，返回 base64 编码的图片。
 */
import { useCallback } from "react";
import * as ImagePicker from "expo-image-picker";
import { AiCoreScreen } from "@repo/ui";

// API 代理地址——开发时指向本地 Next.js 服务（端口 7878），部署时需改为实际域名
const API_BASE_URL = "http://localhost:7878/api/critique";

export default function AiCoreTab() {
  /**
   * Native 端图片选择器：
   * 请求相册权限 → 打开系统相册 → 选择图片（质量 0.7，含 base64）→
   * 返回 data URI 格式的 base64 字符串
   */
  const onPickImage = useCallback(async (): Promise<string | null> => {
    // 请求相册访问权限
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return null;

    // 打开系统相册，仅允许选择图片，输出 base64 编码
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,   // 压缩质量（0~1）
      base64: true,    // 同时返回 base64 编码
      exif: false,     // 不需要 EXIF 元数据
    });

    if (result.canceled || !result.assets[0]?.base64) return null;
    // 拼接为 data URI 格式，供 Image 组件和 API 直接使用
    return `data:image/jpeg;base64,${result.assets[0].base64}`;
  }, []);

  return <AiCoreScreen onPickImage={onPickImage} apiBaseUrl={API_BASE_URL} />;
}
