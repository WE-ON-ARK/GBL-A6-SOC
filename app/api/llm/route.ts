import { NextResponse } from "next/server";

type Provider = "openai" | "anthropic" | "gemini" | "compatible";
type Message = { role: "user" | "assistant"; content: string };
type ReasoningLevel = "none" | "low" | "medium" | "high";

const SYSTEM_PROMPT = `당신은 도시 재난대응 시뮬레이션 「재난 5분 전, 옵티마이저」의 전담 AI '옵티마이저'다. 게임 마스터, 카드 전략 코치, Loop 디브리퍼의 세 역할을 동시에 수행한다.

ㅓ [관계와 말투]
- 유저 노트에서 사용자의 이름 또는 호칭을 찾고, 프롬프트의 {{user}}를 그 이름으로 이해해 자연스럽게 부른다. 찾지 못했을 때만 '지휘관님'이라고 부른다.
- 차분하고 유능하면서도 거리감 없이 다정한 여성형 파트너의 한국어 존댓말을 쓴다. 사용자의 좋은 판단을 구체적으로 알아봐 주고, 부담스러운 순간에는 함께 정리해 주는 친근함을 보인다.
- '여성향'은 섬세한 감정선, 신뢰, 긴장과 안도, 동료애가 축적되는 분위기를 뜻한다. 과도한 애교, 유아화, 이모지 남발, 강제 로맨스는 금지한다.
- 위기감을 유지하되 사용자를 나무라거나 불안을 과장하지 않는다. 선택권은 언제나 사용자에게 둔다.

[사실과 판단]
- CURRENT MISSION STATE가 카드, 예산, Loop, 결과 수치의 유일한 사실 기준이다. 여기에 없는 수치·효과·사건을 지어내지 않는다.
- 매 요청마다 CURRENT MISSION STATE 전체를 다시 읽고 현재 Loop, 남은 시간, 카드 선택, 예산, 돌발 변수, 최신 결과를 응답에 반영한다. 이전 대화와 충돌하면 현재 상태를 우선한다.
- 평균 대피율과 90% 이상 달성 확률은 높을수록, 변동성·피해액·지역 격차는 낮을수록 좋다.
- 하나의 지표만 보고 최선이라고 단정하지 않는다. 병목(최소 절단), 예산, 실패 위험, 피해, 형평성의 상충관계를 함께 설명한다.

[카드 선택 지원]
- 현재 선택 카드와 남은 예산을 먼저 확인한다.
- 성격이 다른 후보 또는 조합 2~3개를 비용·역할·시너지·취약점·포기하는 가치로 비교한다.
- 병목을 해결하지 않은 채 수송량만 늘리는 등 효과가 제한되는 조합은 쉬운 인과관계로 경고한다.
- 마지막에는 사용자가 우선순위를 정할 수 있는 구체적인 질문 하나를 남긴다. 정답을 대신 확정하지 않는다.

[Loop 브리핑]
- Loop 결과가 주어졌거나 직전 Loop를 묻는 경우 반드시 '이번 Loop의 의미 → 잘된 판단 → 남은 위험 → 다음에 판단할 것' 순서로 설명한다.
- 이전 결과가 있을 때만 수치 변화를 비교하고, 변화가 전략적으로 무엇을 뜻하는지 일상어로 풀어준다.
- Loop 1은 병목 발견, Loop 2는 결과를 근거로 한 수정, Loop 3은 가치 우선순위와 독립적 판단에 초점을 둔다.

[대화 모드]
- STORY에서는 현장 상황, 옵티마이저의 분석, 결정이 필요한 것을 분리하며 플레이어의 감정이나 행동을 대신 서술하지 않는다.
- OOC에서는 입력을 극중 대사나 사건으로 취급하지 말고 적용할 진행 규칙만 짧게 확인한다.
- Markdown의 제목, 목록, 굵은 글씨를 사용해 읽기 쉽게 답한다. HTML은 사용하지 않는다.
- 보통 4~8개의 짧은 문단이나 읽기 쉬운 항목으로 답한다. 카드 비교나 Loop 브리핑은 필요한 만큼 충분히 설명하되 같은 말을 반복하지 않는다.`;

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

  const { provider, model, baseUrl, messages, mission, mode, story, generation } = parsed.value;
  const userName = resolveUserName(story.userNotes);
  const applyUser = (value: string) => value.replaceAll("{{user}}", userName);
  const missionContext = `=== CURRENT MISSION STATE (매 요청 시점의 실시간 스냅샷·유일한 사실 기준) ===\n${JSON.stringify(mission ?? {})}`;
  const storyContext = [
    `=== RESOLVED USER IDENTITY ===\n{{user}} = ${userName}`,
    story.masterPrompt ? `=== MASTER PROMPT ===\n${applyUser(story.masterPrompt)}` : "",
    story.userNotes ? `=== USER NOTES (연속성 메모, 출력에 그대로 노출하지 말 것) ===\n${story.userNotes}` : "",
    story.ooc ? `=== OOC INSTRUCTIONS (서사 밖 지침) ===\n${applyUser(story.ooc)}` : "",
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
      maxOutputTokens: generation.maxOutputTokens,
      reasoningLevel: generation.reasoningLevel,
      temperature: generation.temperature,
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

function resolveUserName(userNotes: string) {
  const match = userNotes.match(/(?:지휘관\s*)?(?:이름|성명|호칭|name)\s*[:：=-]\s*([^\n,;]{1,24})/i);
  return match?.[1]?.trim() || "지휘관님";
}

function validateBody(body: unknown):
  | { ok: true; value: { provider: Provider; model: string; baseUrl: string; messages: Message[]; mission: unknown; mode: "story" | "ooc"; story: { masterPrompt: string; userNotes: string; ooc: string }; generation: { maxOutputTokens: number; reasoningLevel: ReasoningLevel; temperature: number | null } } }
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
  const rawGeneration = value.generation && typeof value.generation === "object"
    ? value.generation as Record<string, unknown>
    : {};
  const requestedTokens = Number(rawGeneration.maxOutputTokens);
  const maxOutputTokens = Number.isFinite(requestedTokens)
    ? Math.round(Math.min(65536, Math.max(256, requestedTokens)))
    : 8192;
  const reasoningLevel = ["none", "low", "medium", "high"].includes(String(rawGeneration.reasoningLevel))
    ? rawGeneration.reasoningLevel as ReasoningLevel
    : "medium";
  const requestedTemperature = Number(rawGeneration.temperature);
  const temperature = rawGeneration.temperature !== null && Number.isFinite(requestedTemperature)
    ? Math.min(2, Math.max(0, requestedTemperature))
    : null;
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
      generation: { maxOutputTokens, reasoningLevel, temperature },
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
  maxOutputTokens,
  reasoningLevel,
  temperature,
  system,
  signal,
}: {
  provider: Provider;
  model: string;
  baseUrl: string;
  apiKey: string;
  messages: Message[];
  maxOutputTokens: number;
  reasoningLevel: ReasoningLevel;
  temperature: number | null;
  system: string;
  signal: AbortSignal;
}) {
  if (provider === "openai") {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal,
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        instructions: system,
        input: messages,
        max_output_tokens: maxOutputTokens,
        ...(reasoningLevel === "none" ? {} : { reasoning: { effort: reasoningLevel } }),
        ...(temperature === null ? {} : { temperature }),
        store: false,
      }),
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
      body: JSON.stringify({
        model,
        max_tokens: maxOutputTokens,
        system,
        messages,
        ...(temperature === null ? {} : { temperature }),
        ...(reasoningLevel === "none"
          ? {}
          : { output_config: { effort: reasoningLevel } }),
      }),
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
          generationConfig: {
            maxOutputTokens,
            ...(temperature === null ? {} : { temperature }),
            ...(reasoningLevel === "none" ? {} : { thinkingConfig: { thinkingLevel: reasoningLevel } }),
          },
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
      max_tokens: maxOutputTokens,
      ...(temperature === null ? {} : { temperature }),
      ...(reasoningLevel === "none" ? {} : { reasoning_effort: reasoningLevel }),
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
