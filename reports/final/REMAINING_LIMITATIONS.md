# PIE — Remaining Limitations & Future Roadmap

**Document:** Remaining Limitations & Future Roadmap  
**Milestone:** v2.0 Master Release  
**Date:** 2026-11-13  

---

## 1. Known Technical Boundaries & Fail-Closed Behaviors

While PIE v2.0 resolves all major historical blockers and achieves 100% precision with 0.0% false repairs, certain technical boundaries remain intentional design decisions or areas for future optimization:

### 1. Canvas & WebGL Graphics Rendering
- **Boundary:** Applications that render UI components entirely onto HTML5 `<canvas>` or WebGL contexts (e.g. specialized mapping tools, 3D product visualizers, or certain charting engines) do not expose semantic DOM elements or standard accessibility trees.
- **Engine Behavior:** PIE recognizes that DOM nodes are inaccessible within the canvas surface, flags the failure with `EVIDENCE_DEFICIENCY`, and safely abstains rather than generating brittle pixel-coordinate clicks.
- **Future Direction:** Integration of multimodal visual grounding models to inspect rendered canvas elements and correlate visual bounding boxes with action intent.

### 2. Closed-Shadow DOM Piercing
- **Boundary:** Playwright natively pierces open shadow DOM roots (`open`), but elements enclosed within `closed` shadow roots prevent external DOM inspection.
- **Engine Behavior:** When an element is locked inside a closed shadow root without accessible ARIA labels exposed across the boundary, PIE safely halts and reports `OBSTRUCTED_ELEMENT`.
- **Future Direction:** Injecting browser runtime diagnostic proxies during exploratory tracing sessions to capture internal component state before shadow encapsulation.

### 3. Multi-Host Distributed Microservice Latency
- **Boundary:** When an action triggers cascading events across 5+ independent backend microservices with variable network latency exceeding 30 seconds, basic network request matching may encounter edge cases if services use uncoordinated WebSockets or polling intervals.
- **Engine Behavior:** PIE wraps actions in `Promise.all` with explicit status and URL predicates. If the request fails to resolve within the bounding timeout, PIE classifies the failure as `DYNAMIC_CONTENT_SLOW` or `BACKEND_500` and reports the pending trace.
- **Future Direction:** Deep OpenTelemetry trace correlation linking Playwright browser spans with backend distributed trace headers (`traceparent`).

### 4. Intentional Safe Abstention Rate (Non-Repairable 3.33% in Tier 2)
- **Boundary:** In 2 out of 60 Tier 2 DOM drift scenarios, the synthetic mutation completely deleted all distinguishing text, ARIA attributes, and container boundaries from the element.
- **Engine Behavior:** PIE correctly abstained (`strategy: 'ABSTAIN_AMBIGUOUS'`). This accounts for the 96.67% recall rate (58/60 repaired, 2 abstained). This is an intended safety feature: guessing on ambiguous elements is strictly prohibited by the Positional Invariant.
