export type Point = { x: number; y: number };
export type MarkupKind = "pen" | "eraser" | "rectangle" | "ellipse" | "line" | "arrow" | "text";
export type Markup = { id: string; kind: MarkupKind; points: Point[]; color: string; width: number; text?: string };
export type MarkupHistory = { items: Markup[]; past: Markup[][]; future: Markup[][] };
export const emptyMarkup: MarkupHistory = { items: [], past: [], future: [] };

export function markupHistory(state: MarkupHistory, action: { type: "commit"; items: Markup[] } | { type: "undo" | "redo" | "reset" }): MarkupHistory {
  if (action.type === "reset") return emptyMarkup;
  if (action.type === "commit") return { items: action.items, past: [...state.past.slice(-39), state.items], future: [] };
  if (action.type === "undo" && state.past.length) return { items: state.past.at(-1)!, past: state.past.slice(0, -1), future: [state.items, ...state.future] };
  if (action.type === "redo" && state.future.length) return { items: state.future[0], past: [...state.past, state.items], future: state.future.slice(1) };
  return state;
}

export function markupBounds(item: Markup) {
  const xs = item.points.map(p => p.x), ys = item.points.map(p => p.y);
  const fontSize = Math.max(16, item.width * 5);
  return {
    x: Math.min(...xs), y: Math.min(...ys),
    width: item.kind === "text" ? Math.max(fontSize, (item.text?.length ?? 0) * fontSize * 0.65) : Math.max(...xs) - Math.min(...xs),
    height: item.kind === "text" ? fontSize * 1.2 : Math.max(...ys) - Math.min(...ys),
  };
}

export function hitMarkup(items: Markup[], point: Point, tolerance: number) {
  return items.findLast(item => {
    if (item.kind === "eraser") return false;
    const b = markupBounds(item), padding = Math.max(tolerance, item.width / 2);
    return point.x >= b.x - padding && point.x <= b.x + b.width + padding && point.y >= b.y - padding && point.y <= b.y + b.height + padding;
  });
}

export function moveMarkup(item: Markup, x: number, y: number): Markup {
  return { ...item, points: item.points.map(p => ({ x: p.x + x, y: p.y + y })) };
}

export function drawMarkup(ctx: CanvasRenderingContext2D, items: Markup[]) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const item of items) {
    const start = item.points[0], end = item.points.at(-1)!;
    if (!start) continue;
    ctx.save();
    ctx.globalCompositeOperation = item.kind === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = ctx.fillStyle = item.color;
    ctx.lineWidth = item.width; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath();
    if (item.kind === "text") {
      ctx.font = `${Math.max(16, item.width * 5)}px sans-serif`;
      ctx.textBaseline = "top"; ctx.fillText(item.text ?? "", start.x, start.y);
    } else if (item.kind === "rectangle") {
      ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
    } else if (item.kind === "ellipse") {
      ctx.ellipse((start.x + end.x) / 2, (start.y + end.y) / 2, Math.abs(end.x - start.x) / 2, Math.abs(end.y - start.y) / 2, 0, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.moveTo(start.x, start.y);
      for (const point of item.points.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.stroke();
      if (item.kind === "arrow") {
        const angle = Math.atan2(end.y - start.y, end.x - start.x), length = Math.max(12, item.width * 4);
        ctx.beginPath();
        ctx.moveTo(end.x - length * Math.cos(angle - Math.PI / 6), end.y - length * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(end.x, end.y);
        ctx.lineTo(end.x - length * Math.cos(angle + Math.PI / 6), end.y - length * Math.sin(angle + Math.PI / 6)); ctx.stroke();
      }
      if (item.points.length === 1) { ctx.beginPath(); ctx.arc(start.x, start.y, item.width / 2, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
  }
}
