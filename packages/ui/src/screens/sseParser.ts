/**
 * sseParser.ts
 * SSE（Server-Sent Events）流式响应解析器。
 * 用于将 OpenAI 兼容 API 返回的 SSE 流逐块解析为文本增量。
 *
 * SSE 数据格式示例：
 *   data: {"choices":[{"delta":{"content":"你好"}}]}
 *   data: [DONE]
 *
 * 使用方式：
 *   const reader = response.body.getReader();
 *   for await (const chunk of parseSSEStream(reader)) {
 *     // chunk 即为每次增量的文本片段
 *   }
 */
export async function* parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  // 缓冲区：处理跨 chunk 的不完整行
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    // 将二进制 chunk 解码为文本并追加到缓冲区
    buffer += decoder.decode(value, { stream: true });
    // 按换行符分割，最后一个元素可能是不完整的行，保留在缓冲区
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      // SSE 规范：以 "data: " 开头的行包含实际数据
      if (trimmed.startsWith("data: ")) {
        const data = trimmed.slice(6);
        // "[DONE]" 标记流结束
        if (data === "[DONE]") return;
        try {
          // 解析 JSON 并提取增量文本内容
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch {
          // 跳过格式异常的 JSON 块
        }
      }
    }
  }
}
