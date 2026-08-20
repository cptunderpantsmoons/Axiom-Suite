/* Vanilla Axiom preview. Drives the real engine via /api/compile. */
const $ = (id) => document.getElementById(id);
const status = $("status");
const gate = $("gate");
const result = $("result");
const compileBtn = $("compile");

let questions = [];

function show(section, html) {
  [status, gate, result].forEach((el) => { el.hidden = el !== section; });
  section.innerHTML = html;
}

function busy(on) {
  compileBtn.disabled = on;
  status.hidden = !on;
  show(status, `<span class="spin"></span> thinking…`);
  if (!on) status.hidden = true;
}

async function post(payload) {
  const r = await fetch("/api/compile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return r.json();
}

async function compile() {
  const request = $("request").value.trim();
  if (!request) return;
  busy(true);
  try {
    const mode = $("interrogate").checked ? "interactive" : "one-shot";
    const data = await post({ request, mode });
    if (data.status === "needs_answer") {
      questions = data.questions;
      renderGate(request);
    } else if (data.status === "ready") {
      renderResult(request, data);
    } else {
      show(status, data.message || "Something went wrong.");
    }
  } finally {
    busy(false);
  }
}

function renderGate(request) {
  const answers = {};
  const html = `<h2>A few choices to tighten this</h2>${questions
    .map(
      (q, i) => `
      <div class="question">
        <div class="q-head"><span class="q-n">${i + 1}</span><span class="q-text"></span></div>
        <h3>${q.question}</h3>
        ${
          q.options?.length
            ? `<div class="options">${q.options
                .map(
                  (o) =>
                    `<button class="opt" data-q="${q.id}" data-v="${o.value}">${o.label}</button>`,
                )
                .join("")}</div>`
            : `<input data-q="${q.id}" value="${q.default}" />`
        }
        <p class="rationale">${q.rationale}</p>
      </div>`,
    )
    .join("")}
    <button class="compile" id="submit">Compile with my choices</button>`;
  show(gate, html);

  gate.querySelectorAll(".opt").forEach((b) =>
    b.addEventListener("click", () => {
      gate.querySelectorAll(`.opt[data-q="${b.dataset.q}"]`).forEach((x) =>
        x.classList.remove("sel"),
      );
      b.classList.add("sel");
      answers[b.dataset.q] = b.dataset.v;
    }),
  );
  gate.querySelectorAll("input[data-q]").forEach((inp) =>
    inp.addEventListener("input", () => (answers[inp.dataset.q] = inp.value)),
  );

  $("submit").addEventListener("click", async () => {
    busy(true);
    const data = await post({ request, mode: "one-shot", answers: questions.map((q) => ({ questionId: q.id, value: answers[q.id] || q.default })) });
    if (data.status === "ready") renderResult(request, data);
    busy(false);
  });
}

function renderResult(request, data) {
  show(
    result,
    `<div class="meta">
      <span class="pill">type · ${data.packet.task_type}</span>
      <span class="pill">area · ${data.packet.target_area}</span>
      <span class="pill">id · ${data.packet.packet_id.slice(0, 8)}</span>
    </div>
    <h2>Compiled task packet</h2>
    <pre class="packet"></pre>
    <button class="ghost" id="copy">copy packet</button>`,
  );
  result.querySelector(".packet").textContent = data.markup;
  $("copy").addEventListener("click", () => navigator.clipboard.writeText(data.markup));
}

compileBtn.addEventListener("click", compile);
$("request").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) compile();
});