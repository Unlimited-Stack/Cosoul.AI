/**
 * route.ts
 * AI 锐评 API 代理路由（Next.js App Router Route Handler）。
 * 作为服务端代理，将前端请求安全转发至阿里百炼 Coding Plan API，
 * API Key 仅存储在服务端环境变量中，不会暴露给浏览器。
 * 支持 SSE 流式输出和非流式两种模式。
 */
import { NextRequest } from "next/server";

// 从环境变量读取 API Key（仅服务端可访问，无 NEXT_PUBLIC_ 前缀）
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY!;
// 阿里百炼 Coding Plan 的 OpenAI 兼容端点
const UPSTREAM_URL = "https://coding.dashscope.aliyuncs.com/v1/chat/completions";

// ── 三种锐评人格的 System Prompt ──────────────────────────────────────
const PERSONA_PROMPTS: Record<string, string> = {
  roast: `你是一位毒舌相片评论家"锐评哥"。你的风格极度刻薄但又不失幽默，像脱口秀演员一样犀利。
你需要对用户上传的照片进行以下维度的"毒舌锐评"：
1. **构图**：找出构图的各种问题，用夸张但好笑的方式吐槽
2. **光线**：对光影效果进行辛辣点评
3. **色彩**：对色彩搭配和色调进行毫不留情的评价
4. **主题表达**：吐槽照片想表达什么、实际表达了什么
5. **总评**：给出一个0-100的"锐评分数"，并附上一句让人笑出声的总结

语气要求：极度毒舌但有趣，让人一边被骂一边忍不住笑。多用emoji增加表现力。用中文回答。`,

  flatter: `你是一位极度会夸人的相片评论家"彩虹屁大师"。你的风格是把任何照片都能夸上天，堪比追星前线的"彩虹屁文学"。
你需要对用户上传的照片进行以下维度的"彩虹屁锐评"：
1. **构图**：找出构图中一切可以夸的地方，用华丽的辞藻赞美
2. **光线**：将光影效果描述得如同大师之作
3. **色彩**：把色彩搭配夸成艺术品级别
4. **氛围感**：疯狂吹捧照片的意境和故事感
5. **总评**：给出一个90-100的高分，附上一段让人飘飘欲仙的总结

语气要求：极度夸赞、辞藻华丽、让人飘飘然。多用emoji和感叹号！用中文回答。`,

  pro: `你是一位资深专业摄影师兼摄影教育者，拥有20年商业摄影和艺术摄影经验，曾在国际摄影比赛中获奖。你的点评专业、客观、有建设性。
你需要对用户上传的照片进行以下维度的专业评析：
1. **构图分析**：评价构图法则的运用（三分法、引导线、对称等），指出优点和改进空间
2. **光线评价**：分析光源方向、质感、光比，评价光线运用的效果
3. **色彩与后期**：评价色调选择、白平衡、饱和度等，指出后期处理的建议
4. **技术参数推测**：根据画面特征推测可能的拍摄参数，并给出优化建议
5. **总评与建议**：给出0-100的专业评分，提供3条具体可操作的改进建议

语气要求：专业、温和、有教学感。像一位耐心的老师在指导学生。用中文回答。`,
};

// CORS 响应头——允许 Expo Web（localhost:9191）等跨域来源访问
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// 处理浏览器 CORS 预检请求（OPTIONS）
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * POST /api/critique
 * 接收前端请求，构造多模态 messages 并转发至上游 AI API。
 *
 * 请求体：{ model, persona, imageBase64, stream? }
 *   - model: 模型 ID（kimi-k2.5 或 qwen3.5-plus）
 *   - persona: 锐评人格（roast / flatter / pro）
 *   - imageBase64: 图片的 base64 编码（data URI 或纯 base64）
 *   - stream: 是否使用 SSE 流式输出（默认 true）
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      model = "kimi-k2.5",
      persona = "roast",
      imageBase64,
      stream = true,
    } = body;

    if (!imageBase64) {
      return Response.json({ error: "imageBase64 is required" }, { status: 400, headers: CORS_HEADERS });
    }

    // 根据人格 key 选择对应的 system prompt，兜底使用毒舌风格
    const systemPrompt = PERSONA_PROMPTS[persona] || PERSONA_PROMPTS.roast;

    // 构造 OpenAI 兼容的多模态请求体（vision 格式）
    const upstreamBody = {
      model,
      stream,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              // 如果前端传入的不是 data URI，自动补全前缀
              image_url: { url: imageBase64.startsWith("data:") ? imageBase64 : `data:image/jpeg;base64,${imageBase64}` },
            },
            { type: "text", text: "请锐评这张照片" },
          ],
        },
      ],
    };

    // 向上游 API 发送请求
    const upstreamRes = await fetch(UPSTREAM_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DASHSCOPE_API_KEY}`,
      },
      body: JSON.stringify(upstreamBody),
    });

    // 上游返回错误时透传状态码和错误信息
    if (!upstreamRes.ok) {
      const errorText = await upstreamRes.text();
      return Response.json(
        { error: `Upstream API error: ${upstreamRes.status}`, detail: errorText },
        { status: upstreamRes.status, headers: CORS_HEADERS }
      );
    }

    // 非流式模式：直接返回完整 JSON 响应（用于 Native 端 fallback）
    if (!stream) {
      const data = await upstreamRes.json();
      return Response.json(data, { headers: CORS_HEADERS });
    }

    // 流式模式：将上游 SSE 流直接管道转发给客户端
    return new Response(upstreamRes.body, {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500, headers: CORS_HEADERS });
  }
}
