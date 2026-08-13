import { NextResponse } from "next/server";

type Provider = "openai" | "anthropic" | "gemini" | "compatible";

export async function POST(request: Request) {
  const apiKey = request.headers.get("x-optimizer-api-key")?.trim();
  if (!apiKey) return NextResponse.json({ error: "API 키가 없습니다." }, { status: 401 });

  const body = await request.json().catch(() => null) as { provider?: Provider; model?: string } | null;
  const provider = body?.provider;
  const model = body?.model?.trim() ?? "";
  if (!provider || !["openai", "anthropic", "gemini", "compatible"].includes(provider) || !model) {
    return NextResponse.json({ error: "공급자와 모델 ID를 확인해 주세요." }, { status: 400 });
  }

  if (provider === "gemini") {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`, {
        headers: { "x-goog-api-key": apiKey },
        cache: "no-store",
      });
      const data = await response.json() as { thinking?: boolean; maxTemperature?: number; outputTokenLimit?: number; error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message || `모델 조회 실패 (${response.status})`);
      const generation = Number(model.toLowerCase().match(/gemini-(\d+(?:\.\d+)?)/)?.[1] || 0);
      return NextResponse.json({
        temperature: typeof data.maxTemperature === "number" && generation < 3.5,
        reasoning: data.thinking === true,
        maxTemperature: typeof data.maxTemperature === "number" ? data.maxTemperature : 1,
        maxOutputTokens: typeof data.outputTokenLimit === "number" ? data.outputTokenLimit : null,
        source: "Gemini 모델 메타데이터",
      });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message.slice(0, 240) : "모델 정보를 불러오지 못했습니다." }, { status: 502 });
    }
  }

  const id = model.toLowerCase();
  if (provider === "openai") {
    const reasoning = /^(o\d|gpt-5)/.test(id);
    return NextResponse.json({ temperature: !reasoning, reasoning, maxTemperature: 2, maxOutputTokens: null, source: "OpenAI 모델 계열 규칙" });
  }
  if (provider === "anthropic") {
    const current = /(?:opus|sonnet)-(?:4-[789]|5)|(?:fable|mythos)-5/.test(id);
    return NextResponse.json({ temperature: !current, reasoning: /claude-(?:opus|sonnet|haiku|fable|mythos)-(?:4|5)/.test(id), maxTemperature: 1, maxOutputTokens: null, source: "Claude 모델 계열 규칙" });
  }
  return NextResponse.json({ temperature: true, reasoning: false, maxTemperature: 2, maxOutputTokens: null, source: "호환 API 기본 기능" });
}
