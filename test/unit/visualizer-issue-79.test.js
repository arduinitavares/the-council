import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const HTML_PATH = path.resolve(import.meta.dirname, '../../src/visualizer/index.html');
const VIS_JS_PATH = path.resolve(import.meta.dirname, '../../src/visualizer/council-visualizer.js');

await import(VIS_JS_PATH);
const CouncilVisualizerReal = globalThis.CouncilVisualizer;

function readVisualizerHtml() {
  return fs.readFileSync(HTML_PATH, 'utf8');
}

function extractInlineControllerSource(html) {
  const match = html.match(/<script>\s*([\s\S]*?)\s*<\/script>\s*<\/body>/);
  assert.ok(match, 'index.html must contain main inline controller script before </body>');
  return match[1];
}

function extractStandaloneLeaderboardFn(html) {
  const match = html.match(/function renderTelemetryLeaderboard\(\) \{[\s\S]*?\n    \}/);
  assert.ok(match, 'index.html must define standalone-extractable renderTelemetryLeaderboard()');
  return match[0];
}

/**
 * Rich deterministic mock DOM harness that tracks innerHTML writes, option rebuilds,
 * programmatic event listeners, focus state, timers, visibility, and appended scripts.
 */
function createVisualizerHarness({
  win = {},
  visualizer = CouncilVisualizerReal,
  initiallyHidden = false,
  minimalStub = false,
  nowFn = () => Date.now()
} = {}) {
  const html = readVisualizerHtml();
  const scriptBody = extractInlineControllerSource(html);

  const elements = new Map();
  const appendedScripts = [];
  const docListeners = new Map();
  const timeouts = new Map();
  const intervals = new Map();
  let nextTimerId = 1;
  let hidden = initiallyHidden;

  function makeClassList(el) {
    return {
      _set: new Set(String(el.className || '').split(/\s+/).filter(Boolean)),
      add(token) {
        this._set.add(token);
        el.className = Array.from(this._set).join(' ');
      },
      remove(token) {
        this._set.delete(token);
        el.className = Array.from(this._set).join(' ');
      },
      toggle(token, force) {
        const shouldHave = force !== undefined ? Boolean(force) : !this._set.has(token);
        if (shouldHave) this._set.add(token);
        else this._set.delete(token);
        el.className = Array.from(this._set).join(' ');
        return shouldHave;
      },
      contains(token) {
        return this._set.has(token);
      }
    };
  }

  function makeElement(id, tagName = 'DIV') {
    if (minimalStub) {
      return {
        id,
        tagName,
        textContent: '',
        innerHTML: '',
        value: id === 'run-selector' ? 'latest' : '',
        className: '',
        style: {}
      };
    }

    let rawHtml = '';
    const children = [];
    const listeners = new Map();
    const attrs = new Map();

    const el = {
      id,
      tagName,
      textContent: '',
      value: id === 'run-selector' ? 'latest' : (id === 'telemetry-group-by' ? 'model' : (id === 'telemetry-window' ? 'all' : '')),
      className: '',
      hidden: false,
      style: {},
      dataset: {},
      children,
      options: children,
      innerHTMLWrites: 0,
      replaceChildrenCalls: 0,
      appendChildCalls: 0,
      listeners,
      get innerHTML() {
        return rawHtml;
      },
      set innerHTML(val) {
        rawHtml = String(val ?? '');
        this.innerHTMLWrites += 1;
      },
      get firstChild() {
        return children[0] || null;
      },
      setAttribute(name, val) {
        attrs.set(name, String(val));
        if (name === 'id') this.id = String(val);
        if (name.startsWith('data-')) {
          const camel = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          this.dataset[camel] = String(val);
        }
      },
      getAttribute(name) {
        return attrs.has(name) ? attrs.get(name) : null;
      },
      appendChild(child) {
        this.appendChildCalls += 1;
        children.push(child);
        return child;
      },
      removeChild(child) {
        const i = children.indexOf(child);
        if (i >= 0) children.splice(i, 1);
        return child;
      },
      replaceChildren(...next) {
        this.replaceChildrenCalls += 1;
        children.length = 0;
        children.push(...next);
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      dispatchEvent(type, eventObj = {}) {
        const handlers = listeners.get(type) || [];
        for (const fn of handlers) {
          fn.call(this, { target: this, ...eventObj });
        }
      },
      querySelector(selector) {
        const stepMatch = selector.match(/^\[data-step-idx="(\d+)"\]$/);
        if (stepMatch) {
          const idx = stepMatch[1];
          if (rawHtml.includes(`data-step-idx="${idx}"`)) {
            if (!this._stepNodes) this._stepNodes = new Map();
            if (!this._stepNodes.has(idx)) {
              const rowNode = makeElement(`step-row-${idx}`, 'DIV');
              rowNode.setAttribute('data-step-idx', idx);
              rowNode.focus = () => {
                mockDoc.activeElement = rowNode;
                rowNode.focusCalls = (rowNode.focusCalls || 0) + 1;
              };
              this._stepNodes.set(idx, rowNode);
            }
            return this._stepNodes.get(idx);
          }
          return null;
        }
        return null;
      },
      remove() {
        this.removed = true;
        if (this.id && elements.get(this.id) === this) {
          elements.delete(this.id);
        }
      }
    };
    el.classList = makeClassList(el);
    return el;
  }

  function getEl(id) {
    if (!elements.has(id)) {
      const tag = id.endsWith('-svg') ? 'SVG' : (id.includes('selector') || id.startsWith('telemetry-') ? 'SELECT' : 'DIV');
      elements.set(id, makeElement(id, tag));
    }
    return elements.get(id);
  }

  // Pre-seed essential known elements so getElementById only returns null for dynamic script IDs when absent
  const knownIds = [
    'run-selector',
    'badge-live-tag',
    'stream-badge',
    'status-pill',
    'status-pill-text',
    'lbl-elapsed',
    'btn-live-follow',
    'btn-live-follow-label',
    'heading-topic',
    'lbl-phase',
    'lbl-round',
    'lbl-max-rounds',
    'lbl-quorum',
    'lbl-verdict-status',
    'verdict-box',
    'verdict-title',
    'verdict-body',
    'synthesis-text',
    'transition-text',
    'lbl-clauses-count',
    'clauses-list',
    'lbl-objs-count',
    'objections-list',
    'lbl-roster-count',
    'seats-grid',
    'lbl-proofs-count',
    'proofs-list',
    'btn-tab-topology',
    'btn-tab-causal',
    'stage-topology',
    'stage-causal',
    'state-machine-svg',
    'causal-dependency-svg',
    'btn-jump-latest',
    'timeline-list',
    'lbl-telemetry-runs',
    'telemetry-group-by',
    'telemetry-window',
    'telemetry-leaderboard-body'
  ];
  for (const id of knownIds) getEl(id);

  const mockDoc = minimalStub
    ? {
        getElementById: (id) => elements.get(id) || null,
        createElement: (tag) => makeElement('', tag.toUpperCase()),
        head: {
          appendChild: (el) => {
            if (el.id) elements.set(el.id, el);
            appendedScripts.push(el);
          }
        }
      }
    : {
        activeElement: null,
        get hidden() {
          return hidden;
        },
        set hidden(v) {
          hidden = Boolean(v);
        },
        getElementById: (id) => elements.get(id) || null,
        createElement: (tag) => makeElement('', tag.toUpperCase()),
        addEventListener(type, fn) {
          if (!docListeners.has(type)) docListeners.set(type, []);
          docListeners.get(type).push(fn);
        },
        dispatchEvent(type, ev = {}) {
          for (const fn of docListeners.get(type) || []) {
            fn(ev);
          }
        },
        head: {
          appendChild: (el) => {
            if (el.id) elements.set(el.id, el);
            appendedScripts.push(el);
          }
        }
      };

  const fakeSetTimeout = (fn, ms) => {
    const id = nextTimerId++;
    let unrefCalled = false;
    const handle = {
      id,
      ms,
      unref() {
        unrefCalled = true;
      },
      get unrefCalled() {
        return unrefCalled;
      }
    };
    timeouts.set(id, { id, fn, ms, handle });
    return handle;
  };

  const fakeClearTimeout = (handle) => {
    const id = handle && typeof handle === 'object' ? handle.id : handle;
    timeouts.delete(id);
  };

  const fakeSetInterval = (fn, ms) => {
    const id = nextTimerId++;
    const handle = { id, ms, unref() {} };
    intervals.set(id, { id, fn, ms, handle });
    return handle;
  };

  const fakeClearInterval = (handle) => {
    const id = handle && typeof handle === 'object' ? handle.id : handle;
    intervals.delete(id);
  };

  const fakeDate = Object.assign(function (...args) {
    return new Date(...args);
  }, {
    now: () => nowFn(),
    parse: (s) => Date.parse(s)
  });

  const domWin = { ...win };

  const controllerFn = new Function(
    'window',
    'globalThis',
    'document',
    'CouncilVisualizer',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    'Date',
    scriptBody +
      '\nreturn { selectRun, inspectStep, restoreLatestSnapshot, pollLiveRun, updateRunSelector, renderTelemetryLeaderboard, renderAll, switchGraphTab, toggleLiveFollow, startLiveFollow, stopLiveFollow, updateElapsedTimer, escapeHtml, sanitizeClassToken, isValidRunId };'
  );

  const args = [
    domWin,
    domWin,
    mockDoc,
    visualizer,
    fakeSetTimeout,
    fakeClearTimeout,
    fakeSetInterval,
    fakeClearInterval,
    fakeDate
  ];

  const controller = controllerFn(...args);

  return {
    controller,
    domWin,
    mockDoc,
    elements,
    getEl,
    appendedScripts,
    timeouts,
    intervals,
    setHidden(nextHidden) {
      mockDoc.hidden = nextHidden;
      mockDoc.dispatchEvent('visibilitychange');
    },
    runNextTimeout() {
      const first = timeouts.values().next().value;
      if (!first) return false;
      timeouts.delete(first.id);
      first.fn();
      return true;
    },
    tickIntervals() {
      for (const entry of Array.from(intervals.values())) {
        entry.fn();
      }
    }
  };
}

const ALLOWED_RENDERED_TAGS = new Set([
  'div',
  'span',
  'strong',
  'table',
  'caption',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'ol',
  'ul',
  'li',
  'button',
  'defs',
  'marker',
  'path',
  'g',
  'title',
  'rect',
  'text'
]);

function assertNoRawExecutableMarkup(htmlFragment, label) {
  const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?>/g;
  let match;
  while ((match = tagRegex.exec(htmlFragment)) !== null) {
    const tagName = match[1].toLowerCase();
    const attrs = match[2] || '';
    assert.ok(
      ALLOWED_RENDERED_TAGS.has(tagName),
      `${label} rendered unexpected/dangerous HTML tag <${tagName}> in: ${match[0]}`
    );
    // Strip properly quoted attribute values ("..." and '...') so only real attribute names
    // (plus any broken-out unquoted tokens!) remain.
    const attrNamesOnly = attrs.replace(/"[^"]*"|'[^']*'/g, '""');
    assert.doesNotMatch(
      attrNamesOnly,
      /\bon[a-z]+\s*=|\bdata-x\b|\bdata-y\b/i,
      `${label} allowed attribute breakout or inline event handler in <${tagName}${attrs}>`
    );
  }
}

describe('Issue #79: Visualizer XSS Hardening, Validated runId Loading, and Differential Non-Overlapping Polling', () => {
  describe('1. Context-safe DOM updates, 5-char HTML escaping, and CSS class token allowlisting', () => {
    it('escapes &, <, >, ", and \' in CouncilVisualizer.escapeHtml and SVG renderers', () => {
      assert.equal(
        CouncilVisualizerReal.escapeHtml(`& < > " '`),
        '&amp; &lt; &gt; &quot; &#39;'
      );

      const stateSvg = {
        innerHTML: '',
        setAttribute() {},
        querySelector: () => null
      };
      CouncilVisualizerReal.renderStateMachineSVG(
        stateSvg,
        { phase: 'reviewing', previousPhase: 'preflight' },
        {
          activeNodeId: 'reviewing"><img src=x onerror=alert(1)>',
          lastEdgeId: 'e1" onclick="alert(1)',
          nodes: [
            {
              id: 'reviewing"><img src=x onerror=alert(1)>',
              label: `Review's <Phase> & "Test"`,
              sub: `<script>alert('x')</script>`,
              x: 120,
              y: 90
            },
            {
              id: 'voting',
              label: 'Voting',
              sub: 'Cast votes',
              x: 340,
              y: 90
            }
          ],
          edges: [
            {
              id: 'e1" onclick="alert(1)',
              from: 'reviewing"><img src=x onerror=alert(1)>',
              to: 'voting',
              event: '<img src=x onerror=alert(2)>',
              guard: `"quote" & 'single'`
            }
          ],
          outgoingEdges: []
        }
      );
      assertNoRawExecutableMarkup(stateSvg.innerHTML, 'StateMachineSVG');
      assert.match(stateSvg.innerHTML, /&quot;&gt;&lt;img/);
      assert.match(stateSvg.innerHTML, /&#39;single&#39;/);

      const causalSvg = {
        innerHTML: '',
        setAttribute() {}
      };
      CouncilVisualizerReal.renderCausalDependencySVG(causalSvg, {
        phase: 'reviewing',
        judge: {
          id: `judge"><script>alert(1)</script>`,
          harness: `codex' onclick='alert(1)`,
          model: 'm1',
          status: 'idle',
          soul: `<img src=x onerror="evil()">`,
          faultReason: `"fault"`
        },
        seats: [
          {
            id: `seat"><img src=x onerror=alert(1)>`,
            harness: 'codex',
            model: 'm1',
            status: 'accepted',
            soul: { name: `<b>Soul</b>`, lens: `'lens'` }
          }
        ],
        proofs: [
          {
            id: `P1' onclick='x()`,
            seatId: `seat"><img src=x onerror=alert(1)>`,
            kind: `<script>`,
            scope: `"scope"`,
            source: `<img src=x onerror=1>`,
            statement: `<b>stmt</b>`,
            status: 'partially_admitted',
            judgeAdmittedStatement: `<svg onload=1>`,
            judgeNote: `'note'`
          }
        ],
        candidate: {
          clauses: [
            {
              id: `C1"><img src=x>`,
              context: `<script>ctx</script>`,
              conclusion: `'conc'`,
              citedProofIds: [`P1' onclick='x()`]
            }
          ]
        },
        objections: [
          {
            id: `O1"><svg onload=1>`,
            seatId: `seat"><img src=x onerror=alert(1)>`,
            proofId: `P1' onclick='x()`,
            status: 'open',
            reason: `<img src=x onerror=alert(9)>`
          }
        ]
      });
      assertNoRawExecutableMarkup(causalSvg.innerHTML, 'CausalDependencySVG');
      assert.match(causalSvg.innerHTML, /&lt;script&gt;/);
      assert.match(causalSvg.innerHTML, /&#39;lens&#39;/);
    });

    it('renders malicious payloads strictly as inert text across all panels, run selector, timeline, and telemetry even when CouncilVisualizer is undefined or partially stubbed', () => {
      const xssImg = `<img src=x onerror="window.__pwned=1">`;
      const xssQuoteBreak = `"><script>window.__pwned=2</script><span data-x='`;
      const xssSingleBreak = `' onclick='window.__pwned=3' data-y='`;

      const maliciousWin = {
        CouncilRunIndex: [
          {
            runId: `run-evil"><img src=x onerror=alert(1)>`,
            topic: `Topic ${xssImg}`,
            verdictKind: `DISSENT ${xssSingleBreak}`,
            isRunning: false
          }
        ],
        CouncilLatestLiveRun: {
          runId: 'run-live-xss',
          isRunning: false,
          startedAt: '2026-11-10T10:00:00.000Z',
          updatedAt: '2026-11-10T10:01:05.000Z',
          currentState: {
            topic: `Topic ${xssImg}`,
            phase: `reviewing ${xssQuoteBreak}`,
            round: 1,
            maxRounds: 3,
            minQuorum: 2,
            verdict: {
              kind: `Dissent ${xssImg}`,
              note: `Verdict note ${xssQuoteBreak}`
            },
            candidate: {
              summary: `Summary ${xssImg}`,
              clauses: [
                {
                  id: `C1 ${xssQuoteBreak}`,
                  context: `Ctx ${xssImg}`,
                  conclusion: `Conclusion ${xssSingleBreak}`,
                  citedProofIds: [`P1 ${xssImg}`]
                }
              ]
            },
            judge: {
              id: `judge ${xssImg}`,
              harness: `codex" onclick="evil()`,
              model: `gpt-6 ${xssQuoteBreak}`,
              status: `thinking" onmouseover="evil()`,
              soul: { name: `JudgeSoul ${xssImg}`, lens: `Lens ${xssSingleBreak}` },
              faultReason: `Fault ${xssImg}`
            },
            seats: [
              {
                id: `seat-1 ${xssQuoteBreak}`,
                harness: `antigravity'><script>evil()</script>`,
                model: `gemini ${xssImg}`,
                status: `accepted" onclick="evil()`,
                soul: `RawSoul ${xssImg} ${xssSingleBreak}`,
                retries: `1"><img src=x onerror=1>`,
                excusedReason: `Excused ${xssQuoteBreak}`
              },
              {
                id: 'seat-valid',
                harness: 'Codex',
                model: 'gpt-6.1-sol',
                status: 'Proof_Submitted',
                soul: 'Clean Soul',
                retries: 0
              }
            ],
            proofs: [
              {
                id: `P1 ${xssImg}`,
                seatId: `seat-1 ${xssQuoteBreak}`,
                kind: `citation ${xssSingleBreak}`,
                scope: `Scope ${xssImg}`,
                source: `Source ${xssQuoteBreak}`,
                statement: `Statement ${xssImg}`,
                status: `admitted" onclick="evil()`,
                judgeAdmittedStatement: `Core ${xssImg}`,
                judgeNote: `Note ${xssSingleBreak}`
              }
            ],
            objections: [
              {
                id: `O1 ${xssImg}`,
                seatId: `seat-1 ${xssQuoteBreak}`,
                proofId: `P1 ${xssImg}`,
                status: 'open',
                reason: `Reason ${xssSingleBreak}`
              }
            ],
            history: [`History ${xssImg}`]
          },
          steps: [
            {
              label: `StepLabel ${xssImg} ${xssQuoteBreak} ${xssSingleBreak}`,
              stateSnapshot: null
            }
          ]
        },
        CouncilTelemetrySummary: {
          totalRuns: 2,
          byModel: [
            {
              key: `model ${xssImg}`,
              seatIds: [`seat ${xssQuoteBreak}`],
              runs: 2,
              proofsSubmitted: 3,
              explicitAdmissionRate: `50"><img src=x onerror=1>`,
              partialAdmissionRate: `25' onclick='1`,
              judgeRejectionRate: 0,
              finalClauseCitationRate: 50,
              excusedRate: 0,
              observedToolCalls: 4,
              traceCoverage: { fullRuns: 1, partialRuns: 1 },
              skillsRead: [
                {
                  skill: `skill ${xssImg}`,
                  count: 1,
                  evidence: `ev" onmouseover="evil()'`
                }
              ]
            }
          ],
          bySeat: []
        }
      };

      const visualizerVariants = [
        { name: 'undefined CouncilVisualizer', value: undefined },
        { name: 'empty object CouncilVisualizer {}', value: {} },
        {
          name: 'naive non-escaping stub CouncilVisualizer',
          value: {
            escapeHtml: (s) => String(s ?? ''),
            renderSoulCardHtml: (s) => `<div class="soul-block">${String(s ?? '')}</div>`
          }
        },
        { name: 'real CouncilVisualizer', value: CouncilVisualizerReal }
      ];

      for (const variant of visualizerVariants) {
        const { getEl } = createVisualizerHarness({
          win: maliciousWin,
          visualizer: variant.value
        });

        // #run-selector populated strictly via createElement('option') + value + textContent (zero innerHTML writes)
        const runSel = getEl('run-selector');
        assert.equal(runSel.innerHTMLWrites, 0, `#run-selector must never assign innerHTML (${variant.name})`);
        assert.equal(runSel.children.length, 2);
        assert.equal(runSel.children[1].tagName, 'OPTION');
        assert.equal(runSel.children[1].value, `run-evil"><img src=x onerror=alert(1)>`);
        assert.match(runSel.children[1].textContent, /<img src=x onerror=alert\(1\)>/);

        // Verify all HTML-rendered panels contain zero unescaped executable tags/attributes
        for (const panelId of [
          'clauses-list',
          'objections-list',
          'seats-grid',
          'proofs-list',
          'timeline-list',
          'telemetry-leaderboard-body'
        ]) {
          const htmlOut = getEl(panelId).innerHTML;
          assert.ok(htmlOut.length > 0, `${panelId} should render non-empty markup (${variant.name})`);
          assertNoRawExecutableMarkup(htmlOut, `${panelId} (${variant.name})`);
        }

        // Verify CSS class token allowlisting on Judge & Seat cards
        const seatsHtml = getEl('seats-grid').innerHTML;
        assert.match(seatsHtml, /class="participant-card status-idle"/, 'Malicious judge/seat status must fall back to status-idle');
        assert.match(seatsHtml, /class="harness-badge harness-unknown"/, 'Malicious judge/seat harness must fall back to harness-unknown');
        assert.match(seatsHtml, /class="participant-card status-proof_submitted"/, 'Valid status token should normalize to lowercase');
        assert.match(seatsHtml, /class="harness-badge harness-codex"/, 'Valid harness token should normalize to lowercase');
      }

      // Also verify standalone extracted renderTelemetryLeaderboard() with undefined & naive CouncilVisualizer
      const standaloneSource = extractStandaloneLeaderboardFn(readVisualizerHtml());
      const standaloneFn = new Function(
        'window',
        'globalThis',
        'document',
        'CouncilVisualizer',
        `${standaloneSource}\nrenderTelemetryLeaderboard();`
      );
      for (const cvStub of [undefined, {}, { escapeHtml: (s) => String(s ?? '') }]) {
        const bodyEl = { innerHTML: '' };
        const fakeDoc = {
          getElementById: (id) => {
            if (id === 'telemetry-leaderboard-body') return bodyEl;
            if (id === 'lbl-telemetry-runs') return { textContent: '' };
            return null;
          }
        };
        standaloneFn(maliciousWin, maliciousWin, fakeDoc, cvStub);
        assertNoRawExecutableMarkup(bodyEl.innerHTML, 'Standalone renderTelemetryLeaderboard');
        assert.match(bodyEl.innerHTML, /&lt;img src=x/);
        assert.match(bodyEl.innerHTML, /&quot; onmouseover=&quot;evil\(\)&#39;/);
      }

      // Also verify zero ReferenceError when CouncilVisualizer is genuinely undeclared in global scope
      const savedGlobalVis = globalThis.CouncilVisualizer;
      try {
        delete globalThis.CouncilVisualizer;
        const undeclaredControllerFn = new Function(
          'window',
          'globalThis',
          'document',
          'setTimeout',
          'clearTimeout',
          'setInterval',
          'clearInterval',
          extractInlineControllerSource(readVisualizerHtml())
        );
        const minEls = new Map();
        const minDoc = {
          getElementById: (id) => {
            if (!minEls.has(id)) {
              minEls.set(id, { id, textContent: '', innerHTML: '', value: 'latest', className: '', style: {} });
            }
            return minEls.get(id);
          },
          createElement: () => ({ value: '', textContent: '', remove() {} }),
          head: { appendChild() {} }
        };
        assert.doesNotThrow(() => {
          undeclaredControllerFn(maliciousWin, maliciousWin, minDoc, () => 1, () => {}, () => 1, () => {});
        });
        assertNoRawExecutableMarkup(minEls.get('seats-grid').innerHTML, 'Undeclared CouncilVisualizer seats-grid');
      } finally {
        globalThis.CouncilVisualizer = savedGlobalVis;
      }
    });
  });

  describe('2. Validated runId script loading before DOM <script> creation', () => {
    it('rejects path traversal and malformed runIds before appending any <script> and shows LOAD FAILED, while loading valid safe runIds', () => {
      const { controller, getEl, appendedScripts, domWin } = createVisualizerHarness({
        win: {
          CouncilRunIndex: [{ runId: 'run-good-1', topic: 'Good Run', isRunning: false }],
          CouncilLatestLiveRun: {
            runId: 'run-good-1',
            isRunning: false,
            currentState: {
              topic: 'Initial Safe Topic',
              phase: 'completed',
              round: 1,
              seats: [{ id: 's1', harness: 'codex', model: 'm1', status: 'accepted' }],
              proofs: [],
              objections: [],
              history: []
            },
            steps: []
          },
          CouncilRuns: {}
        }
      });

      const beforeCount = appendedScripts.length;
      const invalidIds = [
        '../evil',
        '..',
        '.',
        '../../etc/passwd',
        'run<script>',
        'foo/bar',
        'foo\\bar',
        'run?inject=1',
        'run#hash',
        'run space'
      ];

      for (const badId of invalidIds) {
        controller.selectRun(badId);
        assert.equal(
          appendedScripts.length,
          beforeCount,
          `selectRun(${JSON.stringify(badId)}) must not append any <script> tag`
        );
        assert.equal(getEl('heading-topic').textContent, `Failed to load run ${badId}.`);
        assert.equal(getEl('status-pill').className, 'badge badge-failed');
        assert.equal(getEl('status-pill-text').textContent, 'LOAD FAILED');
        assert.equal(getEl('lbl-verdict-status').className, 'badge badge-failed');
        assert.equal(getEl('lbl-verdict-status').textContent, 'LOAD FAILED');
        assert.equal(getEl('verdict-box').className, 'verdict-banner fault');
        assert.equal(getEl('verdict-title').textContent, `Failed to load run ${badId}`);
        assert.equal(getEl('verdict-body').textContent, 'Run artifact could not be loaded from disk.');
        assert.equal(getEl('seats-grid').innerHTML, '', 'Stale roster must be cleared on invalid runId');
      }

      // Prototype keys like 'toString' or 'constructor' must NOT match Object.prototype on CouncilRuns
      controller.selectRun('toString');
      assert.equal(
        appendedScripts.length,
        beforeCount + 1,
        'Safe alphanumeric identifier not in own CouncilRuns should attempt normal script load rather than reading Object.prototype.toString'
      );
      appendedScripts[appendedScripts.length - 1].onerror();
      assert.equal(getEl('status-pill-text').textContent, 'LOAD FAILED');

      // Valid safe runId loads cleanly
      controller.selectRun('run_2026.11.10-valid');
      assert.equal(appendedScripts.length, beforeCount + 2);
      const validScript = appendedScripts[appendedScripts.length - 1];
      assert.match(validScript.src, /\.\.\/\.\.\/\.council\/runs\/run_2026\.11\.10-valid\.js\?t=/);
      domWin.CouncilRuns['run_2026.11.10-valid'] = {
        runId: 'run_2026.11.10-valid',
        isRunning: false,
        currentState: {
          topic: 'Loaded Valid Historical Run',
          phase: 'completed',
          round: 1,
          seats: [],
          proofs: [],
          objections: [],
          history: []
        },
        steps: []
      };
      validScript.onload();
      assert.equal(getEl('heading-topic').textContent, 'Loaded Valid Historical Run');
    });
  });

  describe('3. Zero inline event handlers, baseline CSP meta tag, and programmatic event listeners', () => {
    it('contains baseline CSP meta tag in <head> and zero inline onclick/onchange/onkeydown/onerror attributes in markup or rendered timeline', () => {
      const html = readVisualizerHtml();

      // Strip <script> and <style> blocks to inspect static HTML markup cleanly
      const markupOnly = html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');

      assert.doesNotMatch(
        markupOnly,
        /\bon(?:click|change|keydown|keyup|keypress|error|load|submit|focus|blur|input)\s*=/i,
        'Static HTML markup must contain zero inline on* event attributes'
      );

      const headMatch = html.match(/<head>([\s\S]*?)<\/head>/i);
      assert.ok(headMatch, 'index.html must contain <head>');
      assert.match(
        headMatch[1],
        /<meta\s+http-equiv="Content-Security-Policy"\s+content="object-src 'none'; base-uri 'none';"\s*\/?>/,
        '<head> must include exact baseline CSP meta tag'
      );
      // Verify CSP meta appears before any <script> or <link> in <head>
      const cspIdx = headMatch[1].indexOf('http-equiv="Content-Security-Policy"');
      const firstScriptOrLink = headMatch[1].search(/<(?:script|link)\b/i);
      if (firstScriptOrLink !== -1) {
        assert.ok(cspIdx < firstScriptOrLink, 'CSP meta tag must precede any <script> or <link> in <head>');
      }
    });

    it('binds programmatic listeners and #timeline-list click/keyboard delegation without throwing on minimal DOM stubs', () => {
      // Minimal stub without addEventListener must never throw
      assert.doesNotThrow(() => {
        createVisualizerHarness({ minimalStub: true });
      });

      const { getEl } = createVisualizerHarness({
        win: {
          CouncilRunIndex: [{ runId: 'run-live', topic: 'Delegation Run', isRunning: false }],
          CouncilLatestLiveRun: {
            runId: 'run-live',
            isRunning: false,
            currentState: {
              topic: 'Latest Snapshot Topic',
              phase: 'completed',
              round: 2,
              seats: [],
              proofs: [],
              objections: [],
              history: []
            },
            steps: [
              {
                label: 'Step 1 Label',
                stateSnapshot: {
                  topic: 'Step 1 Topic',
                  phase: 'reviewing',
                  round: 1,
                  seats: [],
                  proofs: [],
                  objections: [],
                  history: []
                }
              },
              {
                label: 'Step 2 Label',
                stateSnapshot: {
                  topic: 'Step 2 Topic',
                  phase: 'voting',
                  round: 1,
                  seats: [],
                  proofs: [],
                  objections: [],
                  history: []
                }
              }
            ]
          },
          CouncilTelemetrySummary: {
            totalRuns: 1,
            byModel: [{ key: 'model-a', runs: 1 }],
            bySeat: [{ key: 'seat-alpha', runs: 1 }]
          }
        }
      });

      const timelineHtml = getEl('timeline-list').innerHTML;
      assert.doesNotMatch(timelineHtml, /\bon(?:click|keydown)\s*=/i, 'Rendered timeline items must have zero inline handlers');
      assert.match(timelineHtml, /data-step-idx="0"/);
      assert.match(timelineHtml, /data-step-idx="1"/);

      // Click delegation from nested child element inside [data-step-idx="0"]
      const row0 = {
        getAttribute: (k) => (k === 'data-step-idx' ? '0' : null),
        dataset: { stepIdx: '0' }
      };
      const nestedSpan = {
        getAttribute: () => null,
        dataset: {},
        parentElement: row0,
        closest: (sel) => (sel === '[data-step-idx]' ? row0 : null)
      };
      getEl('timeline-list').dispatchEvent('click', { target: nestedSpan });
      assert.equal(getEl('heading-topic').textContent, 'Step 1 Topic');

      // Native <button type="button"> click delegation on [data-step-idx="1"] (without Spacebar keydown hijacking)
      const row1 = {
        tagName: 'BUTTON',
        getAttribute: (k) => (k === 'data-step-idx' ? '1' : null),
        dataset: { stepIdx: '1' },
        closest: (sel) => (sel === '[data-step-idx]' ? row1 : null)
      };
      let prevented = false;
      getEl('timeline-list').dispatchEvent('keydown', {
        key: ' ',
        target: row1,
        preventDefault() {
          prevented = true;
        }
      });
      assert.equal(prevented, false, 'Native <button> timeline row must not hijack Spacebar on keydown');
      getEl('timeline-list').dispatchEvent('click', { target: row1 });
      assert.equal(getEl('heading-topic').textContent, 'Step 2 Topic');

      // Jump to Latest button listener restores latest snapshot
      getEl('btn-jump-latest').dispatchEvent('click');
      assert.equal(getEl('heading-topic').textContent, 'Latest Snapshot Topic');

      // Telemetry group-by programmatic change listener updates leaderboard
      assert.match(getEl('telemetry-leaderboard-body').innerHTML, /model-a/);
      getEl('telemetry-group-by').value = 'seat';
      getEl('telemetry-group-by').dispatchEvent('change');
      assert.match(getEl('telemetry-leaderboard-body').innerHTML, /seat-alpha/);

      // Live Follow toggle button programmatic click listener
      assert.equal(getEl('btn-live-follow-label').textContent, 'Live Follow: ON (Idle)');
      getEl('btn-live-follow').dispatchEvent('click');
      assert.equal(getEl('btn-live-follow-label').textContent, 'Live Follow: OFF');
      getEl('btn-live-follow').dispatchEvent('click');
      assert.equal(getEl('btn-live-follow-label').textContent, 'Live Follow: ON (Idle)');
    });
  });

  describe('4. Differential rendering, focus/dropdown preservation, and active-tab-only SVG rendering', () => {
    it('performs zero redundant DOM/SVG writes on unchanged poll ticks, preserves timeline focus & run-selector options, and lazily renders hidden SVG tab on switch', () => {
      let stateSvgCalls = 0;
      let causalSvgCalls = 0;
      const spyVisualizer = {
        ...CouncilVisualizerReal,
        renderStateMachineSVG(svgEl, state, graph) {
          stateSvgCalls += 1;
          return CouncilVisualizerReal.renderStateMachineSVG(svgEl, state, graph);
        },
        renderCausalDependencySVG(svgEl, state, graph) {
          causalSvgCalls += 1;
          return CouncilVisualizerReal.renderCausalDependencySVG(svgEl, state, graph);
        }
      };

      const { controller, getEl, domWin, appendedScripts, runNextTimeout } = createVisualizerHarness({
        visualizer: spyVisualizer,
        win: {
          CouncilRunIndex: [
            { runId: 'run-active', topic: 'Live Differential Run', isRunning: true }
          ],
          CouncilLatestLiveRun: {
            runId: 'run-active',
            isRunning: true,
            startedAt: '2026-11-10T10:00:00.000Z',
            updatedAt: '2026-11-10T10:00:05.000Z',
            currentState: {
              topic: 'Live Differential Run',
              phase: 'reviewing',
              round: 1,
              seats: [{ id: 's1', harness: 'codex', model: 'm1', status: 'thinking' }],
              proofs: [],
              objections: [],
              history: ['Started']
            },
            steps: [{ label: 'Step 1: Started', stateSnapshot: null }]
          },
          CouncilTelemetrySummary: {
            totalRuns: 1,
            byModel: [{ key: 'codex/gpt-6-astra', runs: 1 }],
            bySeat: []
          }
        }
      });

      // Initial render rendered ONLY topology SVG (active tab), NOT causal SVG (hidden tab)
      assert.equal(stateSvgCalls, 1, 'Initial render must render active topology SVG once');
      assert.equal(causalSvgCalls, 0, 'Initial render must skip hidden causal SVG');

      const runSel = getEl('run-selector');
      const timelineEl = getEl('timeline-list');
      const clausesEl = getEl('clauses-list');
      const seatsEl = getEl('seats-grid');
      const leaderboardEl = getEl('telemetry-leaderboard-body');

      // Focus step 0 inside #timeline-list
      const focusedRow = timelineEl.querySelector('[data-step-idx="0"]');
      assert.ok(focusedRow, 'Step 0 row must exist');
      focusedRow.focus();

      const baseline = {
        replaceChildren: runSel.replaceChildrenCalls,
        appendChild: runSel.appendChildCalls,
        timelineWrites: timelineEl.innerHTMLWrites,
        clausesWrites: clausesEl.innerHTMLWrites,
        seatsWrites: seatsEl.innerHTMLWrites,
        leaderboardWrites: leaderboardEl.innerHTMLWrites
      };

      // Settle initial poll scripts with IDENTICAL data, then run 2 more unchanged poll cycles
      const settleCurrentPoll = () => {
        const batch = appendedScripts.slice(-3);
        for (const s of batch) {
          if (s.onload) s.onload();
        }
      };

      settleCurrentPoll();
      assert.equal(runNextTimeout(), true);
      settleCurrentPoll();
      assert.equal(runNextTimeout(), true);
      settleCurrentPoll();

      // Zero DOM/SVG writes across unchanged poll ticks!
      assert.equal(runSel.replaceChildrenCalls, baseline.replaceChildren, '#run-selector options must not rebuild when CouncilRunIndex is unchanged');
      assert.equal(runSel.appendChildCalls, baseline.appendChild, '#run-selector must not append options when unchanged');
      assert.equal(timelineEl.innerHTMLWrites, baseline.timelineWrites, '#timeline-list must not rewrite innerHTML on unchanged poll ticks');
      assert.equal(clausesEl.innerHTMLWrites, baseline.clausesWrites, '#clauses-list must not rewrite innerHTML on unchanged poll ticks');
      assert.equal(seatsEl.innerHTMLWrites, baseline.seatsWrites, '#seats-grid must not rewrite innerHTML on unchanged poll ticks');
      assert.equal(leaderboardEl.innerHTMLWrites, baseline.leaderboardWrites, '#telemetry-leaderboard-body must not rewrite innerHTML on unchanged poll ticks');
      assert.equal(stateSvgCalls, 1, 'Topology SVG must not re-render on unchanged poll ticks');
      assert.equal(causalSvgCalls, 0, 'Hidden causal SVG must still have 0 renders');

      // Switching to Causal tab lazily renders Causal SVG immediately without re-rendering Topology SVG
      controller.switchGraphTab('causal');
      assert.equal(causalSvgCalls, 1, 'switchGraphTab("causal") must lazily render Causal SVG');
      assert.equal(stateSvgCalls, 1, 'Topology SVG should not re-render when switching to Causal');

      // Now simulate a new step arriving while viewing Causal tab and while step 0 has keyboard focus
      domWin.CouncilLatestLiveRun = {
        ...domWin.CouncilLatestLiveRun,
        updatedAt: '2026-11-10T10:00:08.000Z',
        currentState: {
          ...domWin.CouncilLatestLiveRun.currentState,
          phase: 'voting'
        },
        steps: [
          ...domWin.CouncilLatestLiveRun.steps,
          { label: 'Step 2: Voting', stateSnapshot: null }
        ]
      };
      assert.equal(runNextTimeout(), true);
      settleCurrentPoll();

      assert.equal(causalSvgCalls, 2, 'Active Causal tab updates when state changes');
      assert.equal(stateSvgCalls, 1, 'Hidden Topology tab is skipped while Causal tab is active');
      assert.equal(timelineEl.innerHTMLWrites, baseline.timelineWrites + 1, 'Timeline updates once when steps change');
      assert.ok(focusedRow.focusCalls >= 2, 'Keyboard focus on [data-step-idx="0"] is restored after timeline growth');

      // Switching back to Topology tab lazily renders the updated state on Topology SVG
      controller.switchGraphTab('topology');
      assert.equal(stateSvgCalls, 2, 'Switching back to Topology tab lazily renders updated state');
    });
  });

  describe('5. Non-overlapping setTimeout polling, visibility pause/resume, auto-idle on completion, and startedAt elapsed timer', () => {
    it('schedules non-overlapping 1000ms setTimeout only after poll scripts settle (including fallback), never removing in-flight scripts mid-poll', () => {
      const { appendedScripts, timeouts } = createVisualizerHarness({
        win: {
          CouncilLatestLiveRun: {
            runId: 'run-1',
            isRunning: true,
            startedAt: '2026-11-10T10:00:00.000Z',
            updatedAt: '2026-11-10T10:00:02.000Z',
            currentState: { topic: 'Slow Network Run', phase: 'reviewing', round: 1, seats: [] },
            steps: []
          }
        }
      });

      // Initial poll appended 3 scripts: index.js, telemetry-summary.js, latest.js
      assert.equal(appendedScripts.length, 3);
      const [idx1, tel1, latest1] = appendedScripts;

      // While scripts are in flight (simulating >1000ms slow disk/load), NO next poll timeout exists yet!
      assert.equal(timeouts.size, 0, 'Next poll timeout must not be scheduled before current poll scripts settle');
      assert.ok(!idx1.removed && !tel1.removed && !latest1.removed, 'In-flight scripts must not be prematurely removed');

      // Settle index and telemetry first — still waiting on latest.js
      idx1.onload();
      tel1.onload();
      assert.equal(timeouts.size, 0, 'Must wait for all 3 poll branches before scheduling next timeout');

      // Simulate latest.js failing and falling back to ./live-run-latest.js
      latest1.onerror();
      assert.equal(appendedScripts.length, 4, 'latest.js error should append ./live-run-latest.js fallback');
      const fallback1 = appendedScripts[3];
      assert.match(fallback1.src, /^\.\/live-run-latest\.js\?t=/);
      assert.equal(timeouts.size, 0, 'Must wait for fallback script to settle before scheduling next timeout');

      fallback1.onload();
      assert.equal(timeouts.size, 1, 'Exactly one 1000ms timeout scheduled once all branches settle');
      const scheduled = Array.from(timeouts.values())[0];
      assert.equal(scheduled.ms, 1000);
      assert.equal(scheduled.handle.unrefCalled, true, 'Timer handle .unref() must be called when available');
    });

    it('pauses polling and elapsed timer while document.hidden is true and resumes immediately on visibilitychange', () => {
      let nowMs = Date.parse('2026-11-10T10:00:10.000Z');
      const { getEl, appendedScripts, timeouts, intervals, setHidden } = createVisualizerHarness({
        nowFn: () => nowMs,
        win: {
          CouncilLatestLiveRun: {
            runId: 'run-vis',
            isRunning: true,
            startedAt: '2026-11-10T10:00:00.000Z',
            updatedAt: '2026-11-10T10:00:05.000Z',
            currentState: { topic: 'Visibility Run', phase: 'reviewing', round: 1, seats: [] },
            steps: []
          }
        }
      });

      // Settle initial poll so 1s poll timer + 1s elapsed interval are active
      for (const s of appendedScripts.slice(0, 3)) s.onload();
      assert.equal(timeouts.size, 1);
      assert.equal(intervals.size, 1);
      assert.equal(getEl('lbl-elapsed').textContent, '00:10');

      const scriptsBeforeHide = appendedScripts.length;

      // Hide tab: both poll timeout and elapsed interval must pause immediately
      setHidden(true);
      assert.equal(timeouts.size, 0, 'Poll timeout must be cleared when document becomes hidden');
      assert.equal(intervals.size, 0, 'Elapsed timer must stop when document becomes hidden');

      nowMs = Date.parse('2026-11-10T10:01:05.000Z');
      assert.equal(getEl('lbl-elapsed').textContent, '00:10', 'Elapsed label does not tick while hidden');

      // Show tab: elapsed timer updates immediately and pollLiveRun resumes immediately
      setHidden(false);
      assert.equal(getEl('lbl-elapsed').textContent, '01:05', 'Elapsed timer refreshes immediately on visibility restore');
      assert.equal(intervals.size, 1, 'Elapsed timer resumes when visible and running');
      assert.equal(appendedScripts.length, scriptsBeforeHide + 3, 'Live Follow poll resumes immediately on visibility restore');
    });

    it('stops background polling once latest run reports isRunning === false until user re-triggers Live Follow or selects latest', () => {
      const { controller, getEl, domWin, appendedScripts, timeouts } = createVisualizerHarness({
        win: {
          CouncilLatestLiveRun: {
            runId: 'run-finish',
            isRunning: true,
            startedAt: '2026-11-10T10:00:00.000Z',
            updatedAt: '2026-11-10T10:00:15.000Z',
            currentState: { topic: 'Finishing Run', phase: 'voting', round: 1, seats: [] },
            steps: []
          }
        }
      });

      assert.equal(appendedScripts.length, 3);
      // Run completes during this poll!
      domWin.CouncilLatestLiveRun = {
        ...domWin.CouncilLatestLiveRun,
        isRunning: false,
        updatedAt: '2026-11-10T10:00:42.000Z',
        currentState: {
          topic: 'Finishing Run',
          phase: 'completed',
          round: 1,
          verdict: { kind: 'Unanimous Consensus', note: 'Done' },
          seats: []
        }
      };
      for (const s of appendedScripts.slice(0, 3)) s.onload();

      assert.equal(timeouts.size, 1, 'Background polling throttles to 2500ms Idle Watch Mode once isRunning === false');
      assert.equal(Array.from(timeouts.values())[0].ms, 2500);
      assert.equal(getEl('btn-live-follow-label').textContent, 'Live Follow: ON (Idle)');
      assert.equal(getEl('lbl-elapsed').textContent, '00:42');

      // Manual toggleLiveFollow() stops Idle Watch Mode completely
      controller.toggleLiveFollow();
      assert.equal(timeouts.size, 0, 'Manual toggle OFF stops background polling');
      assert.equal(getEl('btn-live-follow-label').textContent, 'Live Follow: OFF');

      // Re-triggering via toggleLiveFollow() starts a fresh check
      controller.toggleLiveFollow();
      assert.equal(appendedScripts.length, 6, 'toggleLiveFollow() must re-trigger pollLiveRun');
      for (const s of appendedScripts.slice(3, 6)) s.onload();
      assert.equal(timeouts.size, 1, 'Idles at 2500ms when latest run is still isRunning === false');
      assert.equal(Array.from(timeouts.values())[0].ms, 2500);

      // Selecting 'latest' also re-triggers a fresh check
      controller.selectRun('latest');
      assert.equal(appendedScripts.length, 9, 'selectRun("latest") must re-trigger pollLiveRun');
    });

    it('computes #lbl-elapsed accurately from startedAt while running, freezes at updatedAt - startedAt when stopped, and displays 00:00 on missing/invalid timestamps', () => {
      let nowMs = Date.parse('2026-11-10T12:02:05.000Z');
      const { controller, getEl, domWin, tickIntervals } = createVisualizerHarness({
        nowFn: () => nowMs,
        win: {
          CouncilLatestLiveRun: {
            runId: 'run-timer',
            isRunning: true,
            startedAt: '2026-11-10T12:00:00.000Z',
            updatedAt: '2026-11-10T12:01:00.000Z',
            currentState: { topic: 'Timer Run', phase: 'reviewing', round: 1, seats: [] },
            steps: []
          },
          CouncilRuns: {
            'run-invalid-ts': {
              runId: 'run-invalid-ts',
              isRunning: false,
              startedAt: 'not-a-timestamp',
              updatedAt: 'also-invalid',
              currentState: { topic: 'Invalid TS', phase: 'completed', round: 1, seats: [] },
              steps: []
            },
            'run-missing-ts': {
              runId: 'run-missing-ts',
              isRunning: false,
              currentState: { topic: 'Missing TS', phase: 'completed', round: 1, seats: [] },
              steps: []
            },
            'run-historical-done': {
              runId: 'run-historical-done',
              isRunning: false,
              startedAt: '2026-11-10T09:00:00.000Z',
              updatedAt: '2026-11-10T09:03:19.000Z',
              currentState: { topic: 'Done Historical', phase: 'completed', round: 2, seats: [] },
              steps: []
            }
          }
        }
      });

      // Running: Date.now() (12:02:05) - startedAt (12:00:00) = 02:05 (NOT 00:00 from page load!)
      assert.equal(getEl('lbl-elapsed').textContent, '02:05');

      // Advance clock by 9 seconds while running
      nowMs = Date.parse('2026-11-10T12:02:14.000Z');
      tickIntervals();
      assert.equal(getEl('lbl-elapsed').textContent, '02:14');

      // Freeze when run finishes: updatedAt (12:01:45) - startedAt (12:00:00) = 01:45 regardless of later Date.now()
      domWin.CouncilLatestLiveRun = {
        ...domWin.CouncilLatestLiveRun,
        isRunning: false,
        updatedAt: '2026-11-10T12:01:45.000Z'
      };
      nowMs = Date.parse('2026-11-10T15:00:00.000Z');
      controller.renderAll();
      assert.equal(getEl('lbl-elapsed').textContent, '01:45');

      // Historical completed run shows frozen duration 03:19
      controller.selectRun('run-historical-done');
      assert.equal(getEl('lbl-elapsed').textContent, '03:19');

      // Invalid & missing timestamps display 00:00 (never NaN:NaN)
      controller.selectRun('run-invalid-ts');
      assert.equal(getEl('lbl-elapsed').textContent, '00:00');

      controller.selectRun('run-missing-ts');
      assert.equal(getEl('lbl-elapsed').textContent, '00:00');
    });
  });
});
