"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

type Strategy = {
  id: string;
  code: string;
  name: string;
  description: string;
  cost: number;
  flow: number;
  stability: number;
  damage: number;
  equity: number;
  category: string;
};

type LoopResult = {
  loop: number;
  evacuation: number;
  variability: number;
  chance90: number;
  damage: number;
  equityGap: number;
  cards: string[];
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode?: "story" | "ooc";
};

type Provider = "openai" | "anthropic" | "gemini" | "compatible";

type LlmConfig = {
  provider: Provider;
  model: string;
  apiKey: string;
  baseUrl: string;
  rememberTab: boolean;
  masterPrompt: string;
  userNotes: string;
  ooc: string;
};

const strategies: Strategy[] = [
  {
    id: "tunnel",
    code: "R-01",
    name: "터널 일방통행",
    description: "C-07 병목 구간의 대피 방향 용량을 크게 늘립니다.",
    cost: 34,
    flow: 18,
    stability: 2,
    damage: -2,
    equity: 1,
    category: "병목 해소",
  },
  {
    id: "signal",
    code: "R-02",
    name: "AI 신호 제어",
    description: "교차로 흐름을 동적으로 조정해 정체 전이를 줄입니다.",
    cost: 22,
    flow: 12,
    stability: 2,
    damage: 0,
    equity: 2,
    category: "흐름 제어",
  },
  {
    id: "power",
    code: "I-03",
    name: "병원 비상전력",
    description: "의료시설 붕괴 위험과 기반 시설 피해를 낮춥니다.",
    cost: 28,
    flow: 4,
    stability: 5,
    damage: 9,
    equity: 3,
    category: "시설 보호",
  },
  {
    id: "bus",
    code: "M-04",
    name: "셔틀버스 증편",
    description: "외곽 인구를 빠르게 이동시키지만 병목에는 취약합니다.",
    cost: 24,
    flow: 10,
    stability: -1,
    damage: 0,
    equity: 4,
    category: "대피 수송",
  },
  {
    id: "shelter",
    code: "S-05",
    name: "임시 대피소",
    description: "남부 지역 이동 거리를 줄여 지역 격차를 완화합니다.",
    cost: 31,
    flow: 7,
    stability: 3,
    damage: 4,
    equity: 10,
    category: "형평성",
  },
  {
    id: "rescue",
    code: "H-06",
    name: "구조 인력 전진배치",
    description: "고립 인구를 구조하고 최악 상황의 손실을 줄입니다.",
    cost: 26,
    flow: 6,
    stability: 5,
    damage: 5,
    equity: 5,
    category: "위험 완화",
  },
];

const defaultConfig: LlmConfig = {
  provider: "openai",
  model: "gpt-5.6-terra",
  apiKey: "",
  baseUrl: "",
  rememberTab: true,
  masterPrompt: `당신은 인터랙티브 재난 스릴러 「재난 5분 전, 옵티마이저」의 게임 마스터다.
플레이어는 도시 재난대응본부의 지휘관이며, AI 옵티마이저만 이전 타임루프의 결과를 기억한다.
플레이어의 감정이나 결정을 대신 서술하지 말고, 선택의 결과와 새롭게 관찰 가능한 정보만 제시한다.
매 응답은 [현장 상황] - [옵티마이저 분석] - [결정이 필요한 것]의 흐름을 유지한다.`,
  userNotes: "",
  ooc: `한국어로 진행한다. 긴장감 있는 근미래 재난 스릴러 톤을 유지한다.
한 번에 3~6문단으로 쓰고, 장면을 끝낼 때 2~4개의 행동 선택지를 제시한다.
설정 충돌이 생기면 최근 유저 노트와 플레이어가 명시한 사실을 우선한다.`,
};

const providerLabels: Record<Provider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  compatible: "OpenAI 호환",
};

const modelPlaceholders: Record<Provider, string> = {
  openai: "예: gpt-5.6-terra",
  anthropic: "Claude 모델 ID를 입력하세요",
  gemini: "Gemini 모델 ID를 입력하세요",
  compatible: "서버에서 제공하는 모델 ID",
};

const initialMessages: ChatMessage[] = [
  {
    id: "intro",
    role: "assistant",
    content:
      "재난대응 AI ‘옵티마이저’입니다. 첫 루프에서는 카드의 비용과 기능만 보고 3장을 선택하세요. 실패는 탈락이 아니라 다음 판단을 위한 데이터입니다.",
  },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function simulate(loop: number, chosen: Strategy[]): LoopResult {
  const flow = chosen.reduce((sum, card) => sum + card.flow, 0);
  const stability = chosen.reduce((sum, card) => sum + card.stability, 0);
  const damageProtection = chosen.reduce((sum, card) => sum + card.damage, 0);
  const equity = chosen.reduce((sum, card) => sum + card.equity, 0);
  const breaksBottleneck = chosen.some((card) =>
    ["tunnel", "signal"].includes(card.id),
  );
  const hasTransportWithoutBottleneck =
    chosen.some((card) => card.id === "bus") && !breaksBottleneck;
  const hasCriticalPair =
    chosen.some((card) => card.id === "tunnel") &&
    chosen.some((card) => card.id === "signal");

  const evacuation = clamp(
    52 +
      flow * 0.7 +
      (breaksBottleneck ? 7 : 0) +
      (hasCriticalPair ? 3 : 0) -
      (hasTransportWithoutBottleneck ? 8 : 0) +
      (loop - 1) * 3.5,
    51,
    98,
  );
  const variability = clamp(
    13.8 - stability * 0.62 - (loop - 1) * 1.25,
    2.4,
    14.5,
  );
  const chance90 = clamp(
    16 + (evacuation - 75) * 3.1 + stability * 2.2,
    3,
    97,
  );
  const damage = clamp(
    94 - damageProtection * 3.2 - (loop - 1) * 4 + (hasCriticalPair ? 3 : 0),
    18,
    96,
  );
  const equityGap = clamp(25 - equity * 1.15 - (loop - 1) * 1.4, 4, 27);

  return {
    loop,
    evacuation: Math.round(evacuation * 10) / 10,
    variability: Math.round(variability * 10) / 10,
    chance90: Math.round(chance90),
    damage: Math.round(damage),
    equityGap: Math.round(equityGap * 10) / 10,
    cards: chosen.map((card) => card.id),
  };
}

function localCoach(
  message: string,
  loop: number,
  selected: Strategy[],
  mode: "story" | "ooc",
) {
  const lower = message.toLowerCase();
  const hasBottleneckCard = selected.some((card) =>
    ["tunnel", "signal"].includes(card.id),
  );

  if (mode === "ooc") {
    return "OOC 지침을 확인했습니다. 이 내용은 등장인물의 대사나 사건으로 출력하지 않고, 다음 장면의 서술 방식과 설정 일관성에만 반영합니다. 외부 LLM을 연결하면 마스터 프롬프트·유저 노트와 함께 전체 프롬프트 스택에 적용됩니다.";
  }
  if (lower.includes("스토리") || lower.includes("이어")) {
    return "[현장 상황]\n관제실의 조명이 붉게 전환된다. 중앙 발전소에서 시작된 전력 불안정이 C-07 터널의 신호망까지 번지고, 벽면 지도 위 대피 흐름이 한 지점에서 가늘어진다.\n\n[옵티마이저 분석]\n“첫 타임루프의 기록과 일치합니다. 수송 자원을 늘리기 전에 병목을 해소하지 않으면 90% 대피선에 도달할 수 없습니다.”\n\n[결정이 필요한 것]\n전략 카드 3장을 선택하거나, 옵티마이저에게 C-07의 최소 절단 근거를 질문하세요.";
  }

  if (lower.includes("추천") || lower.includes("카드")) {
    return hasBottleneckCard
      ? "현재 조합은 C-07 병목에 대응하고 있습니다. 다음 판단에서는 평균 대피율만 보지 말고 변동성과 지역 격차 중 무엇을 더 줄일지 정해 보세요."
      : "셔틀을 늘려도 C-07 터널 용량이 그대로면 전체 유량이 막힐 수 있습니다. 터널 일방통행이나 AI 신호 제어의 비용 대비 효과를 비교해 보세요.";
  }
  if (lower.includes("파레토")) {
    return "파레토 비지배 전략은 다른 전략보다 모든 지표가 동시에 나쁘지 않은 선택입니다. 생존율을 더 높이려면 피해나 형평성을 얼마나 양보해야 하는지 확인하세요.";
  }
  if (lower.includes("병목") || lower.includes("최소 절단")) {
    return "현재 최소 절단 후보는 C-07 중앙 터널, 용량 42입니다. 병목 앞에 버스를 더 투입하는 것보다 간선 용량이나 신호 흐름을 먼저 개선하는 편이 효과적일 수 있습니다.";
  }
  return `Loop ${loop}에서 확인할 질문은 하나입니다. “이 선택이 어떤 지표를, 어떤 대가로 개선하는가?” 선택 근거를 대피율·변동성·피해·지역 격차 중 두 가지로 설명해 보세요.`;
}

export default function MissionControl() {
  const [loop, setLoop] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<LoopResult[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"model" | "story">("model");
  const [chatMode, setChatMode] = useState<"story" | "ooc">("story");
  const [reportOpen, setReportOpen] = useState(false);
  const [llmConfig, setLlmConfig] = useState<LlmConfig>(defaultConfig);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem("optimizer-llm-config");
      if (stored) setLlmConfig({ ...defaultConfig, ...JSON.parse(stored) });
    } catch {
      // A blocked storage API should not block the simulation.
    }
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, sending]);

  const selectedCards = useMemo(
    () => strategies.filter((card) => selected.includes(card.id)),
    [selected],
  );
  const totalCost = selectedCards.reduce((sum, card) => sum + card.cost, 0);
  const latest = results.at(-1);
  const canDeploy = selected.length === 3 && totalCost <= 100;
  const connected = Boolean(llmConfig.apiKey && llmConfig.model);

  const toggleCard = (card: Strategy) => {
    setSelected((current) => {
      if (current.includes(card.id)) {
        return current.filter((id) => id !== card.id);
      }
      if (current.length >= 3) return current;
      return [...current, card.id];
    });
  };

  const runLoop = () => {
    if (!canDeploy) return;
    const result = simulate(loop, selectedCards);
    setResults((current) => [...current, result]);

    const bottleneckNote = selected.some((id) => ["tunnel", "signal"].includes(id))
      ? "C-07 병목 용량이 개선되었습니다."
      : "C-07 병목이 남아 추가 수송 자원의 효과가 제한됐습니다.";
    const report = `Loop ${loop} 완료. 대피율 ${result.evacuation}%, 변동성 ${result.variability}%, 90% 이상 달성 확률 ${result.chance90}%입니다. ${bottleneckNote}`;
    setMessages((current) => [
      ...current,
      { id: `loop-${loop}`, role: "assistant", content: report },
    ]);

    if (loop === 3) {
      setReportOpen(true);
    } else {
      setLoop((current) => current + 1);
    }
  };

  const submitMessage = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
      mode: chatMode,
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft("");

    if (!connected) {
      window.setTimeout(() => {
        setMessages((current) => [
          ...current,
          {
            id: `local-${Date.now()}`,
            role: "assistant",
            content: localCoach(text, loop, selectedCards, chatMode),
          },
        ]);
      }, 320);
      return;
    }

    setSending(true);
    try {
      const response = await fetch("/api/llm", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-optimizer-api-key": llmConfig.apiKey,
        },
        body: JSON.stringify({
          provider: llmConfig.provider,
          model: llmConfig.model,
          baseUrl: llmConfig.baseUrl,
          messages: nextMessages.slice(-10).map(({ role, content }) => ({
            role,
            content,
          })),
          mission: {
            loop,
            selected: selectedCards.map((card) => card.name),
            latest,
          },
          mode: chatMode,
          story: {
            masterPrompt: llmConfig.masterPrompt,
            userNotes: llmConfig.userNotes,
            ooc: llmConfig.ooc,
          },
        }),
      });
      const payload = (await response.json()) as { text?: string; error?: string };
      if (!response.ok || !payload.text) {
        throw new Error(payload.error || "LLM 응답을 받지 못했습니다.");
      }
      setMessages((current) => [
        ...current,
        { id: `ai-${Date.now()}`, role: "assistant", content: payload.text! },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: `외부 모델 연결에 실패했습니다. ${error instanceof Error ? error.message : "설정을 확인해 주세요."} 로컬 분석 모드로 계속 진행할 수 있습니다.`,
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const saveConfig = (config: LlmConfig) => {
    setLlmConfig(config);
    try {
      if (config.rememberTab) {
        window.sessionStorage.setItem(
          "optimizer-llm-config",
          JSON.stringify(config),
        );
      } else {
        window.sessionStorage.removeItem("optimizer-llm-config");
      }
    } catch {
      // The in-memory setting remains active.
    }
    setSettingsOpen(false);
  };

  const resetMission = () => {
    setLoop(1);
    setSelected([]);
    setResults([]);
    setMessages(initialMessages);
    setReportOpen(false);
  };

  return (
    <main className="mission-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            O
          </span>
          <div>
            <p className="eyebrow">INCIDENT RESPONSE / A6</p>
            <h1>재난 5분 전 <span>옵티마이저</span></h1>
          </div>
        </div>

        <div className="phase-track" aria-label={`현재 Loop ${loop}`}>
          {[1, 2, 3].map((step) => (
            <div
              className={`phase ${step < loop || results.some((r) => r.loop === step) ? "complete" : ""} ${step === loop && !results.some((r) => r.loop === step) ? "active" : ""}`}
              key={step}
            >
              <span>{step}</span>
              <small>LOOP {step}</small>
            </div>
          ))}
        </div>

        <button className="connection-button" onClick={() => { setSettingsTab("model"); setSettingsOpen(true); }}>
          <span className={`connection-dot ${connected ? "online" : ""}`} />
          <span>
            <small>{connected ? providerLabels[llmConfig.provider] : "LOCAL AI"}</small>
            {connected ? llmConfig.model : "모델 연결"}
          </span>
          <b aria-hidden="true">⚙</b>
        </button>
      </header>

      <div className="workspace-grid">
        <section className="operation-column" aria-label="작전 보드">
          <section className="briefing-panel">
            <div className="briefing-copy">
              <p className="signal-label"><span /> PRIORITY RED · 중앙 발전소</p>
              <h2>폭발까지 남은 시간</h2>
              <div className="countdown" aria-label="5분 남음">
                05<span>:</span>00
              </div>
              <p>
                예산 <strong>100</strong> 안에서 전략 카드 3장을 선택하세요.
                세 번의 루프 동안 이전 결과를 기억하는 AI와 도시 대피망을 개선합니다.
              </p>
              <div className="briefing-tags">
                <span>2–4인 협력</span>
                <span>3회 타임루프</span>
                <span>목표 대피율 90%</span>
              </div>
            </div>

            <div className="city-map" aria-label="도시 대피 네트워크">
              <div className="map-grid" />
              <div className="road road-a" />
              <div className="road road-b" />
              <div className="road road-c" />
              <div className="road road-d" />
              <div className="road road-e" />
              <button className="map-node power" aria-label="중앙 발전소: 위험">
                <i />
                <span>P-01</span>
                <small>발전소</small>
              </button>
              <button className="map-node tunnel critical" aria-label="C-07 터널: 병목">
                <i />
                <span>C-07</span>
                <small>최소 절단 · 42</small>
              </button>
              <button className="map-node hospital" aria-label="병원">
                <i />
                <span>H-02</span>
                <small>병원</small>
              </button>
              <button className="map-node shelter" aria-label="대피소">
                <i />
                <span>S-09</span>
                <small>대피소</small>
              </button>
              <div className="map-status">
                <span className="pulse" />
                LIVE NETWORK
              </div>
              <div className="map-legend">
                <span><i className="legend-safe" /> 정상</span>
                <span><i className="legend-risk" /> 위험</span>
                <span><i className="legend-bottleneck" /> 병목</span>
              </div>
            </div>
          </section>

          <section className="strategy-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">TACTICAL LOADOUT</p>
                <h2>전략 카드 선택</h2>
                <p>카드 3장을 조합하세요. 선택은 루프 실행 후 변경할 수 있습니다.</p>
              </div>
              <div className={`budget-meter ${totalCost > 100 ? "over" : ""}`}>
                <span>작전 예산</span>
                <strong>{totalCost}<small> / 100</small></strong>
                <div><i style={{ width: `${Math.min(totalCost, 100)}%` }} /></div>
              </div>
            </div>

            <div className="strategy-grid">
              {strategies.map((card) => {
                const isSelected = selected.includes(card.id);
                return (
                  <button
                    className={`strategy-card ${isSelected ? "selected" : ""}`}
                    key={card.id}
                    onClick={() => toggleCard(card)}
                    aria-pressed={isSelected}
                  >
                    <div className="card-topline">
                      <span>{card.code}</span>
                      <b>{card.cost} C</b>
                    </div>
                    <h3>{card.name}</h3>
                    <p>{card.description}</p>
                    <div className="card-footer">
                      <span>{card.category}</span>
                      <i>{isSelected ? "선택됨" : "+ 추가"}</i>
                    </div>
                  </button>
                );
              })}
            </div>

            {latest && (
              <section className="intel-panel" aria-label="최근 시뮬레이션 결과">
                <div className="intel-heading">
                  <div>
                    <p className="eyebrow">UNLOCKED INTELLIGENCE</p>
                    <h3>Loop {latest.loop} 분석 리포트</h3>
                  </div>
                  <span>C-07 최소 절단 확인</span>
                </div>
                <div className="metric-grid">
                  <Metric label="평균 대피율" value={`${latest.evacuation}%`} tone="mint" />
                  <Metric label="변동성" value={`${latest.variability}%`} tone="amber" />
                  <Metric label="90% 이상 확률" value={`${latest.chance90}%`} tone="blue" />
                  <Metric label="예상 피해액" value={`${latest.damage}억`} tone="red" />
                  <Metric label="지역 격차" value={`${latest.equityGap}%p`} tone="violet" />
                </div>
                <div className="analysis-grid">
                  <div className="flow-analysis">
                    <div className="analysis-title">
                      <span>최소 절단 분석</span>
                      <small>용량 42 → {selected.includes("tunnel") ? 68 : selected.includes("signal") ? 56 : 42}</small>
                    </div>
                    <div className="flow-line">
                      <span>주거지</span><i /><b className="danger">C-07</b><i /><span>대피소</span>
                    </div>
                    <p>
                      {selected.some((id) => ["tunnel", "signal"].includes(id))
                        ? "병목 대응 카드가 전체 네트워크 유량을 개선했습니다."
                        : "추가 수송 자원이 병목 앞에 누적되고 있습니다. 간선 용량 개선이 우선입니다."}
                    </p>
                  </div>
                  <div className="pareto-analysis">
                    <div className="analysis-title">
                      <span>파레토 위치</span>
                      <small>{latest.evacuation >= 88 && latest.damage <= 55 ? "비지배 후보" : "지배 가능성"}</small>
                    </div>
                    <div className="pareto-plot" aria-label="생존율과 피해액 파레토 그래프">
                      <i className="dot d1" /><i className="dot d2" /><i className="dot d3" />
                      <i className="dot d4" /><i className="dot current" />
                      <span className="axis-y">생존율 ↑</span>
                      <span className="axis-x">피해액 →</span>
                    </div>
                  </div>
                </div>
              </section>
            )}

            <div className="deploy-bar">
              <div className="slots" aria-label={`${selected.length}개 카드 선택됨`}>
                {[0, 1, 2].map((slot) => {
                  const card = selectedCards[slot];
                  return (
                    <span key={slot} className={card ? "filled" : ""}>
                      <b>{slot + 1}</b>{card?.name ?? "전략 대기"}
                    </span>
                  );
                })}
              </div>
              <button className="deploy-button" disabled={!canDeploy} onClick={runLoop}>
                <span>{loop === 3 ? "최종 전략 확정" : `LOOP ${loop} 실행`}</span>
                <i aria-hidden="true">→</i>
              </button>
            </div>
          </section>
        </section>

        <aside className="advisor-panel" aria-label="AI 옵티마이저 대화">
          <div className="advisor-header">
            <div className="agent-avatar" aria-hidden="true">
              <span>O</span>
            </div>
            <div>
              <p>TACTICAL AI AGENT</p>
              <h2>옵티마이저</h2>
            </div>
            <button
              className="prompt-stack-button"
              onClick={() => { setSettingsTab("story"); setSettingsOpen(true); }}
            >
              PROMPTS
            </button>
            <span className="agent-state"><i /> ONLINE</span>
          </div>

          <div className="objective-card">
            <span>현재 목표</span>
            <strong>{loop === 1 ? "직관적 대응" : loop === 2 ? "데이터 분석과 수정" : "독립적 최적화"}</strong>
            <p>
              {loop === 1
                ? "기능과 비용만 보고 첫 조합을 선택하세요."
                : loop === 2
                  ? "최소 절단과 확률 지표로 카드를 수정하세요."
                  : "AI 추천을 검토하고 가치 우선순위를 결정하세요."}
            </p>
          </div>

          <div className="chat-log" aria-live="polite">
            <div className="system-chip">암호화 채널 · LOOP {loop}</div>
            {messages.map((message) => (
              <div className={`message ${message.role}`} key={message.id}>
                {message.role === "assistant" && <span>OPT</span>}
                <div>
                  <small>{message.role === "assistant" ? "옵티마이저" : message.mode === "ooc" ? "지휘관 · OOC" : "지휘관 · STORY"}</small>
                  <p>{message.content}</p>
                </div>
              </div>
            ))}
            {sending && (
              <div className="message assistant loading-message">
                <span>OPT</span>
                <div><small>옵티마이저</small><p><i /><i /><i /></p></div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="quick-prompts">
            {["현재 병목은?", "카드 조합 추천", "파레토란?"].map((prompt) => (
              <button key={prompt} onClick={() => setDraft(prompt)}>{prompt}</button>
            ))}
          </div>

          <form className="chat-composer" onSubmit={submitMessage}>
            <div className="composer-mode-row">
              <label htmlFor="commander-message">옵티마이저에게 질문</label>
              <span>
                <button type="button" className={chatMode === "story" ? "active" : ""} onClick={() => setChatMode("story")}>STORY</button>
                <button type="button" className={chatMode === "ooc" ? "active" : ""} onClick={() => setChatMode("ooc")}>OOC</button>
              </span>
            </div>
            <div>
              <textarea
                id="commander-message"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submitMessage();
                  }
                }}
                placeholder={chatMode === "ooc" ? "서술 방식이나 설정을 OOC로 지시하세요…" : "행동을 선언하거나 이야기를 이어가세요…"}
                rows={2}
              />
              <button aria-label="메시지 전송" disabled={!draft.trim() || sending}>↗</button>
            </div>
            <p>
              <span className={connected ? "connected" : ""} />
              {connected
                ? `${providerLabels[llmConfig.provider]} · ${llmConfig.model}`
                : "로컬 분석 모드 · 설정에서 외부 LLM 연결 가능"}
            </p>
          </form>
        </aside>
      </div>

      {settingsOpen && (
        <LlmSettings
          config={llmConfig}
          initialTab={settingsTab}
          onClose={() => setSettingsOpen(false)}
          onSave={saveConfig}
        />
      )}

      {reportOpen && latest && (
        <FinalReport
          result={latest}
          first={results[0]}
          cards={selectedCards}
          onClose={() => setReportOpen(false)}
          onReset={resetMission}
        />
      )}
    </main>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function LlmSettings({
  config,
  initialTab,
  onClose,
  onSave,
}: {
  config: LlmConfig;
  initialTab: "model" | "story";
  onClose: () => void;
  onSave: (config: LlmConfig) => void;
}) {
  const [draft, setDraft] = useState(config);
  const [tab, setTab] = useState<"model" | "story">(initialTab);

  const changeProvider = (provider: Provider) => {
    setDraft((current) => ({
      ...current,
      provider,
      model: provider === "openai" ? "gpt-5.6-terra" : "",
      baseUrl: provider === "compatible" ? current.baseUrl : "",
    }));
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="llm-settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">MODEL & NARRATIVE CONTROL</p>
            <h2 id="llm-settings-title">모델 & 스토리 엔진</h2>
          </div>
          <button onClick={onClose} aria-label="설정 닫기">×</button>
        </div>

        <div className="settings-tabs" role="tablist" aria-label="설정 구분">
          <button role="tab" aria-selected={tab === "model"} className={tab === "model" ? "active" : ""} onClick={() => setTab("model")}>모델 연결</button>
          <button role="tab" aria-selected={tab === "story"} className={tab === "story" ? "active" : ""} onClick={() => setTab("story")}>스토리 프롬프트</button>
        </div>

        {tab === "model" ? (
          <>
            <div className="privacy-note">
              <span aria-hidden="true">◇</span>
              <div>
                <strong>키는 프로젝트나 서버에 저장되지 않습니다.</strong>
                <p>요청 순간에만 선택한 공급자로 전달되며, ‘이 탭에서 기억’은 탭을 닫으면 삭제됩니다.</p>
              </div>
            </div>

            <div className="provider-grid">
              {(Object.keys(providerLabels) as Provider[]).map((provider) => (
                <button
                  key={provider}
                  className={draft.provider === provider ? "active" : ""}
                  onClick={() => changeProvider(provider)}
                >
                  <span>{provider === "openai" ? "◎" : provider === "anthropic" ? "A" : provider === "gemini" ? "✦" : "<>"}</span>
                  {providerLabels[provider]}
                </button>
              ))}
            </div>

            <label className="field-label">
              모델 ID
              <input
                value={draft.model}
                onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                placeholder={modelPlaceholders[draft.provider]}
                autoComplete="off"
              />
              <small>목록에 제한되지 않습니다. 공급자가 제공하는 정확한 모델 ID를 입력하세요.</small>
            </label>

            {draft.provider === "compatible" && (
              <label className="field-label">
                API Base URL
                <input
                  value={draft.baseUrl}
                  onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
                  placeholder="https://your-provider.example/v1"
                  inputMode="url"
                  autoComplete="url"
                />
                <small>HTTPS OpenAI 호환 Chat Completions 엔드포인트를 사용합니다.</small>
              </label>
            )}

            <label className="field-label">
              API 키
              <div className="secret-field">
                <input
                  type="password"
                  value={draft.apiKey}
                  onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
                  placeholder="API 키를 붙여넣으세요"
                  autoComplete="off"
                  spellCheck={false}
                />
                <span>{draft.apiKey ? "입력됨" : "필수"}</span>
              </div>
            </label>

            <label className="remember-option">
              <input
                type="checkbox"
                checked={draft.rememberTab}
                onChange={(event) => setDraft({ ...draft, rememberTab: event.target.checked })}
              />
              <span><b>이 탭에서 기억</b><small>브라우저 탭을 닫을 때 자동 삭제</small></span>
            </label>
          </>
        ) : (
          <>
            <div className="prompt-stack-intro">
              <span>MASTER</span><i>→</i><span>USER NOTE</span><i>→</i><span>OOC</span><i>→</i><b>SCENE</b>
            </div>
            <label className="field-label prompt-field">
              <span>마스터 프롬프트 <small>세계관 · GM 역할 · 출력 규칙</small></span>
              <textarea
                value={draft.masterPrompt}
                onChange={(event) => setDraft({ ...draft, masterPrompt: event.target.value })}
                placeholder="게임 마스터의 역할과 세계관의 절대 규칙을 입력하세요."
                rows={8}
                maxLength={10000}
              />
              <small>모든 장면에 가장 먼저 적용되는 기본 지침입니다. {draft.masterPrompt.length.toLocaleString()} / 10,000</small>
            </label>
            <label className="field-label prompt-field">
              <span>유저 노트 <small>캐릭터 · 관계 · 확정 사실 · 장기 기억</small></span>
              <textarea
                value={draft.userNotes}
                onChange={(event) => setDraft({ ...draft, userNotes: event.target.value })}
                placeholder={`예) 지휘관 이름: 한서윤\n플레이어는 H-02 병원장을 신뢰하지 않는다.\nLoop 1에서 터널 관리자의 무전을 들었다.`}
                rows={6}
                maxLength={8000}
              />
              <small>스토리 연속성에 필요한 사실을 기록합니다. {draft.userNotes.length.toLocaleString()} / 8,000</small>
            </label>
            <label className="field-label prompt-field">
              <span>OOC 기본 지침 <small>문체 · 분량 · 진행 방식 · 금지 사항</small></span>
              <textarea
                value={draft.ooc}
                onChange={(event) => setDraft({ ...draft, ooc: event.target.value })}
                placeholder="서사 밖에서 모델이 따라야 할 진행 규칙을 입력하세요."
                rows={6}
                maxLength={4000}
              />
              <small>대화창의 OOC 입력은 이 지침을 보완하며 등장인물 대사로 취급되지 않습니다. {draft.ooc.length.toLocaleString()} / 4,000</small>
            </label>
          </>
        )}

        <div className="modal-actions">
          {tab === "model" ? (
            <button className="secondary" onClick={() => onSave({ ...draft, apiKey: "" })}>
              로컬 모드로 전환
            </button>
          ) : (
            <button className="secondary" onClick={() => setDraft({ ...draft, masterPrompt: defaultConfig.masterPrompt, userNotes: "", ooc: defaultConfig.ooc })}>
              기본값 복원
            </button>
          )}
          <button
            className="primary"
            onClick={() => onSave(draft)}
            disabled={tab === "model" && (!draft.apiKey.trim() || !draft.model.trim() || (draft.provider === "compatible" && !draft.baseUrl.trim()))}
          >
            {tab === "model" ? "연결 설정 저장" : "프롬프트 저장"} <span>→</span>
          </button>
        </div>
      </section>
    </div>
  );
}

function FinalReport({
  result,
  first,
  cards,
  onClose,
  onReset,
}: {
  result: LoopResult;
  first?: LoopResult;
  cards: Strategy[];
  onClose: () => void;
  onReset: () => void;
}) {
  const improved = first ? result.evacuation > first.evacuation : true;
  const success = result.evacuation >= 90 || (result.damage <= 55 && result.chance90 >= 60);
  return (
    <div className="modal-backdrop report-backdrop" role="presentation">
      <section className="final-report" role="dialog" aria-modal="true" aria-labelledby="final-title">
        <button className="report-close" onClick={onClose} aria-label="결과 닫기">×</button>
        <div className={`report-emblem ${success ? "success" : ""}`}><span>{success ? "✓" : "↻"}</span></div>
        <p className="eyebrow">MISSION DEBRIEF / LOOP COMPLETE</p>
        <h2 id="final-title">{success ? "대피 작전 성공" : "전략 재검토 필요"}</h2>
        <p className="report-summary">
          {success
            ? "하나의 절대적 정답 대신, 지표의 상충관계를 설명할 수 있는 전략에 도달했습니다."
            : "평균 성과만이 아니라 실패 위험과 지역 격차를 함께 낮출 여지가 남았습니다."}
        </p>

        <div className="report-score">
          <div><span>평균 대피율</span><strong>{result.evacuation}%</strong></div>
          <div><span>90% 이상 확률</span><strong>{result.chance90}%</strong></div>
          <div><span>피해액</span><strong>{result.damage}억</strong></div>
          <div><span>지역 격차</span><strong>{result.equityGap}%p</strong></div>
        </div>

        <div className="report-details">
          <div>
            <span>최종 전략</span>
            <p>{cards.map((card) => card.name).join(" · ")}</p>
          </div>
          <div>
            <span>성공 조건</span>
            <p>{result.evacuation >= 90 ? "평균 대피율 90% 이상" : "파레토 비지배 후보"} · 예산 준수 · {improved ? "최초 전략보다 개선" : "추가 개선 필요"}</p>
          </div>
        </div>

        <div className="reflection-box">
          <span>한 문장 디브리핑</span>
          <p>평균 대피율이 가장 높은 전략이 항상 최선인가?</p>
        </div>

        <div className="modal-actions">
          <button className="secondary" onClick={onClose}>결과 다시 보기</button>
          <button className="primary" onClick={onReset}>새 작전 시작 <span>↻</span></button>
        </div>
      </section>
    </div>
  );
}
