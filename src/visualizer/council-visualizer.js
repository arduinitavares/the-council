/**
 * Modular Motion & Dependency Graph Visualizer for The Council
 * Renders:
 *  1. Animated State Machine Topology ("Where We Are" + "What Comes Next" + Guard Dependencies)
 *  2. Live Causal Dependency Graph (Seats -> Proofs -> Candidate Clauses -> Objections)
 * Uses SVG Cubic Beziers, Web Animations API (WAAPI), and Element-Scoped View Transitions.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CouncilVisualizer = factory();
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
   * Builds a smooth SVG cubic bezier path between two node centers
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
    const nodeMap = {};
    graph.nodes.forEach(function (n) { nodeMap[n.id] = n; });

    const outgoingMap = {};
    graph.outgoingEdges.forEach(function (e) { outgoingMap[e.id] = e; });

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

    const edgesSvg = graph.edges.map(function (e) {
      const d = buildEdgePath(e.from, e.to, nodeMap);
      const isLastTraversed = e.id === graph.lastEdgeId;
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

      return (
        '<g class="' + cls + '" data-edge-id="' + e.id + '">' +
          '<path d="' + d + '" fill="none" stroke="' + stroke + '" stroke-width="' + width + '" ' +
            (dash ? 'stroke-dasharray="' + dash + '" ' : '') +
            'marker-end="' + marker + '" />' +
          pulseOverlay +
        '</g>'
      );
    }).join('');

    const nextTargetSet = {};
    graph.outgoingEdges.forEach(function (e) {
      nextTargetSet[e.to] = e.unlocked ? 'unlocked' : 'locked';
    });

    const nodesSvg = graph.nodes.map(function (n) {
      const isActive = n.id === graph.activeNodeId;
      const isPrevious = n.id === state.previousPhase && n.id !== graph.activeNodeId;
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

      return (
        '<g class="sm-node ' + (isActive ? 'sm-node-active' : '') + '" data-node-id="' + n.id + '">' +
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
   * Renders the Causal Artifact Dependency Graph SVG:
   * Column 1: Seats (with Harness & Status)
   * Column 2: Structured Proofs (P1..Pn)
   * Column 3: Judge & Candidate Clauses (C1..Cn)
   * Column 4: Blocking Objections (O1..On) & Verdict
   */
  function renderCausalDependencySVG(svgEl, state, graph) {
    if (!svgEl) return;

    const seats = state.seats || [];
    const proofs = state.proofs || [];
    const clauses = (state.candidate && state.candidate.clauses) ? state.candidate.clauses : [];
    const objections = (state.objections || []).filter(function (o) { return o.status !== 'withdrawn'; });

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
    const linksSvg = graph.causalLinks.map(function (lnk) {
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
      return (
        '<g transform="translate(' + (b.x - b.w / 2) + ',' + (b.y - b.h / 2) + ')" opacity="' + (isExcused ? '0.5' : '1') + '">' +
          '<rect width="' + b.w + '" height="' + b.h + '" rx="8" fill="#141e2d" stroke="' + stroke + '" stroke-width="1.5" ' + (isExcused ? 'stroke-dasharray="4 3"' : '') + ' />' +
          '<text x="10" y="14" fill="#e6eef8" font-size="11.5" font-weight="700">' + escapeHtml(s.id) + '</text>' +
          '<text x="10" y="27" fill="#9cb0c9" font-size="9.5">' + escapeHtml(s.harness + ' · ' + s.status) + '</text>' +
        '</g>'
      );
    }).join('');

    // Draw Proof Nodes
    const proofNodesSvg = proofs.length === 0
      ? '<text x="' + colProofX + '" y="95" text-anchor="middle" fill="#64748b" font-size="11">No Proofs submitted yet</text>'
      : proofs.map(function (p) {
          const b = pos['proof:' + p.id];
          const stroke = p.status === 'admitted' ? '#34d399' : (p.status === 'rejected' ? '#f87171' : '#38bdf8');
          return (
            '<g transform="translate(' + (b.x - b.w / 2) + ',' + (b.y - b.h / 2) + ')">' +
              '<rect width="' + b.w + '" height="' + b.h + '" rx="8" fill="#141e2d" stroke="' + stroke + '" stroke-width="1.6" />' +
              '<text x="10" y="15" fill="#e6eef8" font-size="11.5" font-weight="700">' + escapeHtml(p.id + ' [' + p.kind + '] · ' + p.status) + '</text>' +
              '<text x="10" y="29" fill="#9cb0c9" font-size="9.5">' + escapeHtml(p.scope.slice(0, 28)) + '</text>' +
            '</g>'
          );
        }).join('');

    // Draw Judge + Clause Nodes
    const jb = pos['judge:main'];
    const judgeSvg =
      '<g transform="translate(' + (jb.x - jb.w / 2) + ',' + (jb.y - jb.h / 2) + ')">' +
        '<rect width="' + jb.w + '" height="' + jb.h + '" rx="8" fill="#13263a" stroke="#38bdf8" stroke-width="1.6" />' +
        '<text x="10" y="15" fill="#e6eef8" font-size="11.5" font-weight="700">Judge: ' + escapeHtml(state.judge.id) + '</text>' +
        '<text x="10" y="28" fill="#9cb0c9" font-size="9.5">' + escapeHtml(state.judge.harness + ' · ' + state.judge.status) + '</text>' +
      '</g>';

    const clauseNodesSvg = clauses.map(function (cl) {
      const b = pos['clause:' + cl.id];
      return (
        '<g transform="translate(' + (b.x - b.w / 2) + ',' + (b.y - b.h / 2) + ')">' +
          '<rect width="' + b.w + '" height="' + b.h + '" rx="8" fill="#122926" stroke="#34d399" stroke-width="1.6" />' +
          '<text x="10" y="15" fill="#e6eef8" font-size="11" font-weight="700">' + escapeHtml(cl.id + ': ' + cl.context.slice(0, 24)) + '</text>' +
          '<text x="10" y="30" fill="#a7f3d0" font-size="9.5">Cites Proof: ' + escapeHtml((cl.citedProofIds || []).join(', ')) + '</text>' +
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
          return (
            '<g transform="translate(' + (b.x - b.w / 2) + ',' + (b.y - b.h / 2) + ')">' +
              '<rect width="' + b.w + '" height="' + b.h + '" rx="8" fill="#281d1d" stroke="' + stroke + '" stroke-width="1.8" />' +
              '<text x="10" y="15" fill="#fef2f2" font-size="11" font-weight="700">' + escapeHtml(o.id + ' (' + o.seatId + ')') + '</text>' +
              '<text x="10" y="30" fill="' + stroke + '" font-size="9.5">' + escapeHtml(isLocked ? 'LOCKED (Seat Excused)' : 'Open · Proof ' + o.proofId) + '</text>' +
            '</g>'
          );
        }).join('');

    svgEl.innerHTML = defs + headersSvg + linksSvg + seatNodesSvg + proofNodesSvg + judgeSvg + clauseNodesSvg + objNodesSvg;
  }

  return {
    runScopedTransition: runScopedTransition,
    renderStateMachineSVG: renderStateMachineSVG,
    renderCausalDependencySVG: renderCausalDependencySVG,
    escapeHtml: escapeHtml
  };
});
