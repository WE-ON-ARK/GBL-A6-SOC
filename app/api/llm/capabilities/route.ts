import { NextResponse } from "next/server";

type Provider = "openai" | "anthropic" | "gemini" | "compatible";
type ModelOption = { id: string; label: string; temperature: boolean; reasoning: boolean; maxTemperature: number; maxOutputTokens: number | null };

const curatedModels: Record<Exclude<Provider, "gemini">, ModelOption[]> = {
  openai: [
    { id: "gpt-5.2", label: "GPT-5.2", temperature: false, reasoning: false, maxTemperature: 2, maxOutputTokens: null },
    { id: "gpt-5.1", label: "GPT-5.1", temperature: false, reasoning: false, maxTemperature: 2, maxOutputTokens: null },
    { id: "gpt-4.1", label: "GPT-4.1", temperature: true, reasoning: false, maxTemperature: 2, maxOutputTokens: 32768 },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini", temperature: true, reasoning: false, maxTemperature: 2, maxOutputTokens: 32768 },
  ],
  anthropic: [
    { id: "claude-sonnet-5", label: "Claude Sonnet 5", temperature: false, reasoning: false, maxTemperature: 1, maxOutputTokens: 128000 },
    { id: "claude-opus-4-6", label: "Claude Opus 4.6", temperature: false, reasoning: false, maxTemperature: 1, maxOutputTokens: 128000 },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", temperature: false, reasoning: false, maxTemperature: 1, maxOutputTokens: 128000 },
    { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", temperature: true, reasoning: true, maxTemperature: 1, maxOutputTokens: 64000 },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", temperature: true, reasoning: true, maxTemperature: 1, maxOutputTokens: 64000 },
  ],
  compatible: [],
};

function openAiCapabilities(id: string): ModelOption {
  const lower = id.toLowerCase();
  const supportsTemperature = !/^(o\d|gpt-5)/.test(lower);
  return { id, label: id, temperature: supportsTemperature, reasoning: false, maxTemperature: 2, maxOutputTokens: null };
}

export async function POST(request: Request) {
  const apiKey = request.headers.get("x-optimizer-api-key")?.trim();
  if (!apiKey) return NextResponse.json({ error: "API 키가 없습니다." }, { status: 401 });
  const body = await request.json().catch(() => null) as { provider?: Provider; baseUrl?: string } | null;
  const provider = body?.provider;
  if (!provider || !["openai", "anthropic", "gemini", "compatible"].includes(provider)) {
    return NextResponse.json({ error: "공급자를 확인해 주세요." }, { status: 400 });
  }

  try {
    if (provider === "gemini") {
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", { headers: { "x-goog-api-key": apiKey }, cache: "no-store" });
      const data = await response.json() as { models?: Array<{ name?: string; displayName?: string; supportedGenerationMethods?: string[]; thinking?: boolean; maxTemperature?: number; outputTokenLimit?: number }>; error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message || `Gemini 키 검증 실패 (${response.status})`);
      const models = (data.models ?? []).filter((model) => model.name && model.supportedGenerationMethods?.includes("generateContent")).map((model) => {
        const id = model.name!.replace(/^models\//, "");
        const generation = Number(id.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] || 0);
        const temperature = typeof model.maxTemperature === "number" && generation < 3.5;
        return { id, label: model.displayName || id, temperature, reasoning: temperature && model.thinking === true, maxTemperature: model.maxTemperature ?? 1, maxOutputTokens: model.outputTokenLimit ?? null };
      });
      return NextResponse.json({ verified: true, models, source: "Gemini API" });
    }

    if (provider === "openai") {
      const response = await fetch("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${apiKey}` }, cache: "no-store" });
      const data = await response.json() as { data?: Array<{ id?: string }>; error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message || `OpenAI 키 검증 실패 (${response.status})`);
      const available = new Set((data.data ?? []).map((model) => model.id));
      const curated = curatedModels.openai.filter((model) => available.has(model.id));
      const models = curated.length ? curated : [...available]
        .filter((id): id is string => Boolean(id) && /^(gpt-|o\d)/.test(id!) && !/(audio|realtime|transcribe|tts|image|search|moderation)/.test(id!))
        .sort()
        .slice(0, 40)
        .map(openAiCapabilities);
      return NextResponse.json({ verified: true, models, source: "OpenAI API" });
    }

    if (provider === "anthropic") {
      const response = await fetch("https://api.anthropic.com/v1/models?limit=1000", { headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, cache: "no-store" });
      const data = await response.json() as { data?: Array<{ id?: string; display_name?: string }>; error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message || `Anthropic 키 검증 실패 (${response.status})`);
      const available = new Map((data.data ?? []).map((model) => [model.id, model.display_name]));
      const curated = curatedModels.anthropic.filter((model) => available.has(model.id));
      const models = curated.length ? curated : (data.data ?? []).filter((model) => model.id).map((model) => ({ id: model.id!, label: model.display_name || model.id!, temperature: false, reasoning: false, maxTemperature: 1, maxOutputTokens: null }));
      return NextResponse.json({ verified: true, models, source: "Anthropic API" });
    }

    const baseUrl = body?.baseUrl?.replace(/\/+$/, "") || "";
    if (!baseUrl.startsWith("https://")) return NextResponse.json({ error: "HTTPS API Base URL을 입력해 주세요." }, { status: 400 });
    const response = await fetch(`${baseUrl}/models`, { headers: { authorization: `Bearer ${apiKey}` }, cache: "no-store" });
    const data = await response.json() as { data?: Array<{ id?: string }>; error?: { message?: string } };
    if (!response.ok) throw new Error(data.error?.message || `호환 API 키 검증 실패 (${response.status})`);
    const models = (data.data ?? []).filter((model) => model.id).map((model) => ({ id: model.id!, label: model.id!, temperature: true, reasoning: false, maxTemperature: 2, maxOutputTokens: null }));
    return NextResponse.json({ verified: true, models, source: "호환 API" });
  } catch (error) {
    return NextResponse.json({ verified: false, error: error instanceof Error ? error.message.slice(0, 240) : "API 키를 검증하지 못했습니다." }, { status: 502 });
  }
}
