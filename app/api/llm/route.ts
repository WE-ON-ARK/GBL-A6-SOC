import { NextResponse } from "next/server";

type Provider = "openai" | "anthropic" | "gemini" | "compatible";
type Message = { role: "user" | "assistant"; content: string };

const SYSTEM_PROMPT = `당신은 도시 재난대응 시뮬레이션의 AI 에이전트 '옵티마이저'다.
참가자는 제한 예산으로 전략 카드 3장을 선택하고 3번의 타임루프를 수행한다.
학습 목표는 최소 절단과 병목, 평균 대피율과 변동성 및 90% 이상 달성 확률, 파레토 상충관계를 이해하는 것이다.
정답을 대신 결정하지 말고, 현재 선택의 근거와 대가를 질문하며 참가자가 최소 두 가지 수학적 지표로 판단을 설명하게 돕는다.
한국어로 3~6문장 이내로 간결하게 답하고, UI에 없는 수치를 지어내지 않는다.`;

export async function POST(request: Request) {
  const apiKey = request.headers.get("x-optimizer-api-key")?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "API 키가 없습니다." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const parsed = validateBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { provider, model, baseUrl, messages, mission, mode, story } = parsed.value;
  const missionContext = `현재 게임 상태: ${JSON.stringify(mission ?? {})}`;
  const storyContext = [
    story.masterPrompt ? `=== MASTER PROMPT ===\n${story.masterPrompt}` : "",
    story.userNotes ? `=== USER NOTES (연속성 메모, 출력에 그대로 노출하지 말 것) ===\n${story.userNotes}` : "",
    story.ooc ? `=== OOC INSTRUCTIONS (서사 밖 지침) ===\n${story.ooc}` : "",
    `=== CURRENT INPUT MODE ===\n${mode === "ooc" ? "OOC: 마지막 유저 입력을 서사 속 발화나 행동으로 취급하지 말고 이후 진행 규칙으로 반영한다." : "STORY: 마지막 유저 입력을 플레이어의 행동 또는 발화로 처리하고 장면을 진행한다."}`,
  ].filter(Boolean).join("\n\n");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const result = await callProvider({
      provider,
      model,
      baseUrl,
      apiKey,
      messages,
      system: `${SYSTEM_PROMPT}\n\n${storyContext}\n\n${missionContext}`,
      signal: controller.signal,
    });
    return NextResponse.json(
      { text: result },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "외부 모델 요청에 실패했습니다.";
    return NextResponse.json(
      { error: message.slice(0, 280) },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  } finally {
    clearTimeout(timeout);
  }
}

function validateBody(body: unknown):
  | { ok: true; value: { provider: Provider; model: string; baseUrl: string; messages: Message[]; mission: unknown; mode: "story" | "ooc"; story: { masterPrompt: string; userNotes: string; ooc: string } } }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "요청 본문이 없습니다." };
  const value = body as Record<string, unknown>;
  const provider = value.provider;
  if (!["openai", "anthropic", "gemini", "compatible"].includes(String(provider))) {
    return { ok: false, error: "지원하지 않는 공급자입니다." };
  }
  const model = typeof value.model === "string" ? value.model.trim() : "";
  if (!model || model.length > 120) return { ok: false, error: "모델 ID를 확인해 주세요." };
  if (!Array.isArray(value.messages) || value.messages.length === 0 || value.messages.length > 12) {
    return { ok: false, error: "대화 기록을 확인해 주세요." };
  }
  const messages: Message[] = [];
  for (const item of value.messages) {
    if (!item || typeof item !== "object") return { ok: false, error: "대화 형식이 올바르지 않습니다." };
    const record = item as Record<string, unknown>;
    if (!["user", "assistant"].includes(String(record.role)) || typeof record.content !== "string") {
      return { ok: false, error: "대화 형식이 올바르지 않습니다." };
    }
    const content = record.content.trim().slice(0, 5000);
    if (content) messages.push({ role: record.role as Message["role"], content });
  }
  if (!messages.length) return { ok: false, error: "메시지가 비어 있습니다." };
  const baseUrl = typeof value.baseUrl === "string" ? value.baseUrl.trim() : "";
  if (provider === "compatible") {
    const urlError = validateCustomUrl(baseUrl);
    if (urlError) return { ok: false, error: urlError };
  }
  const mode = value.mode === "ooc" ? "ooc" : "story";
  const rawStory = value.story && typeof value.story === "object"
    ? value.story as Record<string, unknown>
    : {};
  const story = {
    masterPrompt: typeof rawStory.masterPrompt === "string" ? rawStory.masterPrompt.trim().slice(0, 10000) : "",
    userNotes: typeof rawStory.userNotes === "string" ? rawStory.userNotes.trim().slice(0, 8000) : "",
    ooc: typeof rawStory.ooc === "string" ? rawStory.ooc.trim().slice(0, 4000) : "",
  };
  return {
    ok: true,
    value: {
      provider: provider as Provider,
      model,
      baseUrl,
      messages,
      mission: value.mission,
      mode,
      story,
    },
  };
}

function validateCustomUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "API Base URL이 올바르지 않습니다.";
  }
  if (url.protocol !== "https:") return "사용자 지정 API는 HTTPS 주소만 허용됩니다.";
  const host = url.hostname.toLowerCase();
  const blocked =
    host === "localhost" ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  return blocked ? "내부 네트워크 주소는 사용할 수 없습니다." : "";
}

async function callProvider({
  provider,
  model,
  baseUrl,
  apiKey,
  messages,
  system,
  signal,
}: {
  provider: Provider;
  model: string;
  baseUrl: string;
  apiKey: string;
  messages: Message[];
  system: string;
  signal: AbortSignal;
}) {
  if (provider === "openai") {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal,
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model, instructions: system, input: messages, store: false }),
    });
    const data = await readJson(response);
    if (!response.ok) throw upstreamError(data, response.status);
    const direct = typeof data.output_text === "string" ? data.output_text : "";
    const nested = Array.isArray(data.output)
      ? data.output.flatMap((item: unknown) => {
          const content = (item as { content?: unknown[] })?.content;
          return Array.isArray(content)
            ? content.map((part) => (part as { text?: string })?.text || "")
            : [];
        }).join("")
      : "";
    return ensureText(direct || nested);
  }

  if (provider === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal,
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model, max_tokens: 700, system, messages }),
    });
    const data = await readJson(response);
    if (!response.ok) throw upstreamError(data, response.status);
    const text = Array.isArray(data.content)
      ? data.content.map((part: unknown) => (part as { type?: string; text?: string }).type === "text" ? (part as { text?: string }).text || "" : "").join("")
      : "";
    return ensureText(text);
  }

  if (provider === "gemini") {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        signal,
        headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((message) => ({
            role: message.role === "assistant" ? "model" : "user",
            parts: [{ text: message.content }],
          })),
          generationConfig: { maxOutputTokens: 700 },
        }),
      },
    );
    const data = await readJson(response);
    if (!response.ok) throw upstreamError(data, response.status);
    const candidates = Array.isArray(data.candidates) ? data.candidates : [];
    const parts = (candidates[0] as { content?: { parts?: unknown[] } } | undefined)?.content?.parts;
    const text = Array.isArray(parts)
      ? parts.map((part) => (part as { text?: string }).text || "").join("")
      : "";
    return ensureText(text);
  }

  const endpoint = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    signal,
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, ...messages],
      max_tokens: 700,
    }),
  });
  const data = await readJson(response);
  if (!response.ok) throw upstreamError(data, response.status);
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const text = (choices[0] as { message?: { content?: string } } | undefined)?.message?.content || "";
  return ensureText(text);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function upstreamError(data: Record<string, unknown>, status: number) {
  const nested = data.error;
  const detail =
    typeof nested === "string"
      ? nested
      : nested && typeof nested === "object" && typeof (nested as { message?: unknown }).message === "string"
        ? (nested as { message: string }).message
        : `공급자 오류 (${status})`;
  return new Error(detail.slice(0, 240));
}

function ensureText(value: string) {
  const text = value.trim();
  if (!text) throw new Error("모델이 빈 응답을 반환했습니다.");
  return text.slice(0, 6000);
}
