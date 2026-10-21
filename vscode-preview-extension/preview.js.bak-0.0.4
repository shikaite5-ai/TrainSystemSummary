(() => {
  "use strict";

  const GRAPH_ANCHOR_IDS = ["training-integrated-graph", "integrated-training-graph"];
  const LINK_SELECTOR = 'a.training-focus-link, a.training-reset-link, a[data-focus-node], a[href="#training-integrated-graph"]';
  const STYLE_ID = "training-system-mermaid-focus-style";
  const baseTransforms = new WeakMap();
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
        position: absolute;
        left: 8px;
        bottom: 8px;
        z-index: 101;
        padding: 3px 8px;
        border-radius: 4px;
        color: var(--vscode-editor-foreground);
        background: color-mix(in srgb, var(--vscode-editorWidget-background) 88%, transparent);
        border: 1px solid var(--vscode-editorWidget-border, transparent);
        font-size: 12px;
        pointer-events: none;
      }
      .training-focus-ring {
        fill: rgba(255, 152, 0, .08);
        stroke: #ff9800;
        stroke-width: 4;
        stroke-dasharray: 9 6;
        vector-effect: non-scaling-stroke;
        pointer-events: none;
      }
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
      baseTransforms.set(wrapper, {
        transform: content.style.transform,
        transformOrigin: content.style.transformOrigin,
      });
    }
    const base = baseTransforms.get(wrapper);
    content.style.transformOrigin = base.transformOrigin || "0 0";
    return base;
  }

  function restoreBaseTransform(wrapper, content) {
    const base = baseTransforms.get(wrapper);
    if (!base) {
      content.style.transform = "";
      return;
    }
    content.style.transform = base.transform;
    content.style.transformOrigin = base.transformOrigin;
    baseTransforms.delete(wrapper);
  }

  function addFocusRing(svg, node) {
    const box = node.getBBox?.();
    if (!box || !Number.isFinite(box.width)) return;
    const ring = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    ring.setAttribute("class", "training-focus-ring");
    ring.setAttribute("x", String(box.x - 10));
    ring.setAttribute("y", String(box.y - 10));
    ring.setAttribute("width", String(box.width + 20));
    ring.setAttribute("height", String(box.height + 20));
    ring.setAttribute("rx", "8");
    svg.appendChild(ring);
  }

  function setStatus(wrapper, nodeId) {
    wrapper.querySelector(".training-focus-status")?.remove();
    const status = document.createElement("div");
    status.className = "training-focus-status";
    status.textContent = nodeId ? `当前聚焦：${nodeId}` : "已重置图形视图";
    wrapper.appendChild(status);
  }

  function getNativeResetButton(wrapper) {
    return wrapper.querySelector(".mermaid-zoom-reset-btn, .zoom-reset-btn");
  }

  function parseTransform(transform) {
    const source = String(transform || "");
    const translate = source.match(/translate\(\s*([-+]?\d*\.?\d+)px?\s*,\s*([-+]?\d*\.?\d+)px?\s*\)/i);
    const scale = source.match(/scale\(\s*([-+]?\d*\.?\d+)/i);
    return {
      x: translate ? Number(translate[1]) : 0,
      y: translate ? Number(translate[2]) : 0,
      scale: scale ? Number(scale[1]) : 1,
    };
  }

  function resetNativeView(wrapper, content) {
    const resetButton = getNativeResetButton(wrapper);
    if (resetButton) {
      resetButton.click();
      return true;
    }
    // VS Code's native Mermaid view normally exposes the reset button. This
    // fallback keeps the first focus usable if controls are hidden/disabled.
    content.style.transform = "none";
    return false;
  }

  function dispatchNativeWheel(wrapper, targetScale, currentScale) {
    if (!Number.isFinite(targetScale) || !Number.isFinite(currentScale) || currentScale <= 0) return;
    const factor = targetScale / currentScale;
    if (Math.abs(factor - 1) < 0.0001) return;
    const rect = wrapper.getBoundingClientRect();
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + Math.max(rect.height, 260) / 2,
      ctrlKey: true,
      deltaY: -(factor - 1) / NATIVE_WHEEL_SCALE_FACTOR,
      deltaMode: 0,
    });
    wrapper.dispatchEvent(event);
  }

  function dispatchNativePan(wrapper, deltaX, deltaY) {
    if (Math.abs(deltaX) < 0.01 && Math.abs(deltaY) < 0.01) return;
    const rect = wrapper.getBoundingClientRect();
    const startX = rect.left + 12;
    const startY = rect.top + 12;
    wrapper.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      clientX: startX,
      clientY: startY,
      altKey: true,
    }));
    document.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true,
      cancelable: true,
      buttons: 1,
      clientX: startX + deltaX,
      clientY: startY + deltaY,
      altKey: true,
    }));
    document.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 0,
      clientX: startX + deltaX,
      clientY: startY + deltaY,
      altKey: true,
    }));
  }

  function resetGraph() {
    const wrapper = getGraphWrapper();
    if (!wrapper) return;
    const content = wrapper.querySelector(".mermaid-content") || wrapper.querySelector(".mermaid") || wrapper;
    const resetButton = getNativeResetButton(wrapper);
    if (resetButton) resetButton.click();
    else restoreBaseTransform(wrapper, content);
    clearFocus(wrapper);
    delete wrapper.dataset.trainingFocusNode;
    setStatus(wrapper, "");
    wrapper.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  }

  function focusNode(nodeId, attempt = 0, nativeResetDone = false) {
    const wrapper = getGraphWrapper();
    const svg = wrapper?.querySelector("svg");
    const content = wrapper?.querySelector(".mermaid-content") || wrapper?.querySelector(".mermaid") || wrapper;
    const node = findMermaidNode(svg, nodeId);
    if (!wrapper || !svg || !content || !node) {
      if (attempt < 20) window.setTimeout(() => focusNode(nodeId, attempt + 1, nativeResetDone), 150);
      return;
    }

    clearFocus(wrapper);
    rememberBaseTransform(wrapper, content);

    // VS Code 1.142's Mermaid preview keeps zoom/pan in a private controller.
    // Reset that controller first, then use its own wheel/drag events to apply
    // the focus transform. Directly writing transform alone would be lost on
    // the next drag because the private controller still believes scale === 1.
    if (!nativeResetDone) {
      resetNativeView(wrapper, content);
      nextFrame(() => focusNode(nodeId, attempt + 1, true));
      return;
    }

    const previousTransform = content.style.transform;
    content.style.transform = "none";
    const contentRect = content.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const nodeCenterX = nodeRect.left - contentRect.left + nodeRect.width / 2;
    const nodeCenterY = nodeRect.top - contentRect.top + nodeRect.height / 2;
    const widthBasis = Math.max(nodeRect.width, 1);
    const heightBasis = Math.max(nodeRect.height, 1);
    const scale = clamp(
      Math.min(wrapper.clientWidth / (widthBasis * 3.8), Math.max(wrapper.clientHeight, 260) / (heightBasis * 3.8)),
      MIN_SCALE,
      MAX_SCALE,
    );
    const targetX = wrapper.clientWidth / 2 - nodeCenterX * scale;
    const targetY = Math.max(wrapper.clientHeight, 260) / 2 - nodeCenterY * scale;
    content.style.transform = previousTransform;

    const current = parseTransform(previousTransform);
    dispatchNativeWheel(wrapper, scale, current.scale);
    const afterZoom = parseTransform(content.style.transform);
    dispatchNativePan(wrapper, targetX - afterZoom.x, targetY - afterZoom.y);

    // If this preview does not expose the native controller, retain the
    // previous direct-transform behavior as a safe fallback.
    const finalTransform = parseTransform(content.style.transform);
    if (Math.abs(finalTransform.scale - scale) > 0.05) {
      content.style.transformOrigin = "0 0";
      content.style.transform = `translate(${targetX}px, ${targetY}px) scale(${scale})`;
    }

    content.dataset.trainingFocusNode = nodeId;
    wrapper.dataset.trainingFocusNode = nodeId;
    addFocusRing(svg, node);
    setStatus(wrapper, nodeId);
    nextFrame(() => wrapper.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" }));
  }

  function handleClick(event) {
    const link = event.target.closest?.(LINK_SELECTOR);
    if (!link) return;
    // Prevent the Markdown preview's native fragment jump before doing any DOM work.
    event.preventDefault();
    event.stopPropagation();
    const nodeId = getNodeId(link);
    if (!nodeId) return;
    if (nodeId === "__RESET__") resetGraph();
    else focusNode(nodeId);
  }

  function install() {
    installStyle();
    document.documentElement.dataset.trainingFocusScriptLoaded = "true";
    window.__trainingFocusScriptLoaded = true;
    document.addEventListener("click", handleClick, true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
