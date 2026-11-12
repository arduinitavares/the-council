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

function extractInlineStyleSource(html) {
  const match = html.match(/<style>([\s\S]*?)<\/style>/);
  assert.ok(match, 'index.html must contain an inline <style> sheet');
  return match[1];
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
 * Computes W3C Accessible Name for a button markup snippet by stripping
 * aria-hidden="true" subtrees, tags, and normalizing whitespace.
 */
function computeAccessibleTextFromMarkup(markup) {
  let cleaned = markup;
  // Iteratively strip leaf/nested elements carrying aria-hidden="true"
  let prev;
  do {
    prev = cleaned;
    cleaned = cleaned.replace(
      /<([a-zA-Z0-9-]+)\b[^>]*\baria-hidden\s*=\s*["']true["'][^>]*>(?:(?!<\1\b)[\s\S])*?<\/\1>/gi,
      ' '
    );
    cleaned = cleaned.replace(/<([a-zA-Z0-9-]+)\b[^>]*\baria-hidden\s*=\s*["']true["'][^>]*\/>/gi, ' ');
  } while (cleaned !== prev);

  return cleaned
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * WCAG 2.1 relative luminance & contrast ratio helpers.
 */
function parseHexRgb(hex) {
  const clean = String(hex).trim().replace(/^#/, '');
  if (clean.length === 3) {
    return [
      Number.parseInt(clean[0] + clean[0], 16),
      Number.parseInt(clean[1] + clean[1], 16),
      Number.parseInt(clean[2] + clean[2], 16)
    ];
  }
  assert.equal(clean.length, 6, `Expected 6-digit hex color, got ${hex}`);
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16)
  ];
}

function parseRgba(rgbaStr) {
  const m = String(rgbaStr)
    .trim()
    .match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)$/i);
  assert.ok(m, `Expected rgba(...) color, got ${rgbaStr}`);
  return {
    rgb: [Number(m[1]), Number(m[2]), Number(m[3])],
    alpha: Number(m[4])
  };
}

function compositeOver(fgRgbaStr, bgHex) {
  const { rgb: fg, alpha } = parseRgba(fgRgbaStr);
  const bg = parseHexRgb(bgHex);
  return [
    alpha * fg[0] + (1 - alpha) * bg[0],
    alpha * fg[1] + (1 - alpha) * bg[1],
    alpha * fg[2] + (1 - alpha) * bg[2]
  ];
}

function relativeLuminance([r, g, b]) {
  const toLinear = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [toLinear(r), toLinear(g), toLinear(b)];
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(rgbA, rgbB) {
  const l1 = relativeLuminance(rgbA);
  const l2 = relativeLuminance(rgbB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseRootCssTokens(css) {
  const rootMatch = css.match(/:root\s*\{([\s\S]*?)\}/);
  assert.ok(rootMatch, '<style> must contain a :root { ... } rule');
  const rootBody = rootMatch[1];
  const tokens = new Map();
  const props = new Map();
  for (const rawLine of rootBody.split(';')) {
    const line = rawLine.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (!line) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();
    if (key.startsWith('--')) {
      tokens.set(key, val);
    } else {
      props.set(key, val);
    }
  }
  return { tokens, props, rootBody };
}

function resolveTokenValue(name, tokens) {
  let val = tokens.get(name);
  assert.ok(val !== undefined, `Expected CSS custom property ${name} in :root`);
  let guard = 0;
  while (val.startsWith('var(') && guard++ < 8) {
    const inner = val.match(/^var\(\s*(--[a-zA-Z0-9-]+)\s*\)$/);
    assert.ok(inner, `Unsupported nested var() expression: ${val}`);
    val = tokens.get(inner[1]);
    assert.ok(val !== undefined, `Referenced token ${inner[1]} must exist in :root`);
  }
  return val;
}

/**
 * Deterministic mock DOM harness for Issue #80 accessibility & ARIA behavioral tests.
 */
function createA11yHarness({
  win = {},
  visualizer = CouncilVisualizerReal,
  minimalStub = false,
  nowFn = () => Date.now()
} = {}) {
  const html = readVisualizerHtml();
  const scriptBody = extractInlineControllerSource(html);

  const elements = new Map();
  const appendedScripts = [];
  const docListeners = new Map();
  let hidden = false;

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
        hidden: false,
        value: id === 'run-selector' ? 'latest' : '',
        className: '',
        style: {},
        querySelector: () => null
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
      value:
        id === 'run-selector'
          ? 'latest'
          : id === 'telemetry-group-by'
            ? 'model'
            : id === 'telemetry-window'
              ? 'all'
              : '',
      className: '',
      hidden: false,
      focusCalls: 0,
      style: {},
      dataset: {},
      children,
      options: children,
      innerHTMLWrites: 0,
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
        if (name === 'hidden') this.hidden = true;
        if (name.startsWith('data-')) {
          const camel = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          this.dataset[camel] = String(val);
        }
      },
      getAttribute(name) {
        return attrs.has(name) ? attrs.get(name) : null;
      },
      hasAttribute(name) {
        return attrs.has(name);
      },
      removeAttribute(name) {
        attrs.delete(name);
        if (name === 'hidden') this.hidden = false;
        if (name.startsWith('data-')) {
          const camel = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          delete this.dataset[camel];
        }
      },
      focus() {
        this.focusCalls += 1;
        mockDoc.activeElement = this;
      },
      appendChild(child) {
        children.push(child);
        return child;
      },
      removeChild(child) {
        const idx = children.indexOf(child);
        if (idx >= 0) children.splice(idx, 1);
        return child;
      },
      replaceChildren(...next) {
        children.length = 0;
        children.push(...next);
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      dispatchEvent(type, eventObj = {}) {
        const ev = eventObj && typeof eventObj === 'object' ? eventObj : {};
        if (!ev.target) ev.target = this;
        const handlers = listeners.get(type) || [];
        for (const fn of handlers) {
          fn.call(this, ev);
        }
        return ev;
      },
      querySelector(selector) {
        const stepMatch = selector.match(/^\[data-step-idx="(\d+)"\]$/);
        if (stepMatch) {
          const idx = stepMatch[1];
          if (rawHtml.includes(`data-step-idx="${idx}"`)) {
            if (!this._stepNodes) this._stepNodes = new Map();
            if (!this._stepNodes.has(idx)) {
              const rowNode = makeElement(`step-btn-${idx}`, 'BUTTON');
              rowNode.setAttribute('data-step-idx', idx);
              this._stepNodes.set(idx, rowNode);
            }
            return this._stepNodes.get(idx);
          }
        }
        return null;
      },
      remove() {
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
      const tag = id.endsWith('-svg')
        ? 'SVG'
        : id === 'timeline-list'
          ? 'OL'
          : ['clauses-list', 'objections-list', 'seats-grid', 'proofs-list'].includes(id)
            ? 'UL'
            : id.startsWith('btn-')
              ? 'BUTTON'
              : id.includes('selector') || id.startsWith('telemetry-group') || id.startsWith('telemetry-window')
                ? 'SELECT'
                : id === 'lbl-elapsed'
                  ? 'TIME'
                  : 'DIV';
      elements.set(id, makeElement(id, tag));
    }
    return elements.get(id);
  }

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
    'graphs-tablist',
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
        head: {
          appendChild: (el) => {
            if (el.id) elements.set(el.id, el);
            appendedScripts.push(el);
          }
        }
      };

  const fakeDate = Object.assign(
    function (...args) {
      return new Date(...args);
    },
    {
      now: () => nowFn(),
      parse: (s) => Date.parse(s)
    }
  );

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
    `${scriptBody}
    return {
      renderAll,
      renderTelemetryLeaderboard,
      updateRunSelector,
      updateElapsedTimer,
      selectRun,
      startLiveFollow,
      stopLiveFollow,
      toggleLiveFollow,
      switchGraphTab,
      inspectStep,
      restoreLatestSnapshot,
      getInternalState: () => ({
        liveFollowActive,
        activeGraphTab,
        currentStepIdx,
        selectedRunId
      })
    };`
  );

  const api = controllerFn(
    domWin,
    domWin,
    mockDoc,
    visualizer,
    () => ({ id: 1, unref() {} }),
    () => {},
    () => ({ id: 2, unref() {} }),
    () => {},
    fakeDate
  );

  return {
    api,
    win: domWin,
    doc: mockDoc,
    getEl,
    appendedScripts
  };
}

function makeSampleRun({ isRunning = true } = {}) {
  return {
    runId: 'run-issue-80',
    startedAt: '2026-11-10T10:00:00.000Z',
    updatedAt: '2026-11-10T10:02:15.000Z',
    isRunning,
    steps: [
      {
        label: 'Round 1: Independent proofs collected',
        stateSnapshot: {
          topic: 'Accessible Visualizer Step 1',
          phase: 'proving',
          round: 1,
          maxRounds: 3,
          minQuorum: 2,
          seats: [],
          proofs: [],
          objections: [],
          history: ['Step 1 snapshot']
        },
        graph: { nodes: [], edges: [], activeNodeId: 'proving', outgoingEdges: [], causalLinks: [] }
      },
      {
        label: 'Round 1: Candidate synthesis drafted',
        stateSnapshot: {
          topic: 'Accessible Visualizer Step 2',
          phase: 'critiquing',
          round: 1,
          maxRounds: 3,
          minQuorum: 2,
          seats: [],
          proofs: [],
          objections: [],
          history: ['Step 2 snapshot']
        },
        graph: { nodes: [], edges: [], activeNodeId: 'critiquing', outgoingEdges: [], causalLinks: [] }
      }
    ],
    currentState: {
      topic: 'Verify Issue #80 ARIA, Tables, Lists & Dark Contrast',
      phase: isRunning ? 'critiquing' : 'completed',
      round: 1,
      maxRounds: 3,
      minQuorum: 2,
      maxRetriesPerSeat: 2,
      verdict: isRunning
        ? null
        : { kind: 'Unanimous Consensus', note: 'All WCAG AA checks passed.' },
      candidate: {
        summary: 'Proof-bound synthesis ready.',
        clauses: [
          {
            id: 'C1',
            context: 'Interactive tabs and toggles',
            conclusion: 'Synchronize ARIA states and keyboard roving tabindex.',
            citedProofIds: ['P1', 'P2']
          }
        ]
      },
      lastTransition: { message: 'Entered critiquing phase.' },
      history: ['Preflight passed', 'Entered critiquing phase'],
      objections: [
        {
          id: 'OBJ-1',
          seatId: 'seat-2',
          status: 'open',
          reason: 'Verify excused card contrast without opacity.',
          proofId: 'P2'
        },
        {
          id: 'OBJ-2',
          seatId: 'seat-3',
          status: 'preserved_excused',
          reason: 'Locked objection from excused seat.',
          proofId: 'P3'
        }
      ],
      judge: {
        id: 'judge-1',
        harness: 'codex',
        model: 'gpt-5.4',
        status: 'thinking',
        soul: { name: 'Arbiter', lens: 'Evidence Gate', temperament: 'Rigorous' }
      },
      seats: [
        {
          id: 'seat-1',
          harness: 'antigravity',
          model: 'gemini-3.1-pro',
          status: 'accepted',
          retries: 0,
          soul: { name: 'Accessibility Lead', lens: 'WCAG 2.1 AA', temperament: 'Methodical' }
        },
        {
          id: 'seat-2',
          harness: 'cursor',
          model: 'grok-4',
          status: 'excused',
          retries: 2,
          excusedReason: 'Provider quota exhausted',
          soul: { name: 'Systems Auditor', lens: 'Runtime Safety', temperament: 'Direct' }
        }
      ],
      proofs: [
        { id: 'P1', seatId: 'seat-1', status: 'admitted', kind: 'code', scope: 'src/visualizer/index.html', source: 'spec', statement: 'Tabs expose role=tab.' },
        { id: 'P2', seatId: 'seat-1', status: 'partially_admitted', kind: 'contrast', scope: ':root', statement: 'Muted text >= 4.5:1.', judgeAdmittedStatement: '5.52:1 on --bg-elevated' },
        { id: 'P3', seatId: 'seat-2', status: 'rejected', kind: 'claim', scope: 'css', statement: 'Opacity 0.55 passes.', judgeNote: 'Fails WCAG 1.4.3.' },
        { id: 'P4', seatId: 'seat-2', status: 'pending', kind: 'note', scope: 'dom', statement: 'Pending review.' }
      ],
      graph: { nodes: [], edges: [], activeNodeId: 'critiquing', outgoingEdges: [], causalLinks: [] }
    }
  };
}

describe('Issue #80 — Criterion 1: #btn-live-follow ARIA toggle state & clean accessible name', () => {
  it('exposes clean accessible name "Live Follow" without contradictory ON/OFF text while keeping visual status label', () => {
    const html = readVisualizerHtml();
    const btnMatch = html.match(/<button\b[^>]*\bid="btn-live-follow"[^>]*>([\s\S]*?)<\/button>/);
    assert.ok(btnMatch, '#btn-live-follow <button> must exist in static HTML');
    const fullBtnTag = btnMatch[0];
    const innerMarkup = btnMatch[1];

    assert.match(fullBtnTag, /\btype="button"/, '#btn-live-follow must specify type="button"');
    assert.match(fullBtnTag, /\baria-pressed="true"/, '#btn-live-follow must initialize aria-pressed="true"');
    assert.match(
      innerMarkup,
      /<svg\b[^>]*\baria-hidden="true"/,
      'Decorative icon inside #btn-live-follow must have aria-hidden="true"'
    );
    assert.match(
      innerMarkup,
      /<span\b[^>]*\bid="btn-live-follow-label"[^>]*\baria-hidden="true"[^>]*>Live Follow: ON \(1s\)<\/span>/,
      '#btn-live-follow-label must remain visually present with aria-hidden="true"'
    );

    const accName = computeAccessibleTextFromMarkup(innerMarkup);
    assert.equal(accName, 'Live Follow', 'Accessible name must be exactly "Live Follow"');
    assert.doesNotMatch(accName, /\b(ON|OFF|1s)\b/i, 'Accessible name must not embed ON/OFF toggle state');
  });

  it('synchronizes aria-pressed="true" and aria-pressed="false" across start, stop, toggle, run switching, and run completion', () => {
    const liveRun = makeSampleRun({ isRunning: true });
    const historicRun = makeSampleRun({ isRunning: false });
    const h = createA11yHarness({
      win: {
        CouncilLatestLiveRun: liveRun,
        CouncilRuns: { 'run-historic': historicRun },
        CouncilRunIndex: [{ runId: 'run-historic', topic: 'Historic', isRunning: false, verdictKind: 'CONSENSUS' }]
      }
    });

    const btn = h.getEl('btn-live-follow');
    const lbl = h.getEl('btn-live-follow-label');
    assert.equal(btn.getAttribute('aria-pressed'), 'true');
    assert.equal(lbl.textContent, 'Live Follow: ON (1s)');

    // Click to toggle OFF
    btn.dispatchEvent('click');
    assert.equal(btn.getAttribute('aria-pressed'), 'false');
    assert.equal(btn.classList.contains('active'), false);
    assert.equal(lbl.textContent, 'Live Follow: OFF');

    // Click to toggle back ON
    btn.dispatchEvent('click');
    assert.equal(btn.getAttribute('aria-pressed'), 'true');
    assert.equal(btn.classList.contains('active'), true);
    assert.equal(lbl.textContent, 'Live Follow: ON (1s)');

    // Selecting a historical run stops Live Follow and sets aria-pressed="false"
    h.api.selectRun('run-historic');
    assert.equal(btn.getAttribute('aria-pressed'), 'false');
    assert.equal(lbl.textContent, 'Live Follow: OFF');

    // Selecting "latest" resumes Live Follow and sets aria-pressed="true"
    h.api.selectRun('latest');
    assert.equal(btn.getAttribute('aria-pressed'), 'true');

    // Initial boot when latest run is already completed enters Idle Watch Mode (aria-pressed="true", Live Follow: ON (Idle))
    const completedHarness = createA11yHarness({
      win: { CouncilLatestLiveRun: makeSampleRun({ isRunning: false }) }
    });
    assert.equal(completedHarness.getEl('btn-live-follow').getAttribute('aria-pressed'), 'true');
    assert.equal(completedHarness.getEl('btn-live-follow-label').textContent, 'Live Follow: ON (Idle)');
    completedHarness.getEl('btn-live-follow').dispatchEvent('click');
    assert.equal(completedHarness.getEl('btn-live-follow').getAttribute('aria-pressed'), 'false');
    assert.equal(completedHarness.getEl('btn-live-follow-label').textContent, 'Live Follow: OFF');
  });

  it('synchronizes aria-pressed via property fallback on minimal mock DOM stubs lacking setAttribute', () => {
    const h = createA11yHarness({
      minimalStub: true,
      win: { CouncilLatestLiveRun: makeSampleRun({ isRunning: true }) }
    });
    const btn = h.getEl('btn-live-follow');
    assert.equal(btn['aria-pressed'], 'true');

    h.api.stopLiveFollow();
    assert.equal(btn['aria-pressed'], 'false');

    h.api.startLiveFollow();
    assert.equal(btn['aria-pressed'], 'true');
  });
});

describe('Issue #80 — Criterion 2: Deliberation Graphs ARIA tablist, tabpanels, keyboard roving focus & Forced Colors indicator', () => {
  it('declares accessible tablist, tab, and tabpanel markup without aria-controls or inline display:none', () => {
    const html = readVisualizerHtml();

    assert.doesNotMatch(html, /\baria-controls\s*=/i, 'Tabs must NOT declare aria-controls');
    assert.match(
      html,
      /<h2\s+id="heading-graphs"\s+class="sr-only">Deliberation Graphs<\/h2>/,
      'Must preserve #heading-graphs .sr-only heading for tablist labelling'
    );
    assert.match(
      html,
      /<div\b[^>]*\bid="graphs-tablist"[^>]*\bclass="tabs-header"[^>]*\brole="tablist"[^>]*\baria-labelledby="heading-graphs"/,
      '.tabs-header must expose role="tablist" aria-labelledby="heading-graphs"'
    );
    assert.match(
      html,
      /<button\b[^>]*\btype="button"[^>]*\bid="btn-tab-topology"[^>]*\brole="tab"[^>]*\baria-selected="true"[^>]*\btabindex="0"/,
      '#btn-tab-topology must have type="button" role="tab" aria-selected="true" tabindex="0"'
    );
    assert.match(
      html,
      /<button\b[^>]*\btype="button"[^>]*\bid="btn-tab-causal"[^>]*\brole="tab"[^>]*\baria-selected="false"[^>]*\btabindex="-1"/,
      '#btn-tab-causal must have type="button" role="tab" aria-selected="false" tabindex="-1"'
    );

    const topoPanel = html.match(/<div\b[^>]*\bid="stage-topology"[^>]*>/);
    const causalPanel = html.match(/<div\b[^>]*\bid="stage-causal"[^>]*>/);
    assert.ok(topoPanel && causalPanel, 'Both graph stage panels must exist');

    assert.match(topoPanel[0], /\brole="tabpanel"/);
    assert.match(topoPanel[0], /\baria-labelledby="btn-tab-topology"/);
    assert.match(topoPanel[0], /\btabindex="0"/);
    assert.doesNotMatch(topoPanel[0], /\bhidden\b/);

    assert.match(causalPanel[0], /\brole="tabpanel"/);
    assert.match(causalPanel[0], /\baria-labelledby="btn-tab-causal"/);
    assert.match(causalPanel[0], /\bhidden\b/);
    assert.doesNotMatch(causalPanel[0], /display\s*:\s*none/i);
  });

  it('styles [role="tab"][aria-selected="true"] with a non-color ::after border-block-end indicator and Forced Colors Highlight', () => {
    const css = extractInlineStyleSource(readVisualizerHtml());
    assert.match(
      css,
      /\[role="tab"\]\[aria-selected="true"\]::after\s*\{[\s\S]*?border-block-end:\s*2px\s+solid\s+currentColor/,
      'Selected tab must render a ::after border-block-end underline indicator'
    );
    assert.match(
      css,
      /@media\s*\(\s*forced-colors:\s*active\s*\)\s*\{[\s\S]*?\[role="tab"\]\[aria-selected="true"\][\s\S]*?Highlight/,
      'Selected tab must remain visible in Forced Colors Mode using Highlight system color'
    );
  });

  it('toggles aria-selected, roving tabindex, panel hidden state, panel tabindex, and lazy SVG rendering on click and ArrowLeft/ArrowRight/Home/End', () => {
    let stateSvgRenders = 0;
    let causalSvgRenders = 0;
    const customVis = {
      ...CouncilVisualizerReal,
      renderStateMachineSVG(el) {
        stateSvgRenders += 1;
        el.innerHTML = '<g id="topo-graph"></g>';
      },
      renderCausalDependencySVG(el) {
        causalSvgRenders += 1;
        el.innerHTML = '<g id="causal-graph"></g>';
      }
    };

    const h = createA11yHarness({
      visualizer: customVis,
      win: { CouncilLatestLiveRun: makeSampleRun({ isRunning: true }) }
    });

    const tablist = h.getEl('graphs-tablist');
    const btnTopo = h.getEl('btn-tab-topology');
    const btnCausal = h.getEl('btn-tab-causal');
    const stageTopo = h.getEl('stage-topology');
    const stageCausal = h.getEl('stage-causal');

    // Initial state: topology selected, causal hidden & lazily unrendered
    assert.equal(btnTopo.getAttribute('aria-selected'), 'true');
    assert.equal(btnTopo.getAttribute('tabindex'), '0');
    assert.equal(btnCausal.getAttribute('aria-selected'), 'false');
    assert.equal(btnCausal.getAttribute('tabindex'), '-1');
    assert.equal(stageTopo.hidden, false);
    assert.equal(stageTopo.hasAttribute('hidden'), false);
    assert.equal(stageTopo.getAttribute('tabindex'), '0');
    assert.equal(stageCausal.hidden, true);
    assert.equal(stageCausal.hasAttribute('hidden'), true);
    assert.equal(stageCausal.getAttribute('tabindex'), null);
    assert.equal(stateSvgRenders, 1);
    assert.equal(causalSvgRenders, 0);

    // ArrowRight on topology tab -> switches to causal, prevents default, focuses causal tab, lazily renders causal SVG
    let prevented = false;
    const rightEv = {
      key: 'ArrowRight',
      target: btnTopo,
      preventDefault() {
        prevented = true;
      }
    };
    btnTopo.dispatchEvent('keydown', rightEv);
    // Simulate bubbling to tablist with the same event object — must NOT double-toggle back to topology
    tablist.dispatchEvent('keydown', rightEv);

    assert.equal(prevented, true);
    assert.equal(h.doc.activeElement, btnCausal);
    assert.equal(btnCausal.focusCalls, 1);
    assert.equal(btnCausal.getAttribute('aria-selected'), 'true');
    assert.equal(btnCausal.getAttribute('tabindex'), '0');
    assert.equal(btnTopo.getAttribute('aria-selected'), 'false');
    assert.equal(btnTopo.getAttribute('tabindex'), '-1');
    assert.equal(stageCausal.hidden, false);
    assert.equal(stageCausal.hasAttribute('hidden'), false);
    assert.equal(stageCausal.getAttribute('tabindex'), '0');
    assert.equal(stageTopo.hidden, true);
    assert.equal(stageTopo.hasAttribute('hidden'), true);
    assert.equal(stageTopo.getAttribute('tabindex'), null);
    assert.equal(causalSvgRenders, 1);

    // ArrowRight on last tab wraps around to first tab (topology)
    btnCausal.dispatchEvent('keydown', { key: 'ArrowRight', target: btnCausal, preventDefault() {} });
    assert.equal(h.doc.activeElement, btnTopo);
    assert.equal(btnTopo.getAttribute('aria-selected'), 'true');
    assert.equal(stageTopo.hidden, false);
    assert.equal(stageCausal.hidden, true);

    // ArrowLeft on first tab wraps around to last tab (causal)
    btnTopo.dispatchEvent('keydown', { key: 'ArrowLeft', target: btnTopo, preventDefault() {} });
    assert.equal(h.doc.activeElement, btnCausal);
    assert.equal(btnCausal.getAttribute('aria-selected'), 'true');

    // Home jumps to first tab; End jumps to last tab
    btnCausal.dispatchEvent('keydown', { key: 'Home', target: btnCausal, preventDefault() {} });
    assert.equal(h.doc.activeElement, btnTopo);
    assert.equal(btnTopo.getAttribute('aria-selected'), 'true');

    btnTopo.dispatchEvent('keydown', { key: 'End', target: btnTopo, preventDefault() {} });
    assert.equal(h.doc.activeElement, btnCausal);
    assert.equal(btnCausal.getAttribute('aria-selected'), 'true');

    // Unrelated keys or modifier combos are ignored
    let tabKeyPrevented = false;
    btnCausal.dispatchEvent('keydown', {
      key: 'Tab',
      target: btnCausal,
      preventDefault() {
        tabKeyPrevented = true;
      }
    });
    assert.equal(tabKeyPrevented, false);

    // Minimal stub fallback keeps boolean .hidden accurate without setAttribute/removeAttribute
    const stubH = createA11yHarness({
      minimalStub: true,
      visualizer: customVis,
      win: { CouncilLatestLiveRun: makeSampleRun({ isRunning: true }) }
    });
    assert.equal(stubH.getEl('stage-topology').hidden, false);
    assert.equal(stubH.getEl('stage-causal').hidden, true);
    stubH.api.switchGraphTab('causal');
    assert.equal(stubH.getEl('stage-topology').hidden, true);
    assert.equal(stubH.getEl('stage-causal').hidden, false);
  });
});

describe('Issue #80 — Criterion 3: Semantic buttons, lists (<ol>/<ul>), landmarks, <time>, SVGs, skip-link & <select> labels', () => {
  it('sets type="button" on every static and dynamically rendered <button>', () => {
    const html = readVisualizerHtml();
    const htmlWithoutScript = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    const staticButtons = [...htmlWithoutScript.matchAll(/<button\b([^>]*)>/gi)];
    assert.ok(staticButtons.length >= 4, 'Expected at least 4 static <button> elements');
    for (const m of staticButtons) {
      assert.match(m[1], /\btype="button"/, `Static <button${m[1]}> must declare type="button"`);
    }

    const h = createA11yHarness({
      win: { CouncilLatestLiveRun: makeSampleRun({ isRunning: true }) }
    });
    const timelineMarkup = h.getEl('timeline-list').innerHTML;
    const dynamicButtons = [...timelineMarkup.matchAll(/<button\b([^>]*)>/gi)];
    assert.equal(dynamicButtons.length, 2, 'Expected 2 timeline step <button> elements');
    for (const m of dynamicButtons) {
      assert.match(m[1], /\btype="button"/, `Rendered <button${m[1]}> must declare type="button"`);
    }
  });

  it('renders #timeline-list as <ol role="list"> with native <li><button type="button"> items, aria-current="step", and preserved focus', () => {
    const html = readVisualizerHtml();
    assert.match(
      html,
      /<ol\b[^>]*\bid="timeline-list"[^>]*\bclass="timeline-list"[^>]*\brole="list"[^>]*><\/ol>/,
      '#timeline-list must be an <ol class="timeline-list" role="list">'
    );

    const liveRun = makeSampleRun({ isRunning: true });
    const h = createA11yHarness({ win: { CouncilLatestLiveRun: liveRun } });
    const timelineEl = h.getEl('timeline-list');

    // Before inspecting a specific step (currentStepIdx === -1), no button has aria-current="step"
    assert.match(timelineEl.innerHTML, /^<li><button type="button" class="timeline-row"/);
    assert.doesNotMatch(timelineEl.innerHTML, /aria-current="step"/);
    assert.doesNotMatch(timelineEl.innerHTML, /<div\b[^>]*role="button"/i);

    // Clicking step 0 activates inspectStep(0) and marks step 0 with aria-current="step"
    timelineEl.dispatchEvent('click', {
      target: {
        getAttribute: () => null,
        parentElement: { getAttribute: (n) => (n === 'data-step-idx' ? '0' : null) }
      }
    });
    assert.equal(h.api.getInternalState().currentStepIdx, 0);
    assert.match(
      timelineEl.innerHTML,
      /<button type="button" class="timeline-row active" aria-current="step" data-step-idx="0">/
    );
    assert.doesNotMatch(
      timelineEl.innerHTML,
      /aria-current="step"[^>]*data-step-idx="1"/
    );

    // Focus on step 0 button survives a new step arriving on the next poll tick
    const step0Btn = timelineEl.querySelector('[data-step-idx="0"]');
    step0Btn.focus();
    assert.equal(h.doc.activeElement, step0Btn);

    liveRun.steps.push({
      label: 'Round 2: Consensus reached',
      stateSnapshot: liveRun.currentState,
      graph: liveRun.currentState.graph
    });
    h.api.renderAll();
    assert.equal(h.doc.activeElement.getAttribute('data-step-idx'), '0');
    assert.ok(step0Btn.focusCalls >= 2, 'Timeline rebuild must restore focus to the active step button');

    // Jump to Latest clears aria-current="step"
    h.getEl('btn-jump-latest').dispatchEvent('click');
    assert.equal(h.api.getInternalState().currentStepIdx, -1);
    assert.doesNotMatch(timelineEl.innerHTML, /aria-current="step"/);

    // History fallback (when steps is empty) renders semantic <li> items inside <ol>
    const historyOnlyRun = makeSampleRun({ isRunning: true });
    historyOnlyRun.steps = [];
    const hFallback = createA11yHarness({ win: { CouncilLatestLiveRun: historyOnlyRun } });
    assert.match(hFallback.getEl('timeline-list').innerHTML, /^<li class="timeline-row timeline-row-static">/);
  });

  it('uses semantic <ul role="list"> and <li> items for clauses, objections, roster seats, and proofs across empty and populated states', () => {
    const html = readVisualizerHtml();
    const css = extractInlineStyleSource(html);

    assert.match(css, /ul\[role="list"\],\s*ol\[role="list"\]\s*\{[\s\S]*?list-style:\s*none/);
    for (const id of ['clauses-list', 'objections-list', 'seats-grid', 'proofs-list']) {
      assert.match(
        html,
        new RegExp(`<ul\\b[^>]*\\bid="${id}"[^>]*\\brole="list"`),
        `#${id} must be a semantic <ul role="list">`
      );
    }

    // Populated state
    const hPopulated = createA11yHarness({
      win: { CouncilLatestLiveRun: makeSampleRun({ isRunning: true }) }
    });
    assert.match(hPopulated.getEl('clauses-list').innerHTML.trim(), /^<li\b[\s\S]*<\/li>$/);
    assert.match(hPopulated.getEl('objections-list').innerHTML.trim(), /^<li\b[\s\S]*<\/li>$/);
    assert.match(hPopulated.getEl('seats-grid').innerHTML.trim(), /^<li\b[\s\S]*<\/li>$/);
    assert.match(hPopulated.getEl('proofs-list').innerHTML.trim(), /^<li\b[\s\S]*<\/li>$/);

    // Empty councilState fallback
    const hEmpty = createA11yHarness({ win: {} });
    assert.match(hEmpty.getEl('clauses-list').innerHTML.trim(), /^<li\b[\s\S]*<\/li>$/);
    assert.match(hEmpty.getEl('objections-list').innerHTML.trim(), /^<li\b[\s\S]*<\/li>$/);
    assert.match(hEmpty.getEl('proofs-list').innerHTML.trim(), /^<li\b[\s\S]*<\/li>$/);
  });

  it('removes redundant role="banner", uses <time id="lbl-elapsed"> with ISO duration, sets skip-link to #heading-topic, hides decorative SVGs, and uses single <label for> per <select>', () => {
    const html = readVisualizerHtml();

    // Header has no redundant role="banner"
    const headerTag = html.match(/<header\b[^>]*>/);
    assert.ok(headerTag, '<header> must exist');
    assert.doesNotMatch(headerTag[0], /\brole\s*=/i, '<header> must omit redundant role="banner"');

    // <time id="lbl-elapsed"> in HTML + dynamic datetime attribute update
    assert.match(html, /<time\b[^>]*\bid="lbl-elapsed"[^>]*>00:00<\/time>/);
    const fixedNow = Date.parse('2026-11-10T10:02:15.000Z');
    const h = createA11yHarness({
      nowFn: () => fixedNow,
      win: { CouncilLatestLiveRun: makeSampleRun({ isRunning: true }) }
    });
    assert.equal(h.getEl('lbl-elapsed').textContent, '02:15');
    assert.equal(h.getEl('lbl-elapsed').getAttribute('datetime'), 'PT2M15S');

    // Skip link targets <h1 id="heading-topic" tabindex="-1">
    assert.match(html, /<a\s+href="#heading-topic"\s+class="skip-link">/);
    assert.match(html, /<h1\b[^>]*\bid="heading-topic"[^>]*\btabindex="-1"[^>]*>/);

    // Decorative icon SVGs have aria-hidden="true"; graph SVGs retain role="img" + aria-label
    const iconSvgs = [...html.matchAll(/<svg\b[^>]*\bclass="icon-svg"[^>]*>/g)];
    assert.equal(iconSvgs.length, 2, 'Expected 2 decorative .icon-svg icons');
    for (const m of iconSvgs) {
      assert.match(m[0], /\baria-hidden="true"/, `Decorative SVG ${m[0]} must set aria-hidden="true"`);
    }
    assert.match(html, /<svg\b[^>]*\bid="state-machine-svg"[^>]*\brole="img"[^>]*\baria-label="[^"]+"/);
    assert.match(html, /<svg\b[^>]*\bid="causal-dependency-svg"[^>]*\brole="img"[^>]*\baria-label="[^"]+"/);

    // Every <select> has exactly one <label for="..."> and zero aria-label attributes
    for (const selectId of ['run-selector', 'telemetry-group-by', 'telemetry-window']) {
      const labelMatches = [...html.matchAll(new RegExp(`<label\\b[^>]*\\bfor="${selectId}"[^>]*>([\\s\\S]*?)<\\/label>`, 'g'))];
      assert.equal(labelMatches.length, 1, `#${selectId} must have exactly one <label for="${selectId}">`);
      assert.ok(labelMatches[0][1].trim().length > 0, `<label for="${selectId}"> must contain descriptive text`);

      const selectTag = html.match(new RegExp(`<select\\b[^>]*\\bid="${selectId}"[^>]*>`));
      assert.ok(selectTag, `<select id="${selectId}"> must exist`);
      assert.doesNotMatch(selectTag[0], /\baria-label\s*=/i, `#${selectId} must not duplicate its <label> with aria-label`);
    }
  });
});

describe('Issue #80 — Criterion 4: Accessible Telemetry Leaderboard <table>, scopes, scrollable region & title-free badges', () => {
  it('exposes keyboard-scrollable region on #telemetry-leaderboard-body and renders caption, scope="col", scope="row", and keyboard-accessible badge text without title attributes', () => {
    const html = readVisualizerHtml();
    assert.doesNotMatch(html, /\s+title\s*=/i, 'Static HTML and inline templates must not rely on title= tooltips');

    const regionMatch = html.match(/<div\b[^>]*\bid="telemetry-leaderboard-body"[^>]*>/);
    assert.ok(regionMatch, '#telemetry-leaderboard-body must exist');
    assert.match(regionMatch[0], /\brole="region"/);
    assert.match(regionMatch[0], /\baria-labelledby="heading-telemetry-leaderboard"/);
    assert.match(regionMatch[0], /\btabindex="0"/);

    // Verify standalone extracted renderTelemetryLeaderboard() as well as full controller
    const fnSource = extractStandaloneLeaderboardFn(html);
    const bodyEl = { innerHTML: '', _lastSig: null };
    const runsLblEl = { textContent: '' };
    const groupBySel = { value: 'model' };
    const windowSel = { value: 'all' };

    const summary = {
      totalRuns: 4,
      windows: {
        all: {
          totalRuns: 4,
          byModel: [
            {
              key: 'gemini-3.1-pro',
              seatIds: ['seat-1'],
              runs: 4,
              proofsSubmitted: 6,
              guardRejectedProofs: 2,
              explicitlyAdmitted: 5,
              explicitAdmissionRate: 83.3,
              partiallyAdmitted: 1,
              partialAdmissionRate: 16.7,
              defaultAdmitted: 0,
              judgeRejected: 0,
              judgeRejectionRate: 0,
              finalClauseCitations: 4,
              finalClauseCitationRate: 66.7,
              excusedRuns: 0,
              excusedRate: 0,
              observedToolCalls: null,
              traceCoverage: { unavailableRuns: 4, fullRuns: 0, partialRuns: 0 },
              skillsRead: [
                { skill: 'ask-council', count: 2, evidence: 'skill_instructions_read' }
              ]
            }
          ],
          bySeat: [
            {
              key: 'seat-1',
              models: ['gemini-3.1-pro'],
              runs: 4,
              proofsSubmitted: 6,
              guardRejectedProofs: 0,
              explicitlyAdmitted: 5,
              explicitAdmissionRate: 83.3,
              partiallyAdmitted: 1,
              partialAdmissionRate: 16.7,
              defaultAdmitted: 0,
              judgeRejected: 1,
              judgeRejectionRate: 16.7,
              finalClauseCitations: 4,
              finalClauseCitationRate: 66.7,
              excusedRuns: 1,
              excusedRate: 25,
              observedToolCalls: 9,
              traceCoverage: { unavailableRuns: 0, fullRuns: 3, partialRuns: 1 },
              skillsRead: []
            }
          ]
        }
      }
    };

    const runExtracted = new Function(
      'window',
      'globalThis',
      'document',
      'CouncilVisualizer',
      `${fnSource}\nreturn renderTelemetryLeaderboard;`
    )(
      { CouncilTelemetrySummary: summary },
      { CouncilTelemetrySummary: summary },
      {
        getElementById(id) {
          if (id === 'telemetry-leaderboard-body') return bodyEl;
          if (id === 'lbl-telemetry-runs') return runsLblEl;
          if (id === 'telemetry-group-by') return groupBySel;
          if (id === 'telemetry-window') return windowSel;
          return null;
        }
      },
      CouncilVisualizerReal
    );

    runExtracted();
    const modelTable = bodyEl.innerHTML;

    assert.match(modelTable, /<table\b[^>]*\baria-labelledby="heading-telemetry-leaderboard"/);
    assert.match(modelTable, /<caption class="sr-only">Cross-Run Voter &amp; Tool Telemetry Leaderboard<\/caption>/);
    assert.doesNotMatch(modelTable, /\btitle\s*=/i, 'Rendered leaderboard HTML must not contain title= attributes');

    const theadMatch = modelTable.match(/<thead>([\s\S]*?)<\/thead>/);
    assert.ok(theadMatch, 'Leaderboard table must have <thead>');
    const colHeaders = [...theadMatch[1].matchAll(/<th\b([^>]*)>([\s\S]*?)<\/th>/g)];
    assert.equal(colHeaders.length, 10, 'Expected all 10 leaderboard column headers');
    assert.equal(colHeaders[0][2], 'Canonical Model');
    for (const th of colHeaders) {
      assert.match(th[1], /\bscope="col"/, `Column header "${th[2]}" must specify scope="col"`);
    }

    const tbodyMatch = modelTable.match(/<tbody>([\s\S]*?)<\/tbody>/);
    assert.ok(tbodyMatch, 'Leaderboard table must have <tbody>');
    const bodyRows = [...tbodyMatch[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)];
    assert.equal(bodyRows.length, 1);
    assert.match(
      bodyRows[0][1].trim(),
      /^<th\s+scope="row"[^>]*>gemini-3\.1-pro/,
      'First cell of each body row must be <th scope="row">'
    );

    // Keyboard/screen-reader accessible badge context without title tooltips
    assert.match(modelTable, /\+2 guard-rejected<span class="sr-only"> proof attempts<\/span>/);
    assert.match(
      modelTable,
      /Trace N\/A<span class="sr-only"> \(provider CLI does not expose tool event telemetry\)<\/span>/
    );
    assert.match(
      modelTable,
      /ask-council \(2 · skill_instructions_read\)<span class="sr-only"> — verified via skill_instructions_read<\/span>/
    );

    // Switch to group-by seat: column 0 updates to "Seat ID" with scope="col" and row key uses <th scope="row">
    groupBySel.value = 'seat';
    runExtracted();
    assert.match(bodyEl.innerHTML, /<th scope="col"[^>]*>Seat ID<\/th>/);
    assert.match(bodyEl.innerHTML, /<th scope="row"[^>]*>seat-1/);
  });
});

describe('Issue #80 — Criterion 5: Dark-theme tokens, computed WCAG 2.1 AA contrast, target sizes, scrollbars & CSS hygiene', () => {
  it('declares color-scheme: dark, defines --bg-elevated, and leaves zero undefined var(--*) CSS tokens in index.html', () => {
    const html = readVisualizerHtml();
    const css = extractInlineStyleSource(html);
    const { tokens, props } = parseRootCssTokens(css);

    assert.match(html, /<meta\s+name="color-scheme"\s+content="dark"\s*\/?>/);
    assert.equal(props.get('color-scheme'), 'dark', ':root must declare color-scheme: dark');
    assert.ok(tokens.has('--bg-elevated'), ':root must define --bg-elevated');

    const referencedVars = new Set([...html.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*\)/g)].map((m) => m[1]));
    assert.ok(referencedVars.has('--bg-elevated'), 'index.html should reference var(--bg-elevated)');
    for (const varName of referencedVars) {
      assert.ok(tokens.has(varName), `Referenced CSS custom property ${varName} must be defined in :root`);
    }
  });

  it('achieves WCAG 2.1 AA >= 4.5:1 contrast for --text, --text-secondary, --text-muted, semantic accents, and Excused Seat cards (without opacity)', () => {
    const html = readVisualizerHtml();
    const css = extractInlineStyleSource(html);
    const { tokens } = parseRootCssTokens(css);

    const surfaceNames = [
      '--bg',
      '--surface',
      '--surface-excused',
      '--surface-raised',
      '--bg-elevated',
      '--surface-highlight'
    ];
    const textNames = [
      '--text',
      '--text-secondary',
      '--text-muted',
      '--accent',
      '--green',
      '--amber',
      '--red',
      '--purple'
    ];

    for (const surfaceToken of surfaceNames) {
      const surfaceHex = resolveTokenValue(surfaceToken, tokens);
      const surfaceRgb = parseHexRgb(surfaceHex);
      for (const textToken of textNames) {
        const textHex = resolveTokenValue(textToken, tokens);
        const ratio = contrastRatio(parseHexRgb(textHex), surfaceRgb);
        assert.ok(
          ratio >= 4.5,
          `${textToken} (${textHex}) on ${surfaceToken} (${surfaceHex}) must be >= 4.5:1, got ${ratio.toFixed(2)}:1`
        );
      }
    }

    // Verify alpha-composited *-soft badge backgrounds preserve >= 4.5:1 contrast for their foreground accents
    const softPairs = [
      ['--accent', '--accent-soft'],
      ['--green', '--green-soft'],
      ['--amber', '--amber-soft'],
      ['--red', '--red-soft'],
      ['--purple', '--purple-soft']
    ];
    for (const cardSurface of ['--surface', '--surface-raised', '--surface-excused']) {
      const bgHex = resolveTokenValue(cardSurface, tokens);
      for (const [fgToken, softToken] of softPairs) {
        const fgRgb = parseHexRgb(resolveTokenValue(fgToken, tokens));
        const compositedBg = compositeOver(resolveTokenValue(softToken, tokens), bgHex);
        const ratio = contrastRatio(fgRgb, compositedBg);
        assert.ok(
          ratio >= 4.5,
          `${fgToken} over ${softToken} on ${cardSurface} must be >= 4.5:1, got ${ratio.toFixed(2)}:1`
        );
      }
    }

    // Excused Seat card rule must NOT collapse contrast with opacity
    const excusedRule = css.match(/\.participant-card\.status-excused\s*\{([^}]*)\}/);
    assert.ok(excusedRule, '.participant-card.status-excused rule must exist');
    assert.doesNotMatch(excusedRule[1], /\bopacity\s*:/i, '.status-excused must not apply whole-card opacity');
    assert.match(excusedRule[1], /background:\s*var\(--surface-excused\)/);
    assert.match(excusedRule[1], /border-style:\s*dashed/);

    // Skip link contrast >= 4.5:1
    const skipRatio = contrastRatio(
      parseHexRgb('#040910'),
      parseHexRgb(resolveTokenValue('--accent', tokens))
    );
    assert.ok(skipRatio >= 4.5, `.skip-link contrast must be >= 4.5:1, got ${skipRatio.toFixed(2)}:1`);
  });

  it('achieves WCAG 2.1 AA >= 3.0:1 non-text contrast for interactive borders and scrollbar thumbs, with scrollbar-width: auto and @supports fallback', () => {
    const css = extractInlineStyleSource(readVisualizerHtml());
    const { tokens, props } = parseRootCssTokens(css);

    const borderRgb = parseHexRgb(resolveTokenValue('--border', tokens));
    const thumbRgb = parseHexRgb(resolveTokenValue('--scrollbar-thumb', tokens));

    const containerSurfaces = [
      ['--bg', resolveTokenValue('--bg', tokens)],
      ['--surface', resolveTokenValue('--surface', tokens)],
      ['--surface-excused', resolveTokenValue('--surface-excused', tokens)],
      ['--surface-raised', resolveTokenValue('--surface-raised', tokens)],
      ['--bg-elevated', resolveTokenValue('--bg-elevated', tokens)],
      ['--surface-highlight', resolveTokenValue('--surface-highlight', tokens)],
      ['.graph-stage (#080d15)', '#080d15']
    ];

    for (const [label, hex] of containerSurfaces) {
      const bgRgb = parseHexRgb(hex);
      const borderRatio = contrastRatio(borderRgb, bgRgb);
      assert.ok(
        borderRatio >= 3.0,
        `--border against ${label} (${hex}) must be >= 3.0:1, got ${borderRatio.toFixed(2)}:1`
      );
      const thumbRatio = contrastRatio(thumbRgb, bgRgb);
      assert.ok(
        thumbRatio >= 3.0,
        `--scrollbar-thumb against ${label} (${hex}) must be >= 3.0:1, got ${thumbRatio.toFixed(2)}:1`
      );
    }

    // Interactive controls (button, .control-select, .timeline-row) must use var(--border), never var(--border-subtle)
    for (const selectorRegex of [
      /\n\s*button\s*\{([^}]*)\}/,
      /\.control-select\s*\{([^}]*)\}/,
      /\.timeline-row\s*\{([^}]*)\}/
    ]) {
      const rule = css.match(selectorRegex);
      assert.ok(rule, `Expected CSS rule matching ${selectorRegex}`);
      assert.match(rule[1], /border:\s*1px\s+solid\s+var\(--border\)/);
      assert.doesNotMatch(rule[1], /--border-subtle/);
    }

    // Standard scrollbar properties + @supports not (scrollbar-color: auto) guard
    assert.equal(props.get('scrollbar-color'), 'var(--scrollbar-thumb) var(--scrollbar-track)');
    assert.equal(props.get('scrollbar-width'), 'auto');
    assert.doesNotMatch(css, /scrollbar-width\s*:\s*thin/i, 'Must not shrink thumb targets with scrollbar-width: thin');
    assert.doesNotMatch(css, /transition[^;]*scrollbar-color/i, 'Must not animate/transition scrollbar-color');

    const supportsBlock = css.match(/@supports\s+not\s*\(\s*scrollbar-color:\s*auto\s*\)\s*\{([\s\S]*?\})\s*\}/);
    assert.ok(supportsBlock, '::-webkit-scrollbar rules must be wrapped in @supports not (scrollbar-color: auto)');
    assert.match(supportsBlock[1], /::-webkit-scrollbar\s*\{[\s\S]*?width:\s*10px;[\s\S]*?height:\s*10px;/);

    const cssWithoutSupports = css.replace(/@supports\s+not\s*\(\s*scrollbar-color:\s*auto\s*\)\s*\{[\s\S]*?\}\s*\}/, '');
    assert.doesNotMatch(
      cssWithoutSupports,
      /::-webkit-scrollbar/,
      'Legacy ::-webkit-scrollbar selectors must not appear outside @supports not (scrollbar-color: auto)'
    );
  });

  it('enforces >= 24x24 CSS px target size via min-block-size/min-inline-size, modernizes .sr-only, deduplicates h2, and extracts proof badge classes', () => {
    const html = readVisualizerHtml();
    const css = extractInlineStyleSource(html);
    const scriptBody = extractInlineControllerSource(html);

    // Target sizes >= 24x24 CSS pixels (and 44x44 on coarse pointers)
    assert.match(
      css,
      /button,\s*select\s*\{\s*min-block-size:\s*24px;\s*min-inline-size:\s*24px;\s*\}/,
      'button, select must enforce min-block-size: 24px and min-inline-size: 24px'
    );
    assert.match(
      css,
      /@media\s*\(\s*pointer:\s*coarse\s*\)\s*\{[\s\S]*?min-block-size:\s*44px;/,
      'Coarse pointer media query should enlarge interactive target size to 44px'
    );

    // Modernized .sr-only retaining exact `.sr-only {` selector
    const srOnlyRule = css.match(/\.sr-only\s*\{([^}]*)\}/);
    assert.ok(srOnlyRule, '.sr-only { ... } rule must exist');
    assert.match(srOnlyRule[1], /clip-path:\s*inset\(50%\)/);
    assert.doesNotMatch(srOnlyRule[1], /\bclip\s*:/, '.sr-only must not use deprecated clip: rect(...)');

    // Deduplicated h2 rule (no overwritten font-size or letter-spacing properties)
    const h2Rule = css.match(/\n\s*h2\s*\{([^}]*)\}/);
    assert.ok(h2Rule, 'h2 { ... } rule must exist');
    const seenH2Props = new Set();
    for (const stmt of h2Rule[1].split(';')) {
      const clean = stmt.trim();
      if (!clean) continue;
      const propName = clean.split(':')[0].trim();
      assert.equal(seenH2Props.has(propName), false, `Duplicate property "${propName}" found in h2 CSS rule`);
      seenH2Props.add(propName);
    }

    // Reusable proof-status badge CSS classes instead of inline style strings
    for (const cls of [
      'badge-proof-pending',
      'badge-proof-admitted',
      'badge-proof-partially_admitted',
      'badge-proof-rejected',
      'badge-seat-proof'
    ]) {
      assert.match(css, new RegExp(`\\.${cls}\\s*\\{`), `CSS must define .${cls}`);
    }
    assert.match(scriptBody, /function getProofBadgeClass\(status\)/);
    assert.doesNotMatch(scriptBody, /border:1px solid #d97706/, 'Proof badge styles should live in CSS classes, not inline JS');

    //Verify rendered proof badges in roster and audit trail use extracted CSS classes
    const h = createA11yHarness({
      win: { CouncilLatestLiveRun: makeSampleRun({ isRunning: true }) }
    });
    const seatsHtml = h.getEl('seats-grid').innerHTML;
    const proofsHtml = h.getEl('proofs-list').innerHTML;
    assert.match(seatsHtml, /badge badge-seat-proof badge-proof-admitted/);
    assert.match(seatsHtml, /badge badge-seat-proof badge-proof-partially_admitted/);
    assert.match(proofsHtml, /badge badge-proof-rejected/);
    assert.match(proofsHtml, /badge badge-proof-pending/);
  });
});
