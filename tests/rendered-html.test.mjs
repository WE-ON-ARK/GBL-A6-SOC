import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the Optimizer mission interface", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /재난 5분 전/);
  assert.match(html, /옵티마이저/);
  assert.match(html, /이번 루프의.*선택/);
  assert.match(html, /로컬 데모/);
  assert.match(html, /API 키 없이 작동하는 로컬 데모 모드/);
  assert.match(html, /다크 모드로 전환/);
  assert.match(html, /optimizer-mark\.svg/);
  assert.match(html, /세 장의 카드와 세 번의 타임루프/);
  assert.match(html, /social-preview-v2\.png/);
  assert.match(html, /프롬프트/);
  assert.match(html, /STORY/);
  assert.match(html, /OOC/);
  assert.doesNotMatch(html, /codex-preview/);
  assert.doesNotMatch(html, /react-loading-skeleton/);
});

test("ships simulation and model generation controls", async () => {
  const [client, route, capabilitiesRoute] = await Promise.all([
    readFile(new URL("../app/mission-control.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/llm/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/llm/capabilities/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(client, /SCENARIO_COUNT = 1200/);
  assert.match(client, /ROUND_SECONDS = 5 \* 60/);
  assert.match(client, /ROUND_TIMER_KEY = "optimizer-round-timer"/);
  assert.match(client, /timerDeadlineRef/);
  assert.match(client, /startRoundTimer/);
  assert.match(client, /activeRequestRef\.current\?\.abort/);
  assert.match(client, /LOOP \{loop\} 다시 시도/);
  assert.match(client, /function CityNetworkMap/);
  assert.match(client, /ResizeObserver/);
  assert.doesNotMatch(client, /className="road road-/);
  assert.match(client, /function dominates/);
  assert.match(client, /최대 출력 토큰/);
  assert.match(client, /사고 레벨/);
  assert.match(client, /PROMPT_VERSION = 3/);
  assert.match(client, /여성향 RP 톤/);
  assert.match(client, /ReactMarkdown/);
  assert.match(client, /remarkGfm/);
  assert.match(client, /MISSION_SEED_KEY/);
  assert.match(client, /incidentVariants/);
  assert.match(client, /extractUserName/);
  assert.match(client, /temperature/);
  assert.match(client, /이번 Loop가 의미하는 것/);
  assert.match(client, /availableCards/);
  assert.match(client, /카드 조합 비교해줘/);
  assert.match(route, /게임 마스터, 카드 전략 코치, Loop 디브리퍼/);
  assert.match(route, /resolveUserName/);
  assert.match(route, /실시간 스냅샷/);
  assert.match(route, /max_output_tokens: maxOutputTokens/);
  assert.match(route, /thinkingLevel/);
  assert.match(route, /output_config/);
  assert.match(capabilitiesRoute, /Gemini 모델 메타데이터/);
  assert.match(capabilitiesRoute, /maxTemperature/);
});
