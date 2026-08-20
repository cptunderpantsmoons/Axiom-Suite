// ---------------------------------------------------------------------------
// Static site client assets
//
// CSS and client-side JavaScript written verbatim to the site's assets
// directory. Kept out of index.js so that module stays under the line limit.
//
// The JavaScript persists plan quality-gate checkbox state in localStorage so a
// gate can be checked off and survive a page reload; it also drives the
// per-plan gate-completion counter, progress bar, and reset button.
// ---------------------------------------------------------------------------

export const SITE_CSS = `:root {
  color-scheme: dark;

  /* Primitive tokens — color palette */
  --gray-900: #0f1220;
  --gray-800: #171b2e;
  --gray-700: #27304a;
  --indigo-300: #7aa2ff;
  --bluegray-200: #98a2c7;
  --text-100: #e8ecff;
  --green-400: #39d98a;
  --amber-400: #ffcc66;
  --red-400: #ff6b6b;

  /* Primitive tokens — spacing scale */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.25rem;
  --space-6: 1.5rem;
  --space-8: 2rem;

  /* Primitive tokens — typography */
  --font-sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --text-xs: 0.8rem;
  --text-sm: 0.85rem;
  --text-base: 1rem;
  --text-lg: 1.5rem;
  --line-base: 1.5;

  /* Primitive tokens — radii */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-pill: 999px;

  /* Primitive tokens — elevation */
  --shadow-1: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-2: 0 4px 12px rgba(0, 0, 0, 0.35);

  /* Semantic tokens — surface & text */
  --bg: var(--gray-900);
  --panel: var(--gray-800);
  --border: var(--gray-700);
  --text: var(--text-100);
  --muted: var(--bluegray-200);
  --accent: var(--indigo-300);

  /* Semantic tokens — status */
  --good: var(--green-400);
  --warn: var(--amber-400);
  --bad: var(--red-400);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: var(--font-sans);
  background: var(--bg);
  color: var(--text);
  line-height: var(--line-base);
}

a { color: var(--accent); text-decoration: none; }

nav {
  display: flex;
  gap: var(--space-4);
  flex-wrap: wrap;
  padding: var(--space-4) var(--space-6);
  background: rgba(0, 0, 0, 0.15);
  border-bottom: 1px solid var(--border);
}
nav a { padding: var(--space-1) 0; }
.active { font-weight: 700; text-decoration: underline; }

.hero, main {
  max-width: 1100px;
  margin: 0 auto;
  padding: var(--space-6);
}
.hero { border-bottom: 1px solid var(--border); }

section {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-4) var(--space-5);
  margin: var(--space-4) 0;
  box-shadow: var(--shadow-1);
}

h1, h2 { margin: var(--space-1) 0 var(--space-4); }
h1 { font-size: var(--text-lg); }
p { margin: var(--space-1) 0 var(--space-4); }

.badges { display: flex; gap: var(--space-2); flex-wrap: wrap; }

.badge {
  display: inline-flex;
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-pill);
  font-size: var(--text-sm);
  border: 1px solid var(--border);
}
.badge-good { background: rgba(57, 217, 138, 0.15); color: var(--good); }
.badge-warn { background: rgba(255, 204, 102, 0.15); color: var(--warn); }
.badge-bad { background: rgba(255, 107, 107, 0.15); color: var(--bad); }
.badge-neutral { background: rgba(122, 162, 255, 0.12); color: var(--accent); }

dl {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: var(--space-3) var(--space-4);
}
dt { color: var(--muted); }
dd { margin: 0; }

table { width: 100%; border-collapse: collapse; }
td, th {
  padding: var(--space-3) var(--space-2);
  border-top: 1px solid var(--border);
  vertical-align: top;
}

.muted { color: var(--muted); }

code {
  background: rgba(255, 255, 255, 0.06);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
}

.severity {
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-pill);
  font-size: var(--text-xs);
}
.severity-high, .severity-bad { color: var(--bad); }
.severity-medium, .severity-warn { color: var(--warn); }
.severity-low, .severity-good { color: var(--good); }

.status-fresh { color: var(--good); }
.status-stale { color: var(--warn); }
.status-missing { color: var(--bad); }

ul { margin: var(--space-1) 0 0 var(--space-4); }
ol { margin: var(--space-1) 0 0 var(--space-4); }

.plan-task {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-3) var(--space-4);
  margin: var(--space-3) 0;
}

.gates { list-style: none; margin-left: 0; padding-left: 0; }
.gates li { padding: var(--space-2) 0; border-top: 1px solid var(--border); }
.gates li:first-child { border-top: none; }
.gates label { display: flex; gap: var(--space-2); align-items: center; }
.gates code { display: inline-block; margin: var(--space-1) 0; }
.gates input[type="checkbox"] { cursor: pointer; accent-color: var(--accent); }
.gates input:checked + strong { color: var(--muted); text-decoration: line-through; }

.plan-gate-summary { color: var(--muted); }
.plan-gate-summary .gate-done { color: var(--good); font-weight: 700; }

.clear-gates {
  background: none;
  border: 1px solid var(--border);
  color: var(--muted);
  border-radius: var(--radius-pill);
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-sm);
  cursor: pointer;
}
.clear-gates:hover { color: var(--text); border-color: var(--accent); }

.gate-progress {
  height: 6px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: var(--radius-pill);
  overflow: hidden;
  margin: var(--space-2) 0;
  max-width: 320px;
}
.gate-progress-fill {
  height: 100%;
  width: 0;
  background: var(--good);
  border-radius: var(--radius-pill);
  transition: width 0.2s ease;
}
`;

export const SITE_JS = `(function () {
  'use strict';

  var STORAGE_KEY = 'ctx-plan-gates';

  function readState() {
    try {
      return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
    } catch (error) {
      return {};
    }
  }

  function writeState(state) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      // Storage unavailable (private mode / quota) — checkboxes still work in-memory.
    }
  }

  function gateKey(input) {
    var plan = input.getAttribute('data-plan') || '';
    var task = input.getAttribute('data-task') || 'plan';
    var gate = input.getAttribute('data-gate') || '';
    return JSON.stringify([plan, task, gate]);
  }

  function updateCounts() {
    var groups = {};

    document.querySelectorAll('input.gate-check').forEach(function (input) {
      var plan = input.getAttribute('data-plan') || '';
      if (!groups[plan]) groups[plan] = { total: 0, done: 0 };
      groups[plan].total += 1;
      if (input.checked) groups[plan].done += 1;
    });

    Object.keys(groups).forEach(function (plan) {
      var summary = document.querySelector('.plan-gate-summary[data-plan="' + plan + '"]');
      if (summary) {
        var done = summary.querySelector('.gate-done');
        var total = summary.querySelector('.gate-total');
        if (done) done.textContent = groups[plan].done;
        if (total) total.textContent = groups[plan].total;
      }

      var progress = document.querySelector('.gate-progress[data-plan="' + plan + '"]');
      if (progress) {
        var pct = groups[plan].total ? Math.round((groups[plan].done / groups[plan].total) * 100) : 0;
        var fill = progress.querySelector('.gate-progress-fill');
        if (fill) fill.style.width = pct + '%';
        progress.setAttribute('aria-valuenow', groups[plan].done);
      }
    });
  }

  function clearPlan(plan) {
    var next = readState();
    var changed = false;

    document.querySelectorAll('input.gate-check[data-plan="' + plan + '"]').forEach(function (input) {
      if (input.checked) {
        input.checked = false;
        changed = true;
      }
      var key = gateKey(input);
      if (next[key]) {
        delete next[key];
        changed = true;
      }
    });

    if (changed) writeState(next);
    updateCounts();
  }

  function init() {
    var inputs = document.querySelectorAll('input.gate-check');
    var state = readState();

    inputs.forEach(function (input) {
      var key = gateKey(input);
      input.checked = state[key] === true;

      input.addEventListener('change', function () {
        var next = readState();
        if (input.checked) {
          next[key] = true;
        } else {
          delete next[key];
        }
        writeState(next);
        updateCounts();
      });
    });

    document.querySelectorAll('button.clear-gates').forEach(function (button) {
      button.addEventListener('click', function () {
        clearPlan(button.getAttribute('data-plan') || '');
      });
    });

    updateCounts();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;
