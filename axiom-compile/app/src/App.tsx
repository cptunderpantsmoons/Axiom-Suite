import { useCallback, useState } from "react";
import {
  compileIntent,
  answerQuestions,
  type IntentQuestion,
  type QuestionAnswer,
} from "@axiom/core";
import "./app.css";

const DEFAULT_REQUEST = "make auth better";

interface PacketMeta {
  packet_id: string;
  task_type: string;
  target_area: string;
  scope_lock: string;
}

type Stage =
  | { kind: "" }
  | { kind: "loading" }
  | { kind: "ask"; questions: IntentQuestion[] }
  | { kind: "ready"; markup: string; packet: PacketMeta }
  | { kind: "error" };

export function App() {
  const [request, setRequest] = useState(DEFAULT_REQUEST);
  const [mode, setMode] = useState<"interactive" | "one-shot">("interactive");
  const [stage, setStage] = useState<Stage>({ kind: "" });
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const toMeta = (p: {
    packet_id: string;
    task_contract: { task_type: string; target_area: string; scope_lock: string };
  }): PacketMeta => ({
    packet_id: p.packet_id,
    task_type: p.task_contract.task_type,
    target_area: p.task_contract.target_area,
    scope_lock: p.task_contract.scope_lock,
  });

  const run = useCallback(async () => {
    if (!request.trim()) return;
    setStage({ kind: "loading" });
    try {
      const res = await compileIntent(request, { mode });
      if (res.status === "needs_answer") {
        setStage({ kind: "ask", questions: res.questions });
      } else {
        setStage({ kind: "ready", markup: res.markup, packet: toMeta(res.packet) });
      }
    } catch {
      setStage({ kind: "error" });
    }
  }, [request, mode]);

  const submitAnswers = useCallback(async () => {
    const qa: QuestionAnswer[] = Object.entries(answers).map(([questionId, value]) => ({
      questionId,
      value,
    }));
    setStage({ kind: "loading" });
    try {
      const res = await answerQuestions(request, qa, { mode: "one-shot" });
      if (res.status === "ready") {
        setStage({ kind: "ready", markup: res.markup, packet: toMeta(res.packet) });
      }
    } catch {
      setStage({ kind: "error" });
    }
  }, [answers, request]);

  return (
    <main className="shell">
      <header className="brand">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 256 256" role="img" aria-label="Axiom">
            <defs>
              <linearGradient id="axiomGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#007cf0" />
                <stop offset="1" stopColor="#7928ca" />
              </linearGradient>
            </defs>
            <rect width="256" height="256" rx="56" fill="url(#axiomGrad)" />
            <g fill="none" stroke="#fff" strokeWidth="18" strokeLinecap="round" strokeLinejoin="round">
              <line x1="128" y1="62" x2="128" y2="150" />
              <line x1="80" y1="104" x2="176" y2="104" strokeOpacity="0.85" />
            </g>
            <path d="M94 150 L128 200 L162 150 Z" fill="#fff" />
          </svg>
        </span>
        <p className="eyebrow">Axiom Compiler</p>
        <h1>Axiom</h1>
        <p className="tagline">Messy intent. Absolute execution.</p>
      </header>

      <section className="intake">
        <textarea
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder="e.g. make the login less confusing; add rate limiting; stop the tests crashing"
          rows={3}
        />
        <div className="intake-bar">
          <label className="mode">
            <input
              type="checkbox"
              checked={mode === "interactive"}
              onChange={(e) => setMode(e.target.checked ? "interactive" : "one-shot")}
            />
            ask questions when ambiguous
          </label>
          <button className="compile" onClick={() => void run()} disabled={stage.kind === "loading"}>
            {stage.kind === "loading" ? "compiling…" : "Compile intent"}
          </button>
        </div>
      </section>

      {stage.kind === "loading" && (
        <section className="status"><span className="spin" /> thinking…</section>
      )}

      {stage.kind === "ask" && (
        <section className="gate">
          <h2>A few choices to tighten this.</h2>
          {stage.questions.map((q, i) => (
            <div className="question" key={q.id}>
              <div className="q-head">
                <span className="q-n">{i + 1}</span>
                <span className="q-text">{q.question}</span>
              </div>
              {q.options?.length ? (
                <div className="options">
                  {q.options.map((o) => (
                    <button
                      key={o.value}
                      className={answers[q.id] === o.value ? "opt sel" : "opt"}
                      onClick={() => setAnswers((a) => ({ ...a, [q.id]: o.value }))}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              ) : (
                <input
                  defaultValue={q.default}
                  onBlur={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                />
              )}
              <p className="rationale">{q.rationale}</p>
            </div>
          ))}
          <button className="compile" onClick={() => void submitAnswers()}>
            Compile with my choices
          </button>
        </section>
      )}

      {stage.kind === "ready" && (
        <section className="result">
          <div className="meta">
            <span className="pill">type · {stage.packet.task_type}</span>
            <span className="pill">area · {stage.packet.target_area}</span>
            <span className="pill">id · {stage.packet.packet_id.slice(0, 8)}</span>
          </div>
          <h2>Compiled task packet</h2>
          <pre className="packet">{stage.markup}</pre>
          <button
            className="ghost"
            onClick={() => void navigator.clipboard?.writeText(stage.markup)}
          >
            copy packet
          </button>
        </section>
      )}

      {stage.kind === "error" && <section className="status error">Something went wrong.</section>}
    </main>
  );
}