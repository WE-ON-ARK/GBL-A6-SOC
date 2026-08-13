"use client";

import {
  useEffect,
  useLayoutEffect,
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
  bottleneckCapacity: number;
  paretoOptimal: boolean;
  dominatedBy: number;
  scenarioCount: number;
  cards: string[];
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode?: "story" | "ooc";
};

type Provider = "openai" | "anthropic" | "gemini" | "compatible";
type ReasoningLevel = "none" | "low" | "medium" | "high";

type LlmConfig = {
  provider: Provider;
  model: string;
  apiKey: string;
  baseUrl: string;
  maxOutputTokens: number;
  reasoningLevel: ReasoningLevel;
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
  maxOutputTokens: 8192,
  reasoningLevel: "medium",
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

const reasoningLabels: Record<ReasoningLevel, string> = {
  none: "사용 안 함",
  low: "낮음 · 빠른 응답",
  medium: "중간 · 균형",
  high: "높음 · 깊은 분석",
};

const initialMessages: ChatMessage[] = [
  {
    id: "intro",
    role: "assistant",
    content:
      "지금은 API 키 없이 작동하는 로컬 데모 모드입니다. 정해진 분석 규칙으로 카드와 병목을 안내하며, 실제 생성형 AI 대화는 우측 상단 ‘모델 연결’에서 API 키를 연결한 뒤 시작됩니다.",
  },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

type Outcome = Omit<LoopResult, "loop" | "paretoOptimal" | "dominatedBy">;

const SCENARIO_COUNT = 1200;
const ROUND_SECONDS = 5 * 60;

type NetworkLinkStyle = {
  left: number;
  top: number;
  width: number;
  transform: string;
};

function CityNetworkMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const powerRef = useRef<HTMLButtonElement>(null);
  const tunnelRef = useRef<HTMLButtonElement>(null);
  const hospitalRef = useRef<HTMLButtonElement>(null);
  const shelterRef = useRef<HTMLButtonElement>(null);
  const [links, setLinks] = useState<Record<string, NetworkLinkStyle>>({});

  useLayoutEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const updateLinks = () => {
      const mapBox = map.getBoundingClientRect();
      const connect = (
        from: HTMLButtonElement | null,
        to: HTMLButtonElement | null,
      ): NetworkLinkStyle | null => {
        if (!from || !to) return null;
        const fromBox = from.getBoundingClientRect();
        const toBox = to.getBoundingClientRect();
        const left = fromBox.left + fromBox.width / 2 - mapBox.left;
        const top = fromBox.top + fromBox.height / 2 - mapBox.top;
        const targetX = toBox.left + toBox.width / 2 - mapBox.left;
        const targetY = toBox.top + toBox.height / 2 - mapBox.top;
        const deltaX = targetX - left;
        const deltaY = targetY - top;
        return {
          left,
          top,
          width: Math.hypot(deltaX, deltaY),
          transform: `rotate(${Math.atan2(deltaY, deltaX)}rad)`,
        };
      };

      const nextLinks = {
        power: connect(powerRef.current, tunnelRef.current),
        hospital: connect(tunnelRef.current, hospitalRef.current),
        shelter: connect(tunnelRef.current, shelterRef.current),
      };
      if (nextLinks.power && nextLinks.hospital && nextLinks.shelter) {
        setLinks(nextLinks as Record<string, NetworkLinkStyle>);
      }
    };

    updateLinks();
    const observer = new ResizeObserver(updateLinks);
    observer.observe(map);
    window.addEventListener("resize", updateLinks);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateLinks);
    };
  }, []);

  return (
    <div className="city-map" ref={mapRef} aria-label="도시 대피 네트워크">
      <div className="map-grid" />
      <div className="network-links" aria-hidden="true">
        <span className="network-link power-to-tunnel" style={links.power} />
        <span className="network-link tunnel-to-hospital" style={links.hospital} />
        <span className="network-link tunnel-to-shelter" style={links.shelter} />
      </div>
      <button ref={powerRef} className="map-node power" aria-label="중앙 발전소: 위험">
        <i /><span>P-01</span><small>발전소</small>
      </button>
      <button ref={tunnelRef} className="map-node tunnel critical" aria-label="C-07 터널: 병목">
        <i /><span>C-07</span><small>최소 절단 · 42</small>
      </button>
      <button ref={hospitalRef} className="map-node hospital" aria-label="병원">
        <i /><span>H-02</span><small>병원</small>
      </button>
      <button ref={shelterRef} className="map-node shelter" aria-label="대피소">
        <i /><span>S-09</span><small>대피소</small>
      </button>
      <div className="map-status"><span className="pulse" />도시 네트워크 · 실시간</div>
      <div className="map-legend">
        <span><i className="legend-safe" /> 정상</span>
        <span><i className="legend-risk" /> 위험</span>
        <span><i className="legend-bottleneck" /> 병목</span>
      </div>
    </div>
  );
}

function pseudoRandom(index: number, salt: number) {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function normalShock(index: number) {
  const u1 = Math.max(pseudoRandom(index, 1), 0.000001);
  const u2 = pseudoRandom(index, 2);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function calculateOutcome(chosen: Strategy[]): Outcome {
  const flow = chosen.reduce((sum, card) => sum + card.flow, 0);
  const stability = chosen.reduce((sum, card) => sum + card.stability, 0);
  const damageProtection = chosen.reduce((sum, card) => sum + card.damage, 0);
  const equity = chosen.reduce((sum, card) => sum + card.equity, 0);
  const hasTunnel = chosen.some((card) => card.id === "tunnel");
  const hasSignal = chosen.some((card) => card.id === "signal");
  const breaksBottleneck = hasTunnel || hasSignal;
  const hasTransportWithoutBottleneck =
    chosen.some((card) => card.id === "bus") && !breaksBottleneck;
  const hasCriticalPair = hasTunnel && hasSignal;
  const bottleneckCapacity = 42 + (hasTunnel ? 26 : 0) + (hasSignal ? 14 : 0) + (hasCriticalPair ? 8 : 0);
  const meanEvacuation = clamp(
    52 + flow * 0.72 + (bottleneckCapacity - 42) * 0.27 -
      (hasTransportWithoutBottleneck ? 9 : 0),
    48,
    97,
  );
  const variability = clamp(
    14.8 - stability * 0.68 - (hasCriticalPair ? 1.1 : 0) +
      (hasTransportWithoutBottleneck ? 1.8 : 0),
    3.2,
    16,
  );
  let evacuationTotal = 0;
  let successCount = 0;
  for (let scenario = 1; scenario <= SCENARIO_COUNT; scenario += 1) {
    const cascadingFailure = pseudoRandom(scenario, 3) < 0.12
      ? Math.max(0, 7 - stability * 0.35)
      : 0;
    const evacuation = clamp(
      meanEvacuation + normalShock(scenario) * variability - cascadingFailure,
      35,
      99,
    );
    evacuationTotal += evacuation;
    if (evacuation >= 90) successCount += 1;
  }
  const evacuation = evacuationTotal / SCENARIO_COUNT;
  const chance90 = (successCount / SCENARIO_COUNT) * 100;
  const damage = clamp(
    94 - damageProtection * 3.2 + (hasCriticalPair ? 3 : 0),
    18,
    96,
  );
  const equityGap = clamp(25 - equity * 1.15, 4, 27);

  return {
    evacuation: Math.round(evacuation * 10) / 10,
    variability: Math.round(variability * 10) / 10,
    chance90: Math.round(chance90),
    damage: Math.round(damage),
    equityGap: Math.round(equityGap * 10) / 10,
    bottleneckCapacity,
    scenarioCount: SCENARIO_COUNT,
    cards: chosen.map((card) => card.id),
  };
}

function validPortfolios() {
  const portfolios: Strategy[][] = [];
  for (let first = 0; first < strategies.length - 2; first += 1) {
    for (let second = first + 1; second < strategies.length - 1; second += 1) {
      for (let third = second + 1; third < strategies.length; third += 1) {
        const portfolio = [strategies[first], strategies[second], strategies[third]];
        if (portfolio.reduce((sum, card) => sum + card.cost, 0) <= 100) portfolios.push(portfolio);
      }
    }
  }
  return portfolios;
}

function dominates(candidate: Outcome, target: Outcome) {
  const noWorse =
    candidate.evacuation >= target.evacuation &&
    candidate.chance90 >= target.chance90 &&
    candidate.variability <= target.variability &&
    candidate.damage <= target.damage &&
    candidate.equityGap <= target.equityGap;
  const strictlyBetter =
    candidate.evacuation > target.evacuation ||
    candidate.chance90 > target.chance90 ||
    candidate.variability < target.variability ||
    candidate.damage < target.damage ||
    candidate.equityGap < target.equityGap;
  return noWorse && strictlyBetter;
}

const portfolioOutcomes = validPortfolios().map(calculateOutcome);

function paretoPosition(outcome: Outcome) {
  return {
    left: `${clamp(((outcome.damage - 18) / (96 - 18)) * 86 + 5, 5, 91)}%`,
    bottom: `${clamp(((outcome.evacuation - 48) / (99 - 48)) * 78 + 7, 7, 85)}%`,
  };
}

function simulate(loop: number, chosen: Strategy[]): LoopResult {
  const outcome = calculateOutcome(chosen);
  const dominatedBy = portfolioOutcomes.filter((candidate) => dominates(candidate, outcome)).length;
  return { ...outcome, loop, dominatedBy, paretoOptimal: dominatedBy === 0 };
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
  const [secondsLeft, setSecondsLeft] = useState(ROUND_SECONDS);
  const [timerDeadline, setTimerDeadline] = useState<number | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [llmConfig, setLlmConfig] = useState<LlmConfig>(defaultConfig);
  const chatLogRef = useRef<HTMLDivElement>(null);
  const roundDurationRef = useRef(ROUND_SECONDS);
  const activeRequestRef = useRef<AbortController | null>(null);
  const localReplyTimersRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem("optimizer-llm-config");
      if (stored) setLlmConfig({ ...defaultConfig, ...JSON.parse(stored) });
    } catch {
      // A blocked storage API should not block the simulation.
    }
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const requested = Number(new URLSearchParams(window.location.search).get("timerTest"));
    if (!Number.isFinite(requested) || requested <= 0) return;
    roundDurationRef.current = Math.min(ROUND_SECONDS, Math.floor(requested));
    setSecondsLeft(roundDurationRef.current);
  }, []);

  useEffect(() => {
    const activeTheme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    setTheme(activeTheme);
  }, []);

  useEffect(() => {
    const log = chatLogRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, sending]);

  useEffect(() => {
    if (timerDeadline === null || timedOut) return;

    const updateTimer = () => {
      const remaining = Math.max(0, Math.ceil((timerDeadline - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining > 0) return;

      setTimerDeadline(null);
      setTimedOut(true);
      setSending(false);
      activeRequestRef.current?.abort();
      activeRequestRef.current = null;
      localReplyTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      localReplyTimersRef.current.clear();
    };

    updateTimer();
    const interval = window.setInterval(updateTimer, 250);
    return () => window.clearInterval(interval);
  }, [timerDeadline, timedOut]);

  useEffect(() => () => {
    activeRequestRef.current?.abort();
    localReplyTimersRef.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    try {
      window.localStorage.setItem("optimizer-theme", nextTheme);
    } catch {
      // The active theme still applies when persistent storage is unavailable.
    }
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      "content",
      nextTheme === "dark" ? "#000000" : "#f5f5f7",
    );
  };

  const selectedCards = useMemo(
    () => strategies.filter((card) => selected.includes(card.id)),
    [selected],
  );
  const totalCost = selectedCards.reduce((sum, card) => sum + card.cost, 0);
  const latest = results.at(-1);
  const canDeploy = selected.length === 3 && totalCost <= 100;
  const connected = Boolean(llmConfig.apiKey && llmConfig.model);
  const latestCards = latest
    ? strategies.filter((card) => latest.cards.includes(card.id))
    : [];
  const visibleMessages = connected
    ? messages.filter((message) => message.id !== "intro")
    : messages;
  const timerRunning = timerDeadline !== null && !timedOut;
  const formattedTime = `${String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:${String(secondsLeft % 60).padStart(2, "0")}`;

  const startRoundTimer = () => {
    if (timerDeadline === null && !timedOut) {
      setTimerDeadline(Date.now() + secondsLeft * 1000);
    }
  };

  const resetRoundTimer = () => {
    setTimerDeadline(null);
    setSecondsLeft(roundDurationRef.current);
    setTimedOut(false);
  };

  const toggleCard = (card: Strategy) => {
    if (timedOut) return;
    startRoundTimer();
    setSelected((current) => {
      if (current.includes(card.id)) {
        return current.filter((id) => id !== card.id);
      }
      if (current.length >= 3) return current;
      return [...current, card.id];
    });
  };

  const runLoop = () => {
    if (!canDeploy || timedOut) return;
    const result = simulate(loop, selectedCards);
    setResults((current) => [...current, result]);

    const bottleneckNote = selected.some((id) => ["tunnel", "signal"].includes(id))
      ? "C-07 병목 용량이 개선되었습니다."
      : "C-07 병목이 남아 추가 수송 자원의 효과가 제한됐습니다.";
    const paretoNote = result.paretoOptimal
      ? "전체 예산 내 조합과 비교해 파레토 비지배 전략입니다."
      : `${result.dominatedBy}개 조합이 모든 핵심 지표에서 같거나 더 낫습니다.`;
    const report = `Loop ${loop} 완료. ${result.scenarioCount.toLocaleString()}개 재난 시나리오의 평균 대피율은 ${result.evacuation}%, 변동성은 ${result.variability}%p, 90% 이상 달성 확률은 ${result.chance90}%입니다. ${bottleneckNote} ${paretoNote}`;
    setMessages((current) => [
      ...current,
      { id: `loop-${loop}`, role: "assistant", content: report },
    ]);

    if (loop === 3) {
      setTimerDeadline(null);
      setReportOpen(true);
    } else {
      setLoop((current) => current + 1);
      resetRoundTimer();
    }
  };

  const submitMessage = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || sending || timedOut) return;
    startRoundTimer();

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
      mode: chatMode,
    };
    const nextMessages = [
      ...messages.filter((message) => !connected || message.id !== "intro"),
      userMessage,
    ];
    setMessages(nextMessages);
    setDraft("");

    if (!connected) {
      const localTimer = window.setTimeout(() => {
        localReplyTimersRef.current.delete(localTimer);
        setMessages((current) => [
          ...current,
          {
            id: `local-${Date.now()}`,
            role: "assistant",
            content: localCoach(text, loop, selectedCards, chatMode),
          },
        ]);
      }, 320);
      localReplyTimersRef.current.add(localTimer);
      return;
    }

    setSending(true);
    const activeRequest = new AbortController();
    activeRequestRef.current?.abort();
    activeRequestRef.current = activeRequest;
    try {
      const response = await fetch("/api/llm", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-optimizer-api-key": llmConfig.apiKey,
        },
        signal: activeRequest.signal,
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
          generation: {
            maxOutputTokens: llmConfig.maxOutputTokens,
            reasoningLevel: llmConfig.reasoningLevel,
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
      if (activeRequest.signal.aborted) return;
      setMessages((current) => [
        ...current,
        {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: `외부 모델 연결에 실패했습니다. ${error instanceof Error ? error.message : "설정을 확인해 주세요."} 로컬 분석 모드로 계속 진행할 수 있습니다.`,
        },
      ]);
    } finally {
      if (activeRequestRef.current === activeRequest) {
        activeRequestRef.current = null;
        setSending(false);
      }
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
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    localReplyTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    localReplyTimersRef.current.clear();
    setLoop(1);
    setSelected([]);
    setResults([]);
    setMessages(initialMessages);
    setReportOpen(false);
    setSending(false);
    resetRoundTimer();
  };

  const retryLoop = () => {
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    localReplyTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    localReplyTimersRef.current.clear();
    setSelected([]);
    setDraft("");
    setSending(false);
    setMessages((current) => [
      ...current,
      {
        id: `retry-${loop}-${Date.now()}`,
        role: "assistant",
        content: `Loop ${loop}을 다시 시작합니다. 첫 카드 선택 또는 첫 대화를 보내는 순간부터 5분이 흐릅니다.`,
      },
    ]);
    resetRoundTimer();
  };

  return (
    <main className="mission-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <img src="/optimizer-mark.svg" alt="" />
          </span>
          <div>
            <p className="eyebrow">도시 재난 대응 시뮬레이션</p>
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

        <div className="toolbar-actions">
          <button
            className="theme-toggle"
            type="button"
            aria-label={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
            aria-pressed={theme === "dark"}
            onClick={toggleTheme}
          >
            <span aria-hidden="true">{theme === "dark" ? "☀︎" : "☾"}</span>
            <small>{theme === "dark" ? "라이트" : "다크"}</small>
          </button>
          <button className="connection-button" onClick={() => { setSettingsTab("model"); setSettingsOpen(true); }}>
            <span className={`connection-dot ${connected ? "online" : ""}`} />
            <span>
              <small>{connected ? "AI 연결됨" : "로컬 데모"}</small>
              {connected ? llmConfig.model : "모델 연결"}
            </span>
            <b aria-hidden="true">⚙</b>
          </button>
        </div>
      </header>

      <div className="workspace-grid">
        <section className="operation-column" aria-label="작전 보드">
          <section className="briefing-panel">
            <div className="briefing-copy">
              <p className="signal-label"><span /> 실시간 사고 브리핑 · 중앙 전력망</p>
              <h2>도시는 5분 뒤<br /><span>멈춥니다.</span></h2>
              <div
                className={`countdown ${timerRunning ? "running" : ""} ${secondsLeft <= 60 ? "warning" : ""} ${timedOut ? "expired" : ""}`}
                aria-label={`Loop ${loop} 남은 시간 ${formattedTime}`}
                role="timer"
              >
                {formattedTime.slice(0, 2)}<span>:</span>{formattedTime.slice(3)}
              </div>
              <p className="timer-note">
                {timedOut
                  ? `Loop ${loop} 종료 · 다시 시도해 주세요.`
                  : timerRunning
                    ? `Loop ${loop} 진행 중 · 카드 선택과 대화를 마치고 전략을 확정하세요.`
                    : "첫 카드 선택 또는 첫 대화 전송 시 5분 타이머가 시작됩니다."}
              </p>
              <p>
                세 장의 카드와 세 번의 타임루프.<br />
                예산 <strong>100</strong> 안에서 도시의 다음 5분을 다시 설계하세요.
              </p>
              <div className="briefing-tags">
                <span>2–4인 플레이</span>
                <span>3개의 타임루프</span>
                <span>목표 · 대피율 90%</span>
              </div>
            </div>

            <CityNetworkMap />
          </section>

          <section className="strategy-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">전략 선택</p>
                <h2>이번 루프의 <em>선택</em></h2>
                <p>서로 다른 대가를 가진 카드 세 장으로 최선의 조합을 만드세요.</p>
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
                    disabled={timedOut}
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
                      <small>용량 42 → {latest.bottleneckCapacity}</small>
                    </div>
                    <div className="flow-line">
                      <span>주거지</span><i /><b className="danger">C-07</b><i /><span>대피소</span>
                    </div>
                    <p>
                      {latest.cards.some((id) => ["tunnel", "signal"].includes(id))
                        ? "병목 대응 카드가 전체 네트워크 유량을 개선했습니다."
                        : "추가 수송 자원이 병목 앞에 누적되고 있습니다. 간선 용량 개선이 우선입니다."}
                    </p>
                  </div>
                  <div className="pareto-analysis">
                    <div className="analysis-title">
                      <span>파레토 위치</span>
                      <small>{latest.paretoOptimal ? "비지배 전략" : `${latest.dominatedBy}개 조합에 지배됨`}</small>
                    </div>
                    <div className="pareto-plot" aria-label="생존율과 피해액 파레토 그래프">
                      {portfolioOutcomes.map((outcome) => (
                        <i
                          className={`dot ${outcome.cards.join("-") === latest.cards.join("-") ? "current" : ""}`}
                          key={outcome.cards.join("-")}
                          style={paretoPosition(outcome)}
                        />
                      ))}
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
              <button className="deploy-button" disabled={!canDeploy || timedOut} onClick={runLoop}>
                <span>{loop === 3 ? "최종 전략 확정" : `LOOP ${loop} 실행`}</span>
                <i aria-hidden="true">→</i>
              </button>
            </div>
          </section>
        </section>

        <aside className="advisor-panel" aria-label="AI 옵티마이저 대화">
          <div className="advisor-header">
            <div className="agent-avatar" aria-hidden="true">
              <img src="/optimizer-mark.svg" alt="" />
            </div>
            <div>
              <p>{connected ? "생성형 AI 스토리 가이드" : "규칙 기반 스토리 가이드"}</p>
              <h2>옵티마이저와 대화</h2>
            </div>
            <button
              className="prompt-stack-button"
              onClick={() => { setSettingsTab("story"); setSettingsOpen(true); }}
            >
              프롬프트
            </button>
            <span className={`agent-state ${connected ? "online" : "local"}`}>
              <i /> {connected ? "AI 연결됨" : "로컬 데모"}
            </span>
          </div>

          <div className="objective-card">
            <span>이번 장면</span>
            <strong>{loop === 1 ? "직관적 대응" : loop === 2 ? "데이터 분석과 수정" : "독립적 최적화"}</strong>
            <p>
              {loop === 1
                ? "기능과 비용만 보고 첫 조합을 선택하세요."
                : loop === 2
                  ? "최소 절단과 확률 지표로 카드를 수정하세요."
                  : "AI 추천을 검토하고 가치 우선순위를 결정하세요."}
            </p>
          </div>

          <div className="chat-log" ref={chatLogRef} aria-live="polite">
            <div className="system-chip">Loop {loop} · 스토리</div>
            {visibleMessages.map((message) => (
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
          </div>

          <div className="quick-prompts">
            {["이야기 이어가기", "지금 가장 위험한 곳", "전략 힌트"].map((prompt) => (
              <button key={prompt} disabled={timedOut} onClick={() => setDraft(prompt)}>{prompt}</button>
            ))}
          </div>

          <form className="chat-composer" onSubmit={submitMessage}>
            <div className="composer-mode-row">
              <label htmlFor="commander-message">메시지</label>
              <span>
                <button type="button" disabled={timedOut} className={chatMode === "story" ? "active" : ""} onClick={() => setChatMode("story")}>STORY</button>
                <button type="button" disabled={timedOut} className={chatMode === "ooc" ? "active" : ""} onClick={() => setChatMode("ooc")}>OOC</button>
              </span>
            </div>
            <div>
              <textarea
                id="commander-message"
                value={draft}
                disabled={timedOut}
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
              <button aria-label="메시지 전송" disabled={!draft.trim() || sending || timedOut}>↗</button>
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
          cards={latestCards}
          onClose={() => setReportOpen(false)}
          onReset={resetMission}
        />
      )}

      {timedOut && (
        <div className="modal-backdrop timeout-backdrop" role="presentation">
          <section className="timeout-report" role="alertdialog" aria-modal="true" aria-labelledby="timeout-title">
            <div className="timeout-emblem" aria-hidden="true">00:00</div>
            <p className="eyebrow">TIME LIMIT EXCEEDED / LOOP {loop}</p>
            <h2 id="timeout-title">작전 시간이 종료됐습니다.</h2>
            <p>진행 중인 모델 응답과 전략 입력을 중단했습니다.<br />같은 회차를 5분부터 다시 시작할 수 있습니다.</p>
            <button className="retry-button" onClick={retryLoop}>LOOP {loop} 다시 시도 <span aria-hidden="true">↻</span></button>
          </section>
        </div>
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
      model:
        provider === "openai"
          ? "gpt-5.6-terra"
          : provider === "gemini"
            ? "gemini-3.6-flash"
            : "",
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

            <div className="generation-grid">
              <label className="field-label">
                최대 출력 토큰
                <input
                  type="number"
                  min={256}
                  max={65536}
                  step={256}
                  value={draft.maxOutputTokens}
                  onChange={(event) => setDraft({
                    ...draft,
                    maxOutputTokens: Math.min(65536, Math.max(256, Number(event.target.value) || 256)),
                  })}
                  inputMode="numeric"
                />
                <small>256–65,536 · 응답 길이와 사용량에 영향을 줍니다.</small>
              </label>

              <label className="field-label">
                사고 레벨
                <select
                  value={draft.reasoningLevel}
                  onChange={(event) => setDraft({ ...draft, reasoningLevel: event.target.value as ReasoningLevel })}
                >
                  {(Object.keys(reasoningLabels) as ReasoningLevel[]).map((level) => (
                    <option value={level} key={level}>{reasoningLabels[level]}</option>
                  ))}
                </select>
                <small>공급자가 지원하는 가장 가까운 추론 설정으로 변환합니다.</small>
              </label>
            </div>

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
  const improved = first
    ? result.dominatedBy < first.dominatedBy || result.evacuation > first.evacuation
    : true;
  const success = result.paretoOptimal && result.chance90 >= 50;
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
            <p>{result.paretoOptimal ? "전체 조합 기준 파레토 비지배" : `${result.dominatedBy}개 우월 조합 존재`} · 90% 달성 확률 {result.chance90}% · {improved ? "최초 전략보다 개선" : "추가 개선 필요"}</p>
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
