(() => {
  "use strict";

  const GRAPH_ANCHOR_IDS = ["training-integrated-graph", "integrated-training-graph"];
  const LINK_SELECTOR = 'a.training-focus-link, a.training-reset-link, a[data-focus-node], a[href="#training-integrated-graph"]';
  const STYLE_ID = "training-system-mermaid-focus-style";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const baseTransforms = new WeakMap();
  const graphStates = new WeakMap();
  const MIN_SCALE = 1.8;
  const MAX_SCALE = 4.2;
  const NATIVE_WHEEL_SCALE_FACTOR = 0.002 * 10;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const nextFrame = (callback) => {
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(callback);
    else window.setTimeout(callback, 0);
  };

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .training-focus-link { text-decoration: underline dotted; text-underline-offset: 2px; }
      .training-focus-link:hover, .training-reset-link:hover { cursor: pointer; }
      .training-focus-status {
        position: absolute; left: 8px; bottom: 8px; z-index: 101; padding: 3px 8px;
        border-radius: 4px; color: var(--vscode-editor-foreground);
        background: color-mix(in srgb, var(--vscode-editorWidget-background) 88%, transparent);
        border: 1px solid var(--vscode-editorWidget-border, transparent); font-size: 12px;
        pointer-events: none;
      }
      .training-focus-ring {
        fill: rgba(255, 152, 0, .08); stroke: #ff9800; stroke-width: 4;
        stroke-dasharray: 9 6; vector-effect: non-scaling-stroke; pointer-events: none;
      }
      .training-focus-toolbar, .training-edge-action-bar {
        position: absolute; z-index: 120; display: flex; align-items: center; gap: 6px;
        padding: 5px 7px; border-radius: 6px; color: var(--vscode-editor-foreground);
        background: color-mix(in srgb, var(--vscode-editorWidget-background) 95%, transparent);
        border: 1px solid var(--vscode-editorWidget-border, #777); box-shadow: 0 2px 10px rgba(0,0,0,.22);
        font: 12px var(--vscode-font-family, sans-serif); white-space: nowrap;
      }
      .training-focus-toolbar { top: 8px; left: 8px; }
      .training-edge-action-bar { max-width: min(560px, calc(100% - 16px)); flex-wrap: wrap; }
      .training-focus-toolbar button, .training-edge-action-bar button {
        cursor: pointer; color: var(--vscode-button-foreground); background: var(--vscode-button-background);
        border: 1px solid var(--vscode-button-border, transparent); border-radius: 4px; padding: 3px 8px;
      }
      .training-focus-toolbar button:hover, .training-edge-action-bar button:hover { background: var(--vscode-button-hoverBackground); }
      .training-focus-toolbar button[data-active="true"] { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
      .training-edge-action-title { margin-right: 2px; opacity: .9; }
      .training-edge-hit { fill: rgba(0,0,0,.001) !important; stroke: rgba(0,0,0,.001) !important; stroke-width: 28px !important; pointer-events: stroke !important; cursor: pointer !important; vector-effect: non-scaling-stroke; }
      .training-neighborhood-background .node { opacity: .16 !important; transform-box: fill-box; transform-origin: center; transform: scale(.72); }
      .training-neighborhood-background .training-neighbor-background { opacity: .36 !important; transform: scale(.86); }
      .training-neighborhood-background .training-center-background { opacity: .08 !important; }
      .training-neighborhood-background .edgePath, .training-neighborhood-background .edgeLabel,
      .training-neighborhood-background path.flowchart-link { opacity: .12 !important; }
      .training-neighborhood-node .label, .training-neighborhood-node text { pointer-events: none; }
      .training-neighborhood-edge { fill: none; stroke: var(--vscode-textLink-foreground, #4daafc); stroke-width: 3.5; vector-effect: non-scaling-stroke; }
      .training-neighborhood-edge-hit { fill: rgba(0,0,0,.001); stroke: rgba(0,0,0,.001); stroke-width: 30px; pointer-events: stroke; cursor: pointer; vector-effect: non-scaling-stroke; }
      .training-neighborhood-label { fill: var(--vscode-editor-foreground); font-size: 13px; text-anchor: middle; pointer-events: none; }
      .training-neighborhood-node.training-neighborhood-center rect,
      .training-neighborhood-node.training-neighborhood-center polygon,
      .training-neighborhood-node.training-neighborhood-center path { stroke: #ff9800 !important; stroke-width: 3 !important; filter: drop-shadow(0 0 7px rgba(255,152,0,.7)); }
    `;
    document.head.appendChild(style);
  }

  function getGraphAnchor() {
    return GRAPH_ANCHOR_IDS.map((id) => document.getElementById(id)).find(Boolean) || null;
  }

  function getGraphWrapper() {
    const anchor = getGraphAnchor();
    if (!anchor) return null;
    let node = anchor;
    for (let i = 0; node && i < 12; i += 1) {
      node = node.nextElementSibling;
      if (!node) break;
      if (node.matches?.(".mermaid-wrapper")) return node;
      const nested = node.querySelector?.(".mermaid-wrapper");
      if (nested) return nested;
    }
    const wrappers = [...document.querySelectorAll(".mermaid-wrapper")];
    const anchorTop = anchor.getBoundingClientRect().top;
    return wrappers.find((wrapper) => wrapper.getBoundingClientRect().top >= anchorTop) || wrappers.at(-1) || null;
  }

  function getNodeId(link) {
    return (link.dataset.focusNode || link.textContent || "").trim();
  }

  function stripMermaidNodeId(rawId) {
    const id = String(rawId || "");
    const match = id.match(/^flowchart-(.+?)-\d+$/);
    return match ? match[1] : id.replace(/^flowchart-/, "");
  }

  function findMermaidNode(svg, nodeId) {
    if (!svg || !nodeId) return null;
    const exact = svg.querySelector(`#${CSS.escape(nodeId)}`);
    if (exact) return exact.closest("g.node") || exact;
    const candidates = [...svg.querySelectorAll("g.node, g[id], [id]")];
    const prefixes = [`flowchart-${nodeId}-`, `flowchart-${nodeId}`, `-${nodeId}-`, `-${nodeId}`];
    return candidates.find((element) => {
      const id = element.id || "";
      return id === nodeId || prefixes.some((prefix) => id.startsWith(prefix) || id.includes(prefix));
    }) || null;
  }

  function clearFocus(wrapper) {
    wrapper?.querySelectorAll(".training-focus-ring").forEach((ring) => ring.remove());
    wrapper?.querySelector(".training-focus-status")?.remove();
  }

  function rememberBaseTransform(wrapper, content) {
    if (!baseTransforms.has(wrapper)) {
      baseTransforms.set(wrapper, { transform: content.style.transform, transformOrigin: content.style.transformOrigin });
    }
    const base = baseTransforms.get(wrapper);
    content.style.transformOrigin = base.transformOrigin || "0 0";
    return base;
  }

  function restoreBaseTransform(wrapper, content) {
    const base = baseTransforms.get(wrapper);
    if (!base) { content.style.transform = ""; return; }
    content.style.transform = base.transform;
    content.style.transformOrigin = base.transformOrigin;
    baseTransforms.delete(wrapper);
  }

  function addFocusRing(svg, node) {
    const box = node.getBBox?.();
    if (!box || !Number.isFinite(box.width)) return;
    const ring = document.createElementNS(SVG_NS, "rect");
    ring.setAttribute("class", "training-focus-ring");
    ring.setAttribute("x", String(box.x - 10)); ring.setAttribute("y", String(box.y - 10));
    ring.setAttribute("width", String(box.width + 20)); ring.setAttribute("height", String(box.height + 20));
    ring.setAttribute("rx", "8"); svg.appendChild(ring);
  }

  function setStatus(wrapper, nodeId) {
    wrapper.querySelector(".training-focus-status")?.remove();
    const status = document.createElement("div"); status.className = "training-focus-status";
    status.textContent = nodeId ? `当前聚焦：${nodeId}` : "已重置图形视图";
    wrapper.appendChild(status);
  }

  function getNativeResetButton(wrapper) { return wrapper.querySelector(".mermaid-zoom-reset-btn, .zoom-reset-btn"); }

  function parseTransform(transform) {
    const source = String(transform || "");
    const translate = source.match(/translate\(\s*([-+]?\d*\.?\d+)px?\s*,\s*([-+]?\d*\.?\d+)px?\s*\)/i);
    const scale = source.match(/scale\(\s*([-+]?\d*\.?\d+)/i);
    return { x: translate ? Number(translate[1]) : 0, y: translate ? Number(translate[2]) : 0, scale: scale ? Number(scale[1]) : 1 };
  }

  function resetNativeView(wrapper, content) {
    const resetButton = getNativeResetButton(wrapper);
    if (resetButton) { resetButton.click(); return true; }
    content.style.transform = "none"; return false;
  }

  function dispatchNativeWheel(wrapper, targetScale, currentScale) {
    if (!Number.isFinite(targetScale) || !Number.isFinite(currentScale) || currentScale <= 0) return;
    const factor = targetScale / currentScale; if (Math.abs(factor - 1) < 0.0001) return;
    const rect = wrapper.getBoundingClientRect();
    wrapper.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true,
      clientX: rect.left + rect.width / 2, clientY: rect.top + Math.max(rect.height, 260) / 2,
      ctrlKey: true, deltaY: -(factor - 1) / NATIVE_WHEEL_SCALE_FACTOR, deltaMode: 0 }));
  }

  function dispatchNativePan(wrapper, deltaX, deltaY) {
    if (Math.abs(deltaX) < 0.01 && Math.abs(deltaY) < 0.01) return;
    const rect = wrapper.getBoundingClientRect(), startX = rect.left + 12, startY = rect.top + 12;
    wrapper.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: startX, clientY: startY, altKey: true }));
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, buttons: 1, clientX: startX + deltaX, clientY: startY + deltaY, altKey: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0, buttons: 0, clientX: startX + deltaX, clientY: startY + deltaY, altKey: true }));
  }

  function getViewBox(svg) {
    const raw = svg.getAttribute("viewBox");
    if (raw) {
      const values = raw.trim().split(/[ ,]+/).map(Number);
      if (values.length === 4 && values.every(Number.isFinite)) return { x: values[0], y: values[1], width: values[2], height: values[3] };
    }
    return { x: 0, y: 0, width: Number(svg.getAttribute("width")) || 1000, height: Number(svg.getAttribute("height")) || 600 };
  }

  function screenToSvg(svg, x, y) {
    const rect = svg.getBoundingClientRect(), view = getViewBox(svg);
    return { x: view.x + (x - rect.left) * view.width / Math.max(rect.width, 1), y: view.y + (y - rect.top) * view.height / Math.max(rect.height, 1) };
  }

  function nodeCenterSvg(svg, node) {
    const rect = node.getBoundingClientRect();
    return screenToSvg(svg, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function nodeSizeSvg(svg, node) {
    const rect = node.getBoundingClientRect(), svgRect = svg.getBoundingClientRect(), view = getViewBox(svg);
    return { width: rect.width * view.width / Math.max(svgRect.width, 1), height: rect.height * view.height / Math.max(svgRect.height, 1) };
  }

  function buildGraphModel(svg) {
    const nodes = new Map();
    [...svg.querySelectorAll("g.node")].forEach((element) => {
      const id = stripMermaidNodeId(element.id);
      if (id) nodes.set(id, { id, element });
    });
    const paths = [...svg.querySelectorAll('g.edgePath path, path.flowchart-link, path[id^=\"L-\"]')]
      .filter((path, index, all) => all.indexOf(path) === index);
    const labels = [...svg.querySelectorAll("g.edgeLabel")].map((element) => (element.textContent || "").trim());
    const edges = [];
    paths.forEach((path, index) => {
      const rawId = path.id || path.closest("g.edgePath")?.id || "";
      const edgeId = rawId.replace(/^L-/, "");
      const ordered = [...nodes.keys()].sort((a, b) => b.length - a.length);
      let source = null, target = null;
      for (const from of ordered) {
        if (!edgeId.startsWith(`${from}-`)) continue;
        const rest = edgeId.slice(from.length + 1);
        const to = ordered.find((candidate) => rest.startsWith(`${candidate}-`) || rest === candidate);
        if (to) { source = from; target = to; break; }
      }
      if (!source || !target) {
        const match = edgeId.match(/^(.+?)-(.+?)(?:-\d+)?$/);
        if (match && nodes.has(match[1]) && nodes.has(match[2])) { source = match[1]; target = match[2]; }
      }
      if (!source || !target) return;
      edges.push({ id: rawId || `edge-${index}`, source, target, path, label: labels[index] || "" });
    });
    return { nodes, edges };
  }

  function addButton(parent, text, attributes = {}) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = text;
    Object.entries(attributes).forEach(([key, value]) => button.dataset[key] = value);
    parent.appendChild(button); return button;
  }

  function ensureToolbar(wrapper, state) {
    if (state.toolbar?.isConnected) return;
    const toolbar = document.createElement("div"); toolbar.className = "training-focus-toolbar";
    addButton(toolbar, "全局", { mode: "global" }); addButton(toolbar, "邻域聚焦", { mode: "neighborhood" });
    wrapper.appendChild(toolbar); state.toolbar = toolbar; updateToolbar(state);
  }

  function updateToolbar(state) {
    state.toolbar?.querySelectorAll("button[data-mode]").forEach((button) => {
      button.dataset.active = String(button.dataset.mode === state.mode);
    });
  }

  function hideEdgeActionBar(state) { state.actionBar?.remove(); state.actionBar = null; }

  function showEdgeActionBar(wrapper, state, edge, clientX, clientY) {
    hideEdgeActionBar(state);
    const bar = document.createElement("div"); bar.className = "training-edge-action-bar";
    const title = document.createElement("span"); title.className = "training-edge-action-title";
    title.textContent = `关系：${edge.source} → ${edge.target}`; bar.appendChild(title);
    addButton(bar, `聚焦上游：${edge.source}`, { edgeAction: "upstream" });
    addButton(bar, `聚焦下游：${edge.target}`, { edgeAction: "downstream" });
    addButton(bar, "×", { edgeAction: "close" }); wrapper.appendChild(bar); state.actionBar = bar;
    const rect = wrapper.getBoundingClientRect();
    const maxX = Math.max(8, wrapper.clientWidth - bar.offsetWidth - 8);
    const maxY = Math.max(8, wrapper.clientHeight - bar.offsetHeight - 8);
    bar.style.left = `${clamp(clientX - rect.left - bar.offsetWidth / 2, 8, maxX)}px`;
    bar.style.top = `${clamp(clientY - rect.top + 12, 8, maxY)}px`;
  }

  function replaceEdgeHitLayer(state, paths) {
    state.edgeHitLayer?.remove();
    const layer = document.createElementNS(SVG_NS, "g");
    layer.setAttribute("class", "training-edge-hit-layer");
    layer.setAttribute("pointer-events", "all");
    layer.style.pointerEvents = "all";
    paths.forEach(({ path, source, target, edge }) => {
      if (!path || !path.getAttribute("d")) return;
      const hit = path.cloneNode(false);
      hit.removeAttribute("id");
      hit.removeAttribute("marker-end");
      hit.setAttribute("class", "training-edge-hit");
      hit.setAttribute("fill", "rgba(0,0,0,0.001)");
      hit.setAttribute("stroke", "rgba(0,0,0,0.001)");
      hit.setAttribute("stroke-width", "30");
      hit.setAttribute("pointer-events", "stroke");
      hit.style.pointerEvents = "stroke";
      hit.style.cursor = "pointer";
      hit.dataset.edgeSource = source;
      hit.dataset.edgeTarget = target;
      hit.dataset.edgeId = edge?.id || `${source}-${target}`;
      layer.appendChild(hit);
    });
    state.svg.appendChild(layer);
    state.edgeHitLayer = layer;
  }

  function edgeDistanceToPoint(path, clientX, clientY) {
    if (!path?.isConnected || typeof path.getTotalLength !== "function") return Infinity;
    const rect = path.getBoundingClientRect();
    if (!rect.width && !rect.height) return Infinity;
    const padding = 34;
    if (clientX < rect.left - padding || clientX > rect.right + padding || clientY < rect.top - padding || clientY > rect.bottom + padding) return Infinity;
    const ctm = path.getScreenCTM?.();
    const total = path.getTotalLength();
    if (!ctm || !Number.isFinite(total) || total <= 0) return Infinity;
    const samples = Math.max(24, Math.min(180, Math.ceil(total / 10)));
    let best = Infinity;
    for (let i = 0; i <= samples; i += 1) {
      const point = path.getPointAtLength(total * i / samples);
      const screen = new DOMPoint(point.x, point.y).matrixTransform(ctm);
      best = Math.min(best, Math.hypot(screen.x - clientX, screen.y - clientY));
    }
    return best;
  }

  function findEdgeAtPoint(state, event) {
    if (!state?.model || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
    const graphNode = event.target?.closest?.("g.node, .training-neighborhood-node");
    if (graphNode) return null;
    const candidates = [];
    state.edgeHitLayer?.querySelectorAll("path").forEach((path) => {
      const edge = edgeFromTarget(state, path);
      if (edge) candidates.push({ path, edge });
    });
    state.model.edges.forEach((edge) => candidates.push({ path: edge.path, edge }));
    let best = null;
    candidates.forEach(({ path, edge }) => {
      const distance = edgeDistanceToPoint(path, event.clientX, event.clientY);
      if (!best || distance < best.distance) best = { edge, distance };
    });
    return best && best.distance <= 26 ? best.edge : null;
  }
  function installGraphModel(wrapper, state) {
    const svg = wrapper.querySelector("svg");
    if (!svg) return null;
    if (state.svg !== svg) {
      const restoreNeighborhood = state.mode === "neighborhood";
      const preservedCenter = state.centerNode;
      state.edgeHitLayer?.remove(); state.neighborhoodLayer?.remove(); state.toolbar?.remove(); state.actionBar?.remove();
      state.svg = svg; state.model = buildGraphModel(svg); state.mode = state.mode || "global";
      state.originalStyles = new Map();
      state.model.nodes.forEach(({ element }) => state.originalStyles.set(element, element.getAttribute("style")));
      state.model.edges.forEach(({ path }) => state.originalStyles.set(path, path.getAttribute("style")));
      replaceEdgeHitLayer(state, state.model.edges.map((edge) => ({ path: edge.path, source: edge.source, target: edge.target, edge })));
      if (restoreNeighborhood && preservedCenter && state.model.nodes.has(preservedCenter)) {
        nextFrame(() => enterNeighborhood(wrapper, state, preservedCenter));
      }
    }
    ensureToolbar(wrapper, state); return state;
  }

  function getGraphState(wrapper) {
    let state = graphStates.get(wrapper);
    if (!state) { state = { mode: "global", centerNode: null, svg: null, model: null, toolbar: null, actionBar: null, edgeHitLayer: null, neighborhoodLayer: null, originalStyles: new Map() }; graphStates.set(wrapper, state); }
    return installGraphModel(wrapper, state);
  }

  function restoreOriginalStyles(state) {
    state.originalStyles?.forEach((style, element) => {
      if (!element.isConnected) return;
      if (style == null) element.removeAttribute("style"); else element.setAttribute("style", style);
    });
  }

  function getEdge(state, source, target) {
    return state.model?.edges.find((edge) => edge.source === source && edge.target === target) || null;
  }

  function directNeighbors(state, centerId) {
    const upstream = state.model.edges.filter((edge) => edge.target === centerId).map((edge) => edge.source);
    const downstream = state.model.edges.filter((edge) => edge.source === centerId).map((edge) => edge.target);
    return { upstream: [...new Set(upstream)], downstream: [...new Set(downstream)] };
  }

  function createSvgText(text, x, y) {
    const label = document.createElementNS(SVG_NS, "text"); label.setAttribute("class", "training-neighborhood-label");
    label.setAttribute("x", String(x)); label.setAttribute("y", String(y)); label.textContent = text; return label;
  }

  function makeLocalPath(source, target, sourceSize, targetSize) {
    const direction = target.x >= source.x ? 1 : -1;
    const startX = source.x + direction * sourceSize.width * .5;
    const endX = target.x - direction * targetSize.width * .5;
    const bend = Math.max(50, Math.abs(endX - startX) * .42);
    return `M ${startX} ${source.y} C ${startX + direction * bend} ${source.y}, ${endX - direction * bend} ${target.y}, ${endX} ${target.y}`;
  }

  function buildNeighborhood(wrapper, state, centerId) {
    const { svg, model } = state; if (!svg || !model.nodes.has(centerId)) return null;
    state.neighborhoodLayer?.remove(); state.edgeHitLayer?.remove();
    const view = getViewBox(svg), centerNode = model.nodes.get(centerId).element;
    const neighbors = directNeighbors(state, centerId);
    const center = { x: view.x + view.width / 2, y: view.y + view.height / 2 };
    const sideGap = clamp(view.width * .09, 140, 280);
    const layout = new Map();
    const sizes = new Map();
    model.nodes.forEach(({ id, element }) => { sizes.set(id, nodeSizeSvg(svg, element)); });
    const placeSide = (ids, x) => {
      const total = ids.reduce((sum, id) => sum + Math.max(sizes.get(id)?.height || 44, 44), 0) + Math.max(0, ids.length - 1) * 38;
      let y = center.y - total / 2;
      ids.forEach((id) => { const h = Math.max(sizes.get(id)?.height || 44, 44); layout.set(id, { x, y: y + h / 2 }); y += h + 38; });
    };
    layout.set(centerId, center); placeSide(neighbors.upstream, center.x - sideGap); placeSide(neighbors.downstream, center.x + sideGap);

    model.nodes.forEach(({ id, element }) => {
      element.classList.remove("training-center-background", "training-neighbor-background");
      if (id === centerId) element.classList.add("training-center-background");
      else if (layout.has(id)) element.classList.add("training-neighbor-background");
      element.style.opacity = id === centerId ? ".08" : (layout.has(id) ? ".36" : ".16");
      element.style.transformBox = "fill-box";
      element.style.transformOrigin = "center";
      element.style.transform = id === centerId ? "" : (layout.has(id) ? "scale(.86)" : "scale(.72)");
    });
    const layer = document.createElementNS(SVG_NS, "g"); layer.setAttribute("class", "training-neighborhood-layer");
    const edgesLayer = document.createElementNS(SVG_NS, "g"); edgesLayer.setAttribute("class", "training-neighborhood-edges"); layer.appendChild(edgesLayer);
    const nodesLayer = document.createElementNS(SVG_NS, "g"); nodesLayer.setAttribute("class", "training-neighborhood-nodes"); layer.appendChild(nodesLayer);
    const hitPaths = [];

    model.edges.forEach(({ path }) => { path.style.opacity = ".12"; });
    const importantEdges = model.edges.filter((edge) => edge.source === centerId || edge.target === centerId);
    importantEdges.forEach((edge) => {
      const source = layout.get(edge.source), target = layout.get(edge.target);
      if (!source || !target) return;
      const path = document.createElementNS(SVG_NS, "path"); path.setAttribute("class", "training-neighborhood-edge");
      path.setAttribute("d", makeLocalPath(source, target, sizes.get(edge.source), sizes.get(edge.target)));
      const markerEnd = edge.path.getAttribute("marker-end"); if (markerEnd) path.setAttribute("marker-end", markerEnd);
      edgesLayer.appendChild(path);
      hitPaths.push({ path, source: edge.source, target: edge.target, edge });
      if (edge.label) edgesLayer.appendChild(createSvgText(edge.label, (source.x + target.x) / 2, (source.y + target.y) / 2 - 10));
    });

    const svgRect = svg.getBoundingClientRect();
    layout.forEach((targetPoint, id) => {
      const original = model.nodes.get(id)?.element; if (!original) return;
      const holder = document.createElementNS(SVG_NS, "g");
      const originalCenter = nodeCenterSvg(svg, original);
      const isCenter = id === centerId, scale = isCenter ? 1.45 : 1.12;
      holder.setAttribute("class", `training-neighborhood-node ${isCenter ? "training-neighborhood-center" : "training-neighborhood-neighbor"}`);
      holder.setAttribute("transform", `translate(${targetPoint.x} ${targetPoint.y}) scale(${scale}) translate(${-originalCenter.x} ${-originalCenter.y})`);
      const clone = original.cloneNode(true);
      clone.removeAttribute("id");
      clone.classList.remove("training-center-background", "training-neighbor-background");
      clone.classList.add("training-neighborhood-clone");
      clone.removeAttribute("style");
      holder.appendChild(clone); nodesLayer.appendChild(holder);
    });
    svg.appendChild(layer); state.neighborhoodLayer = layer;
    replaceEdgeHitLayer(state, hitPaths.map((entry) => ({ ...entry, path: entry.path })));
    return { layer, layout, center, centerNode, view, svgRect };
  }

  function fitNeighborhood(wrapper, state, built) {
    const content = wrapper.querySelector(".mermaid-content") || wrapper.querySelector(".mermaid") || wrapper;
    nextFrame(() => {
      if (!built?.layer?.isConnected || !content?.isConnected) return;
      const previousTransform = content.style.transform;
      const previousOrigin = content.style.transformOrigin;
      // Measure in the untransformed SVG coordinate frame, not inside the old global zoom.
      content.style.transform = "none";
      content.style.transformOrigin = "0 0";
      const layerRect = built.layer.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      const wrapperWidth = Math.max(wrapper.clientWidth, 1);
      const wrapperHeight = Math.max(wrapper.clientHeight, 260);
      const boxWidth = layerRect.width;
      const boxHeight = layerRect.height;
      const localCenterX = layerRect.left - contentRect.left + boxWidth / 2;
      const localCenterY = layerRect.top - contentRect.top + boxHeight / 2;
      const valid = [boxWidth, boxHeight, localCenterX, localCenterY, contentRect.width, contentRect.height].every(Number.isFinite) && boxWidth > 0 && boxHeight > 0;
      if (!valid) {
        content.style.transform = previousTransform;
        content.style.transformOrigin = previousOrigin;
        setStatus(wrapper, state.centerNode);
        return;
      }
      const targetScale = clamp(Math.min(wrapperWidth / (boxWidth * 1.16), wrapperHeight / (boxHeight * 1.16)), 1.25, 3.8);
      const targetX = wrapperWidth / 2 - localCenterX * targetScale;
      const targetY = wrapperHeight / 2 - localCenterY * targetScale;
      if (![targetScale, targetX, targetY].every(Number.isFinite)) {
        content.style.transform = previousTransform;
        content.style.transformOrigin = previousOrigin;
        setStatus(wrapper, state.centerNode);
        return;
      }
      content.style.transformOrigin = "0 0";
      content.style.transform = `translate(${targetX}px, ${targetY}px) scale(${targetScale})`;
      state.neighborhoodTransform = { x: targetX, y: targetY, scale: targetScale };
      setStatus(wrapper, state.centerNode);
      nextFrame(() => wrapper.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" }));
    });
  }
  function enterNeighborhood(wrapper, state, centerId) {
    state.centerNode = centerId || state.centerNode || [...state.model.nodes.keys()][0];
    wrapper.dataset.trainingFocusNode = state.centerNode;
    state.mode = "neighborhood";
    updateToolbar(state);
    hideEdgeActionBar(state);
    const content = wrapper.querySelector(".mermaid-content") || wrapper.querySelector(".mermaid") || wrapper;
    // Keep the user's global zoom/pan intact; neighborhood mode owns a separate transform.
    if (!state.globalTransform) state.globalTransform = { transform: content.style.transform, transformOrigin: content.style.transformOrigin };
    restoreOriginalStyles(state);
    state.model.nodes.forEach(({ element }) => element.classList.remove("training-center-background", "training-neighbor-background"));
    const token = (state.neighborhoodToken || 0) + 1;
    state.neighborhoodToken = token;
    nextFrame(() => {
      if (token !== state.neighborhoodToken || state.mode !== "neighborhood") return;
      const built = buildNeighborhood(wrapper, state, state.centerNode);
      if (built) fitNeighborhood(wrapper, state, built);
    });
  }
  function leaveNeighborhood(wrapper, state) {
    state.neighborhoodLayer?.remove(); state.neighborhoodLayer = null; state.edgeHitLayer?.remove(); state.edgeHitLayer = null;
    state.model?.nodes.forEach(({ element }) => element.classList.remove("training-center-background", "training-neighbor-background"));
    restoreOriginalStyles(state);
    const content = wrapper.querySelector(".mermaid-content") || wrapper.querySelector(".mermaid") || wrapper;
    const saved = state.globalTransform;
    if (saved) { content.style.transform = saved.transform || ""; content.style.transformOrigin = saved.transformOrigin || ""; }
    state.globalTransform = null; state.neighborhoodTransform = null;
    replaceEdgeHitLayer(state, state.model.edges.map((edge) => ({ path: edge.path, source: edge.source, target: edge.target, edge })));
    state.mode = "global"; updateToolbar(state); hideEdgeActionBar(state);
    clearFocus(wrapper); if (state.centerNode) { const node = state.model.nodes.get(state.centerNode)?.element; if (node) addFocusRing(state.svg, node); setStatus(wrapper, state.centerNode); }
  }

  function setMode(wrapper, mode) {
    const state = getGraphState(wrapper); if (!state) return;
    if (mode === "neighborhood") enterNeighborhood(wrapper, state, state.centerNode || wrapper.dataset.trainingFocusNode);
    else if (state.mode !== "global") leaveNeighborhood(wrapper, state);
    else updateToolbar(state);
  }

  function selectCenter(wrapper, nodeId) {
    const state = getGraphState(wrapper); if (!state || !state.model.nodes.has(nodeId)) return;
    state.centerNode = nodeId; wrapper.dataset.trainingFocusNode = nodeId;
    if (state.mode === "neighborhood") enterNeighborhood(wrapper, state, nodeId);
  }

  function resetGraph() {
    const wrapper = getGraphWrapper(); if (!wrapper) return;
    const state = getGraphState(wrapper); if (!state) return;
    if (state.mode !== "global") leaveNeighborhood(wrapper, state);
    const content = wrapper.querySelector(".mermaid-content") || wrapper.querySelector(".mermaid") || wrapper;
    const resetButton = getNativeResetButton(wrapper); if (resetButton) resetButton.click(); else restoreBaseTransform(wrapper, content);
    clearFocus(wrapper); state.centerNode = null; delete wrapper.dataset.trainingFocusNode; setStatus(wrapper, ""); hideEdgeActionBar(state);
    wrapper.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  }

  function focusNode(nodeId, attempt = 0, nativeResetDone = false) {
    const wrapper = getGraphWrapper(); const state = wrapper && getGraphState(wrapper);
    const svg = state?.svg || wrapper?.querySelector("svg");
    const content = wrapper?.querySelector(".mermaid-content") || wrapper?.querySelector(".mermaid") || wrapper;
    const node = state?.model?.nodes.get(nodeId)?.element || findMermaidNode(svg, nodeId);
    if (!wrapper || !svg || !content || !node) {
      if (attempt < 20) window.setTimeout(() => focusNode(nodeId, attempt + 1, nativeResetDone), 150);
      return;
    }
    if (state.mode === "neighborhood") {
      state.centerNode = nodeId;
      wrapper.dataset.trainingFocusNode = nodeId;
      enterNeighborhood(wrapper, state, nodeId);
      return;
    }
    selectCenter(wrapper, nodeId);
    clearFocus(wrapper); hideEdgeActionBar(state); rememberBaseTransform(wrapper, content);
    if (!nativeResetDone) { resetNativeView(wrapper, content); nextFrame(() => focusNode(nodeId, attempt + 1, true)); return; }
    const previousTransform = content.style.transform; content.style.transform = "none";
    const contentRect = content.getBoundingClientRect(), nodeRect = node.getBoundingClientRect();
    const nodeCenterX = nodeRect.left - contentRect.left + nodeRect.width / 2, nodeCenterY = nodeRect.top - contentRect.top + nodeRect.height / 2;
    const widthBasis = Math.max(nodeRect.width, 1), heightBasis = Math.max(nodeRect.height, 1);
    const scale = clamp(Math.min(wrapper.clientWidth / (widthBasis * 3.8), Math.max(wrapper.clientHeight, 260) / (heightBasis * 3.8)), MIN_SCALE, MAX_SCALE);
    const targetX = wrapper.clientWidth / 2 - nodeCenterX * scale, targetY = Math.max(wrapper.clientHeight, 260) / 2 - nodeCenterY * scale;
    content.style.transform = previousTransform;
    const current = parseTransform(previousTransform); dispatchNativeWheel(wrapper, scale, current.scale);
    const afterZoom = parseTransform(content.style.transform); dispatchNativePan(wrapper, targetX - afterZoom.x, targetY - afterZoom.y);
    const finalTransform = parseTransform(content.style.transform);
    if (Math.abs(finalTransform.scale - scale) > .05) { content.style.transformOrigin = "0 0"; content.style.transform = `translate(${targetX}px, ${targetY}px) scale(${scale})`; }
    content.dataset.trainingFocusNode = nodeId; wrapper.dataset.trainingFocusNode = nodeId;
    addFocusRing(svg, node); setStatus(wrapper, nodeId);
    nextFrame(() => wrapper.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" }));
  }

  function edgeFromTarget(state, target) {
    const source = target?.dataset?.edgeSource;
    const destination = target?.dataset?.edgeTarget;
    return source && destination ? getEdge(state, source, destination) || { source, target: destination, id: target.dataset.edgeId || "" } : null;
  }

  function edgeFromOriginalPath(state, target) {
    const path = target?.closest?.('g.edgePath path, path.flowchart-link, path[id^="L-"]');
    return path ? state.model?.edges.find((edge) => edge.path === path) || null : null;
  }
  function handleEdgePointerDown(event) {
    if (event.button !== 0) return;
    const target = event.target;
    const wrapper = target.closest?.(".mermaid-wrapper") || getGraphWrapper();
    if (!wrapper || !wrapper.contains(target)) return;
    const state = getGraphState(wrapper);
    if (!state?.model || target.closest?.("g.node, .training-neighborhood-node, .training-focus-toolbar, .training-edge-action-bar")) return;
    const hit = target.closest?.(".training-edge-hit, .training-neighborhood-edge-hit");
    const edge = (hit && edgeFromTarget(state, hit)) || edgeFromOriginalPath(state, target) || findEdgeAtPoint(state, event);
    if (!edge) return;
    event.preventDefault(); event.stopImmediatePropagation();
    showEdgeActionBar(wrapper, state, edge, event.clientX, event.clientY);
    state.actionBar.dataset.edgeSource = edge.source; state.actionBar.dataset.edgeTarget = edge.target;
  }

  function handleClick(event) {
    const target = event.target;
    const wrapper = target.closest?.(".mermaid-wrapper") || getGraphWrapper();
    const state = wrapper && getGraphState(wrapper);
    const modeButton = target.closest?.("button[data-mode]");
    if (modeButton && state && modeButton.closest(".training-focus-toolbar")) {
      event.preventDefault(); event.stopPropagation(); setMode(wrapper, modeButton.dataset.mode); return;
    }
    const edgeAction = target.closest?.("button[data-edge-action]");
    if (edgeAction && state) {
      event.preventDefault(); event.stopPropagation();
      const bar = edgeAction.closest(".training-edge-action-bar"), source = bar?.dataset.edgeSource || state.actionBar?.dataset.edgeSource, destination = bar?.dataset.edgeTarget || state.actionBar?.dataset.edgeTarget;
      if (edgeAction.dataset.edgeAction === "close") hideEdgeActionBar(state);
      else if (source && destination) focusNode(edgeAction.dataset.edgeAction === "upstream" ? source : destination);
      return;
    }
    const graphNode = target.closest?.("g.node");
    if (graphNode && state && graphNode.closest(".mermaid-wrapper") === wrapper) {
      const id = stripMermaidNodeId(graphNode.id); if (state.model.nodes.has(id)) { event.preventDefault(); event.stopPropagation(); selectCenter(wrapper, id); }
    }
    const link = target.closest?.(LINK_SELECTOR); if (!link) return;
    event.preventDefault(); event.stopPropagation();
    const nodeId = getNodeId(link); if (!nodeId) return;
    if (nodeId === "__RESET__") resetGraph(); else focusNode(nodeId);
  }

  function install() {
    if (window.__trainingFocusScriptInstalled) return;
    installStyle(); window.__trainingFocusScriptInstalled = true;
    document.documentElement.dataset.trainingFocusScriptLoaded = "true"; window.__trainingFocusScriptLoaded = true;
    document.addEventListener("pointerdown", handleEdgePointerDown, true);
    document.addEventListener("click", handleClick, true);
    const refresh = () => { const wrapper = getGraphWrapper(); if (wrapper) getGraphState(wrapper); };
    refresh();
    const observer = new MutationObserver(() => { if (document.documentElement.dataset.trainingFocusScriptLoaded) refresh(); });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true }); else install();
})();
