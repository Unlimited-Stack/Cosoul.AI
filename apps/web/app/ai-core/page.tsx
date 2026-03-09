/**
 * page.tsx — Web 端「AI 锐评」页面
 * 作为 AiCoreScreen 的平台包装器，负责注入 Web 专属的图片选择逻辑。
 * 通过隐藏 <input type="file"> + Canvas 实现图片选择与压缩。
 */
"use client";

import { useCallback } from "react";
import { AiCoreScreen } from "@repo/ui";

/**
 * 将图片 dataUrl 通过 Canvas 缩放压缩。
 * @param dataUrl  原始 base64 data URI
 * @param maxSize  最大边长（像素），超过此值按比例缩放
 * @returns 压缩后的 JPEG data URI（质量 0.8）
 */
function compressImage(dataUrl: string, maxSize: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => {
      let { width, height } = img;
      // 超过最大边长时等比缩放
      if (width > maxSize || height > maxSize) {
        const ratio = Math.min(maxSize / width, maxSize / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      // 使用 Canvas 绘制缩放后的图片并导出为 JPEG
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.src = dataUrl;
  });
}

export default function AiCorePage() {
  /**
   * Web 端图片选择器：
   * 动态创建隐藏的 file input → 用户选择文件 → FileReader 读取 →
   * Canvas 压缩至最大 1200px → 返回 base64 data URI
   */
  const onPickImage = useCallback((): Promise<string | null> => {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = async () => {
          const dataUrl = reader.result as string;
          const compressed = await compressImage(dataUrl, 1200);
          resolve(compressed);
        };
        reader.readAsDataURL(file);
      };
      input.click();
    });
  }, []);

  // apiBaseUrl 使用同源相对路径，请求自动走 Next.js API Route
  return <AiCoreScreen onPickImage={onPickImage} apiBaseUrl="/api/critique" />;
}
