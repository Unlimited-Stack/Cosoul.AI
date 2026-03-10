/**
 * 共享 CORS headers — 允许 Expo Web (8089) 和真机访问 Next.js API (3030)
 */
import { NextResponse } from "next/server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/** 给 NextResponse 注入 CORS headers */
export function withCors(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

/** OPTIONS 预检请求响应 */
export function corsOptions(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
