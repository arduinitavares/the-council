/**
 * Modular Motion & Dependency Graph Visualizer for The Council
 * Renders:
 *  1. Animated State Machine Topology ("Where We Are" + "What Comes Next" + Guard Dependencies)
 *  2. Live Causal Dependency Graph (Seats -> Proofs -> Candidate Clauses -> Objections)
 * Uses SVG Cubic Beziers, Web Animations API (WAAPI), and Element-Scoped View Transitions.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.CouncilVisualizer = api;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.CouncilVisualizer = api;
  }
  if (root) {
    root.CouncilVisualizer = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const supportsScopedViewTransition =
    typeof Element !== 'undefined' && 'startViewTransition' in Element.prototype;

  function runScopedTransition(scopeEl, updateFn) {
    if (!scopeEl || !supportsScopedViewTransition) {
      updateFn();
      return;
    }
    const vt = scopeEl.startViewTransition(function () {
      updateFn();
    });
    if (vt && vt.ready && typeof vt.ready.catch === 'function') {
      vt.ready.catch(function () {});
    }
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Safely coerces a soul property to a trimmed string without [object Object] artifacts.
   * @param {*} val
   * @returns {string} Safe string value
   */
  function toSafePropertyString(val) {
    if (val == null) return '';
    if (typeof val === 'string') {
      const trimmed = val.trim();
      return trimmed === '[object Object]' ? '' : trimmed;
    }
    if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'bigint') {
      return String(val).trim();
    }
    if (Array.isArray(val)) {
      const joined = val
        .map(function (v) {
          if (typeof v === 'string') return v.trim();
          if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v).trim();
          return '';
        })
        .filter(Boolean)
        .join(', ');
      return joined.trim();
    }
    if (typeof val === 'object') {
      try {
        const json = JSON.stringify(val);
        if (json && json !== '{}' && json !== '[]' && !json.includes('[object Object]')) {
          return json;
        }
      } catch {}
      return '';
    }
    return '';
  }

  /**
   * Formats a Soul into clean readable text without [object Object] artifacts.
   * @param {string|Object|null|undefined} soul
   * @returns {string} Formatted soul text
   */
  function formatSoul(soul) {
    if (!soul) return '';
    if (typeof soul === 'string') {
      const trimmed = soul.trim();
      return trimmed === '[object Object]' ? '' : trimmed;
    }
    if (typeof soul === 'number' || typeof soul === 'boolean' || typeof soul === 'bigint') {
      return String(soul).trim();
    }
    if (Array.isArray(soul)) {
      return toSafePropertyString(soul);
    }
    if (typeof soul === 'object') {
      const name = toSafePropertyString(soul.name);
      const lens = toSafePropertyString(soul.lens);
      const temperament = toSafePropertyString(soul.temperament);

      if (name && lens) return name + ' — ' + lens;
      if (name) return name;
      if (lens) return lens;
      if (temperament) return temperament;

      try {
        const json = JSON.stringify(soul);
        if (json && json !== '{}' && !json.includes('[object Object]')) {
          return json;
        }
      } catch {}
      return '';
    }
    return '';
  }

  /**
   * Renders structured HTML markup for participant cards without [object Object].
   * @param {string|Object|null|undefined} soul
   * @param {Function} [esc]
   * @returns {string} HTML markup
   */
  function renderSoulCardHtml(soul, esc) {
    const escape = typeof esc === 'function' ? esc : escapeHtml;
    if (!soul) return '';
    if (typeof soul === 'string') {
      const trimmed = soul.trim();
      if (!trimmed || trimmed === '[object Object]') return '';
      return '<div class="soul-text">' + escape(trimmed) + '</div>';
    }
    if (typeof soul === 'number' || typeof soul === 'boolean' || typeof soul === 'bigint') {
      return '<div class="soul-text">' + escape(String(soul).trim()) + '</div>';
    }
    if (Array.isArray(soul)) {
      const str = toSafePropertyString(soul);
      return str ? '<div class="soul-text">' + escape(str) + '</div>' : '';
    }
    if (typeof soul === 'object') {
      const name = toSafePropertyString(soul.name);
      const lens = toSafePropertyString(soul.lens);
      const temperament = toSafePropertyString(soul.temperament);
      const parts = [];
      if (name) {
        parts.push('<span class="soul-name">' + escape(name) + '</span>');
      }
      if (temperament) {
        parts.push('<span class="soul-temperament">[' + escape(temperament) + ']</span>');
      }
      if (lens) {
        parts.push('<span class="soul-lens">· ' + escape(lens) + '</span>');
      }
      if (parts.length > 0) {
        return '<div class="soul-block">' + parts.join(' ') + '</div>';
      }
      try {
        const json = JSON.stringify(soul);
        if (json && json !== '{}' && !json.includes('[object Object]')) {
          return '<div class="soul-text">' + escape(json) + '</div>';
        }
      } catch {}
      return '';
    }
    return '';
  }

  /**
   * Truncates a string at word boundaries and appends ellipsis ('…').
   * Prevents surrogate pair splitting and guards against non-positive maxLen.
   * @param {string|null|undefined} str
   * @param {number} [maxLen=26]
   * @returns {string} Truncated string
   */
  function truncateAtWord(str, maxLen = 26) {
    if (str == null || typeof maxLen !== 'number' || Number.isNaN(maxLen) || maxLen <= 0) return '';
    const s = String(str).trim();
    if (!s) return '';
    const chars = Array.from(s);
    if (chars.length <= maxLen) return s;
    const subChars = chars.slice(0, maxLen);
    const lastSpace = subChars.lastIndexOf(' ');
    const cutPoint = lastSpace > Math.floor(maxLen * 0.4) ? lastSpace : maxLen - 1;
    const resultChars = subChars.slice(0, Math.max(0, cutPoint));
    while (resultChars.length > 0 && /\s/.test(resultChars[resultChars.length - 1])) {
      resultChars.pop();
    }
    return resultChars.join('') + '…';
  }

  /**
   * Builds a smooth SVG cubic bezier path between two node centers.
   */
  function buildEdgePath(n1, n2, allNodesMap) {
    const from = allNodesMap[n1];
    const to = allNodesMap[n2];
    if (!from || !to) return '';

    const dx = to.x - from.x;
    const dy = to.y - from.y;

    // Back-edge (e.g. confirming -> reviewing loop)
    if (dx < -40 && Math.abs(dy) < 40) {
      const midX = (from.x + to.x) / 2;
      const arcY = Math.min(from.y, to.y) - 72;
      return 'M ' + from.x + ' ' + (from.y - 24) +
             ' Q ' + midX + ' ' + arcY + ' ' + to.x + ' ' + (to.y - 24);
    }

    // Vertical/diagonal fault transitions
    if (Math.abs(dy) > 50) {
      const startY = dy > 0 ? from.y + 24 : from.y - 24;
      const endY = dy > 0 ? to.y - 24 : to.y + 24;
      const cy1 = startY + dy * 0.45;
      const cy2 = endY - dy * 0.45;
      return 'M ' + from.x + ' ' + startY +
             ' C ' + from.x + ' ' + cy1 + ', ' + to.x + ' ' + cy2 + ', ' + to.x + ' ' + endY;
    }

    // Standard left-to-right flow
    const sx = from.x + 62;
    const sy = from.y;
    const tx = to.x - 62;
    const ty = to.y;
    const cx1 = sx + (tx - sx) * 0.45;
    const cx2 = tx - (tx - sx) * 0.45;
    return 'M ' + sx + ' ' + sy + ' C ' + cx1 + ' ' + sy + ', ' + cx2 + ' ' + ty + ', ' + tx + ' ' + ty;
  }

  /**
   * Renders the State Machine Topology SVG ("Where We Are" & "What Comes Next")
   */
  function renderStateMachineSVG(svgEl, state, graph) {
    if (!svgEl) return;
    const g = graph || (state && state.graph) || { nodes: [], edges: [], outgoingEdges: [] };
    const nodes = g.nodes || [];
    const edges = g.edges || [];
    const outgoingEdges = g.outgoingEdges || [];

    const nodeMap = {};
    nodes.forEach(function (n) { nodeMap[n.id] = n; });

    const outgoingMap = {};
    outgoingEdges.forEach(function (e) { outgoingMap[e.id] = e; });

    const defs =
      '<defs>' +
        '<marker id="arrow-muted" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
          '<path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="#3a4c66"/>' +
        '</marker>' +
        '<marker id="arrow-next" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">' +
          '<path d="M 0 1 L 9 5 L 0 9 z" fill="#38bdf8"/>' +
        '</marker>' +
        '<marker id="arrow-locked" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
          '<path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="#f59e0b"/>' +
        '</marker>' +
        '<marker id="arrow-active" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
          '<path d="M 0 1 L 9 5 L 0 9 z" fill="#34d399"/>' +
        '</marker>' +
      '</defs>';

    const edgesSvg = edges.map(function (e) {
      const d = buildEdgePath(e.from, e.to, nodeMap);
      const isLastTraversed = e.id === g.lastEdgeId;
      const outInfo = outgoingMap[e.id];
      const isNextUnlocked = outInfo && outInfo.unlocked;
      const isNextLocked = outInfo && !outInfo.unlocked;

      let stroke = '#2b3a50';
      let width = 1.6;
      let marker = 'url(#arrow-muted)';
      let dash = '';
      let cls = 'sm-edge';

      if (isLastTraversed) {
        stroke = '#34d399';
        width = 2.8;
        marker = 'url(#arrow-active)';
        cls = 'sm-edge sm-edge-traversed';
      } else if (isNextUnlocked) {
        stroke = '#38bdf8';
        width = 2.4;
        marker = 'url(#arrow-next)';
        dash = '6 5';
        cls = 'sm-edge sm-edge-next';
      } else if (isNextLocked) {
        stroke = '#f59e0b';
        width = 1.8;
        marker = 'url(#arrow-locked)';
        dash = '3 4';
        cls = 'sm-edge sm-edge-locked';
      }

      const pulseOverlay = isLastTraversed
        ? '<path d="' + d + '" fill="none" stroke="#a7f3d0" stroke-width="3.2" stroke-dasharray="10 180" class="waapi-pulse-edge" />'
        : '';

      const edgeTitle = e.id + ': ' + e.from + ' → ' + e.to + ' (' + e.event + ')' +
        '\nGuard: ' + (e.guard || 'none') +
        (outInfo && outInfo.dynamicReason ? '\nStatus: ' + outInfo.dynamicReason : '');

      return (
        '<g class="' + cls + '" data-edge-id="' + e.id + '" tabindex="0">' +
          '<title>' + escapeHtml(edgeTitle) + '</title>' +
          '<path d="' + d + '" fill="none" stroke="' + stroke + '" stroke-width="' + width + '" ' +
            (dash ? 'stroke-dasharray="' + dash + '" ' : '') +
            'marker-end="' + marker + '" />' +
          pulseOverlay +
        '</g>'
      );
    }).join('');

    const nextTargetSet = {};
    outgoingEdges.forEach(function (e) {
      nextTargetSet[e.to] = e.unlocked ? 'unlocked' : 'locked';
    });

    const nodesSvg = nodes.map(function (n) {
      const isActive = n.id === g.activeNodeId;
      const isPrevious = state && n.id === state.previousPhase && n.id !== g.activeNodeId;
      const nextStatus = nextTargetSet[n.id];

      let fill = '#131c29';
      let stroke = '#2e3e56';
      let strokeWidth = 1.5;
      let badgeText = '';

      if (isActive) {
        fill = '#13283c';
        stroke = '#38bdf8';
        strokeWidth = 2.5;
        badgeText = 'CURRENT';
      } else if (nextStatus === 'unlocked') {
        fill = '#122634';
        stroke = '#38bdf8';
        strokeWidth = 1.8;
        badgeText = 'NEXT READY';
      } else if (nextStatus === 'locked') {
        fill = '#231f1a';
        stroke = '#f59e0b';
        strokeWidth = 1.6;
        badgeText = 'GUARD WAIT';
      } else if (isPrevious) {
        stroke = '#34d399';
      }

      const rx = n.x - 62;
      const ry = n.y - 25;

      const badgeSvg = badgeText
        ? '<rect x="' + (n.x - 36) + '" y="' + (ry - 10) + '" width="72" height="15" rx="4" fill="' +
            (isActive ? '#38bdf8' : (nextStatus === 'unlocked' ? '#0ea5e9' : '#f59e0b')) + '" />' +
          '<text x="' + n.x + '" y="' + (ry + 1) + '" text-anchor="middle" fill="#091017" font-size="9" font-weight="700">' +
            badgeText +
          '</text>'
        : '';

      const nodeTitle = 'Phase: ' + n.label + ' (' + n.id + ')\n' +
        n.subtitle +
        (isActive ? '\nStatus: CURRENT' : (nextStatus ? '\nStatus: ' + nextStatus.toUpperCase() : ''));

      return (
        '<g class="sm-node ' + (isActive ? 'sm-node-active' : '') + '" data-node-id="' + n.id + '" tabindex="0">' +
          '<title>' + escapeHtml(nodeTitle) + '</title>' +
          '<rect x="' + rx + '" y="' + ry + '" width="124" height="50" rx="10" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '" />' +
          badgeSvg +
          '<text x="' + n.x + '" y="' + (n.y - 2) + '" text-anchor="middle" fill="#e6eef8" font-size="12.5" font-weight="700">' +
            escapeHtml(n.label) +
          '</text>' +
          '<text x="' + n.x + '" y="' + (n.y + 14) + '" text-anchor="middle" fill="#9cb0c9" font-size="10">' +
            escapeHtml(n.subtitle) +
          '</text>' +
        '</g>'
      );
    }).join('');

    svgEl.innerHTML = defs + edgesSvg + nodesSvg;

    // Trigger Web Animations API (WAAPI) pulse on traversed edge and active node if motion is allowed
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!prefersReduced) {
      const pulsePath = svgEl.querySelector('.waapi-pulse-edge');
      if (pulsePath && typeof pulsePath.animate === 'function') {
        pulsePath.animate(
          [
            { strokeDashoffset: 190, opacity: 1 },
            { strokeDashoffset: 0, opacity: 0.2 }
          ],
          { duration: 680, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', iterations: 2 }
        );
      }
      const activeNode = svgEl.querySelector('.sm-node-active rect');
      if (activeNode && typeof activeNode.animate === 'function') {
        activeNode.animate(
          [
            { transform: 'scale(0.96)', transformOrigin: 'center', transformBox: 'fill-box' },
            { transform: 'scale(1)', transformOrigin: 'center', transformBox: 'fill-box' }
          ],
          { duration: 320, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
        );
      }
    }
  }

  /**
   * Helper to derive causal links directly from state when not provided in graph.
   */
  function deriveCausalLinks(state) {
    if (!state) return [];
    const causalLinks = [];
    (state.proofs || []).forEach(function (p) {
      causalLinks.push({
        id: 'dep-seat-proof-' + p.id,
        fromKind: 'seat',
        fromId: p.seatId,
        toKind: 'proof',
        toId: p.id,
        status: p.status,
        label: p.kind
      });
    });

    if (state.candidate && state.candidate.clauses) {
      state.candidate.clauses.forEach(function (cl) {
        (cl.citedProofIds || []).forEach(function (pid) {
          causalLinks.push({
            id: 'dep-proof-clause-' + pid + '-' + cl.id,
            fromKind: 'proof',
            fromId: pid,
            toKind: 'clause',
            toId: cl.id,
            status: 'admitted',
            label: 'cites ' + pid
          });
        });
      });
    }

    (state.objections || []).forEach(function (o) {
      if (o.status !== 'withdrawn') {
        causalLinks.push({
          id: 'dep-obj-seat-' + o.id,
          fromKind: 'seat',
          fromId: o.seatId,
          toKind: 'objection',
          toId: o.id,
          status: o.status,
          label: 'owns ' + o.id
        });
        causalLinks.push({
          id: 'dep-obj-proof-' + o.id,
          fromKind: 'proof',
          fromId: o.proofId,
          toKind: 'objection',
          toId: o.id,
          status: o.status,
          label: 'backs ' + o.id
        });
      }
    });
    return causalLinks;
  }

  /**
   * Renders the Causal Artifact Dependency Graph SVG:
   * Column 1: Seats (with Harness, Model & Soul)
   * Column 2: Structured Proofs (P1..Pn)
   * Column 3: Judge & Candidate Clauses (C1..Cn)
   * Column 4: Blocking Objections (O1..On) & Verdict
   */
  function renderCausalDependencySVG(svgEl, state, graph) {
    if (!svgEl || !state) return;

    const g = graph || state.graph || {};
    const seats = state.seats || [];
    const proofs = state.proofs || [];
    const clauses = (state.candidate && state.candidate.clauses) ? state.candidate.clauses : [];
    const objections = (state.objections || []).filter(function (o) { return o.status !== 'withdrawn'; });
    const causalLinks = Array.isArray(g.causalLinks) ? g.causalLinks : deriveCausalLinks(state);

    const maxRows = Math.max(seats.length, proofs.length, clauses.length + 1, objections.length + 1, 3);
    const height = Math.max(230, maxRows * 48 + 44);
    svgEl.setAttribute('viewBox', '0 0 1120 ' + height);

    const pos = {}; // key: kind:id -> { x, y, w, h }

    // Column X coordinates
    const colSeatX = 110;
    const colProofX = 395;
    const colClauseX = 700;
    const colObjX = 990;

    // 1. Position Seats
    seats.forEach(function (s, idx) {
      const y = 46 + idx * 44;
      pos['seat:' + s.id] = { x: colSeatX, y: y, w: 176, h: 34 };
    });

    // 2. Position Proofs
    proofs.forEach(function (p, idx) {
      const y = 46 + idx * 54;
      pos['proof:' + p.id] = { x: colProofX, y: y, w: 190, h: 38 };
    });

    // 3. Position Judge + Candidate Clauses
    pos['judge:main'] = { x: colClauseX, y: 46, w: 210, h: 36 };
    clauses.forEach(function (cl, idx) {
      const y = 104 + idx * 54;
      pos['clause:' + cl.id] = { x: colClauseX, y: y, w: 210, h: 40 };
    });

    // 4. Position Objections + Verdict
    objections.forEach(function (o, idx) {
      const y = 46 + idx * 56;
      pos['objection:' + o.id] = { x: colObjX, y: y, w: 196, h: 40 };
    });

    const defs =
      '<defs>' +
        '<marker id="dep-arrow-cyan" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
          '<path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="#38bdf8"/>' +
        '</marker>' +
        '<marker id="dep-arrow-green" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
          '<path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="#34d399"/>' +
        '</marker>' +
        '<marker id="dep-arrow-amber" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
          '<path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="#fbbf24"/>' +
        '</marker>' +
        '<marker id="dep-arrow-red" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
          '<path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="#f87171"/>' +
        '</marker>' +
      '</defs>';

    const headersSvg =
      '<text x="' + colSeatX + '" y="20" text-anchor="middle" fill="#9cb0c9" font-size="11" font-weight="700">1. SEATS (HARNESS + SOUL)</text>' +
      '<text x="' + colProofX + '" y="20" text-anchor="middle" fill="#9cb0c9" font-size="11" font-weight="700">2. PROOFS (SOURCED EVIDENCE)</text>' +
      '<text x="' + colClauseX + '" y="20" text-anchor="middle" fill="#9cb0c9" font-size="11" font-weight="700">3. JUDGE &amp; CANDIDATE CLAUSES</text>' +
      '<text x="' + colObjX + '" y="20" text-anchor="middle" fill="#9cb0c9" font-size="11" font-weight="700">4. OBJECTIONS &amp; VERDICT GATE</text>';

    // Draw Dependency Arrows
    const linksSvg = causalLinks.map(function (lnk) {
      const src = pos[lnk.fromKind + ':' + lnk.fromId];
      const dst = pos[lnk.toKind + ':' + lnk.toId];
      if (!src || !dst) return '';

      const sx = src.x + src.w / 2;
      const sy = src.y;
      const tx = dst.x - dst.w / 2;
      const ty = dst.y;
      const cx1 = sx + (tx - sx) * 0.45;
      const cx2 = tx - (tx - sx) * 0.45;
      const d = 'M ' + sx + ' ' + sy + ' C ' + cx1 + ' ' + sy + ', ' + cx2 + ' ' + ty + ', ' + tx + ' ' + ty;

      let stroke = '#38bdf8';
      let marker = 'url(#dep-arrow-cyan)';
      let dash = '';
      if (lnk.toKind === 'clause') {
        stroke = '#34d399';
        marker = 'url(#dep-arrow-green)';
      } else if (lnk.toKind === 'objection') {
        stroke = lnk.status === 'preserved_excused' ? '#f87171' : '#fbbf24';
        marker = lnk.status === 'preserved_excused' ? 'url(#dep-arrow-red)' : 'url(#dep-arrow-amber)';
        dash = '5 4';
      }

      return (
        '<path d="' + d + '" fill="none" stroke="' + stroke + '" stroke-width="1.9" ' +
          (dash ? 'stroke-dasharray="' + dash + '" ' : '') +
          'marker-end="' + marker + '" opacity="0.88" class="dep-edge" />'
      );
    }).join('');

    // Draw Seat Nodes
    const seatNodesSvg = seats.map(function (s) {
      const b = pos['seat:' + s.id];
      const isExcused = s.status === 'excused';
      const isFault = s.status === 'fault_quota' || s.status === 'fault_timeout' || s.status === 'fault';
      const stroke = isFault ? '#f87171' : (s.status === 'accepted' ? '#34d399' : (s.status === 'objected' ? '#fbbf24' : '#334763'));
      const soulFormatted = formatSoul(s.soul);
      const seatTitle = 'Seat: ' + s.id +
        '\nHarness: ' + s.harness +
        '\nModel: ' + (s.model || 'unspecified') +
        '\nStatus: ' + s.status +
        (soulFormatted ? '\nSoul: ' + soulFormatted : '') +
        (s.faultReason ? '\nFault: ' + s.faultReason : '');

      return (
        '<g transform="translate(' + (b.x - b.w / 2) + ',' + (b.y - b.h / 2) + ')" opacity="' + (isExcused ? '0.5' : '1') + '" class="seat-node" tabindex="0">' +
          '<title>' + escapeHtml(seatTitle) + '</title>' +
          '<rect width="' + b.w + '" height="' + b.h + '" rx="8" fill="#141e2d" stroke="' + stroke + '" stroke-width="1.5" ' + (isExcused ? 'stroke-dasharray="4 3"' : '') + ' />' +
          '<text x="10" y="14" fill="#e6eef8" font-size="11.5" font-weight="700">' + escapeHtml(truncateAtWord(s.id, 20)) + '</text>' +
          '<text x="10" y="27" fill="#9cb0c9" font-size="9.5">' + escapeHtml(truncateAtWord(s.harness + ' · ' + s.status, 24)) + '</text>' +
        '</g>'
      );
    }).join('');

    // Draw Proof Nodes
    const proofNodesSvg = proofs.length === 0
      ? '<text x="' + colProofX + '" y="95" text-anchor="middle" fill="#64748b" font-size="11">No Proofs submitted yet</text>'
      : proofs.map(function (p) {
          const b = pos['proof:' + p.id];
          const stroke = p.status === 'admitted' ? '#34d399' : (p.status === 'rejected' ? '#f87171' : '#38bdf8');
          const proofTitle = 'Proof ' + p.id + ' [' + (p.kind || 'evidence').toUpperCase() + '] · ' + p.status +
            '\nSeat: ' + p.seatId +
            '\nScope: ' + (p.scope || 'unspecified') +
            '\nSource: ' + (p.source || 'unspecified') +
            '\nStatement: ' + (p.statement || '');

          return (
            '<g transform="translate(' + (b.x - b.w / 2) + ',' + (b.y - b.h / 2) + ')" class="proof-node" tabindex="0">' +
              '<title>' + escapeHtml(proofTitle) + '</title>' +
              '<rect width="' + b.w + '" height="' + b.h + '" rx="8" fill="#141e2d" stroke="' + stroke + '" stroke-width="1.6" />' +
              '<text x="10" y="15" fill="#e6eef8" font-size="11.5" font-weight="700">' + escapeHtml(p.id + ' [' + p.kind + '] · ' + p.status) + '</text>' +
              '<text x="10" y="29" fill="#9cb0c9" font-size="9.5">' + escapeHtml(truncateAtWord(p.scope, 26)) + '</text>' +
            '</g>'
          );
        }).join('');

    // Draw Judge + Clause Nodes
    const jb = pos['judge:main'];
    const judge = state.judge || {};
    const judgeSoulFormatted = formatSoul(judge.soul);
    const judgeTitle = 'Judge: ' + (judge.id || 'judge') +
      '\nHarness: ' + (judge.harness || 'unspecified') +
      '\nModel: ' + (judge.model || 'unspecified') +
      '\nStatus: ' + (judge.status || 'idle') +
      (judgeSoulFormatted ? '\nSoul: ' + judgeSoulFormatted : '') +
      (judge.faultReason ? '\nFault: ' + judge.faultReason : '');

    const judgeSvg =
      '<g transform="translate(' + (jb.x - jb.w / 2) + ',' + (jb.y - jb.h / 2) + ')" class="judge-node" tabindex="0">' +
        '<title>' + escapeHtml(judgeTitle) + '</title>' +
        '<rect width="' + jb.w + '" height="' + jb.h + '" rx="8" fill="#13263a" stroke="#38bdf8" stroke-width="1.6" />' +
        '<text x="10" y="15" fill="#e6eef8" font-size="11.5" font-weight="700">Judge: ' + escapeHtml(truncateAtWord(judge.id || 'judge', 20)) + '</text>' +
        '<text x="10" y="28" fill="#9cb0c9" font-size="9.5">' + escapeHtml(truncateAtWord((judge.harness || '') + ' · ' + (judge.status || ''), 24)) + '</text>' +
      '</g>';

    const clauseNodesSvg = clauses.map(function (cl) {
      const b = pos['clause:' + cl.id];
      const cites = (cl.citedProofIds || []).join(', ');
      const clauseTitle = 'Clause ' + cl.id +
        '\nContext: ' + (cl.context || '') +
        '\nConclusion: ' + (cl.conclusion || '') +
        '\nCites Proofs: ' + (cites || 'none');

      return (
        '<g transform="translate(' + (b.x - b.w / 2) + ',' + (b.y - b.h / 2) + ')" class="clause-node" tabindex="0">' +
          '<title>' + escapeHtml(clauseTitle) + '</title>' +
          '<rect width="' + b.w + '" height="' + b.h + '" rx="8" fill="#122926" stroke="#34d399" stroke-width="1.6" />' +
          '<text x="10" y="15" fill="#e6eef8" font-size="11" font-weight="700">' + escapeHtml(truncateAtWord(cl.id + ': ' + cl.context, 26)) + '</text>' +
          '<text x="10" y="30" fill="#a7f3d0" font-size="9.5">Cites: ' + escapeHtml(truncateAtWord(cites || 'none', 20)) + '</text>' +
        '</g>'
      );
    }).join('');

    // Draw Objection Nodes
    const objNodesSvg = objections.length === 0
      ? '<text x="' + colObjX + '" y="95" text-anchor="middle" fill="#34d399" font-size="11">0 Blocking Objections</text>'
      : objections.map(function (o) {
          const b = pos['objection:' + o.id];
          const isLocked = o.status === 'preserved_excused';
          const stroke = isLocked ? '#f87171' : '#fbbf24';
          const objTitle = 'Objection ' + o.id +
            '\nSeat: ' + o.seatId +
            '\nBacking Proof: ' + o.proofId +
            '\nStatus: ' + o.status +
            '\nReason: ' + (o.reason || 'unspecified');

          return (
            '<g transform="translate(' + (b.x - b.w / 2) + ',' + (b.y - b.h / 2) + ')" class="objection-node" tabindex="0">' +
              '<title>' + escapeHtml(objTitle) + '</title>' +
              '<rect width="' + b.w + '" height="' + b.h + '" rx="8" fill="#281d1d" stroke="' + stroke + '" stroke-width="1.8" />' +
              '<text x="10" y="15" fill="#fef2f2" font-size="11" font-weight="700">' + escapeHtml(truncateAtWord(o.id + ' (' + o.seatId + ')', 22)) + '</text>' +
              '<text x="10" y="30" fill="' + stroke + '" font-size="9.5">' + escapeHtml(isLocked ? 'LOCKED (Seat Excused)' : truncateAtWord('Open · Proof ' + o.proofId, 22)) + '</text>' +
            '</g>'
          );
        }).join('');

    svgEl.innerHTML = defs + headersSvg + linksSvg + seatNodesSvg + proofNodesSvg + judgeSvg + clauseNodesSvg + objNodesSvg;
  }

  return {
    runScopedTransition: runScopedTransition,
    renderStateMachineSVG: renderStateMachineSVG,
    renderCausalDependencySVG: renderCausalDependencySVG,
    escapeHtml: escapeHtml,
    formatSoul: formatSoul,
    renderSoulCardHtml: renderSoulCardHtml,
    truncateAtWord: truncateAtWord
  };
});
