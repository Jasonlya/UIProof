/**
 * 生成本次 UI 性能测试的独立 HTML 报告（可 blob URL 打开）
 */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderTierTable(title, tierClass, rows) {
  if (!rows || !rows.length) {
    return `<section class="tier ${tierClass}"><h3>${esc(title)}</h3><p class="empty">本段无匹配事件（本段 trace 中无对应名称且含 dur 的切片）</p></section>`;
  }
  let body = '';
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const name = r.name || '';
    // 根据常见事件名给出“热点”底色（仅用于视觉强调，不影响数据）
    const warn = /^(DroppedFrame|Canvas2D|Paint|CompositeLayers|CompositeLayer|RunTask|V8\.Execute|FunctionCall|GCEvent|UpdateLayerTree|Layout|Scroll|Resize|TimerFire|EvaluateScript|InputEvent|EventDispatch)$/i.test(name);
    const c = r.count != null ? r.count : '—';
    const total = r.totalMs != null ? r.totalMs.toFixed(2) : '—';
    const max = r.maxMs != null ? r.maxMs.toFixed(2) : '—';
    const avg = r.avgMs != null ? r.avgMs.toFixed(2) : '—';
    body += `<tr class="${warn ? 'hot' : ''}"><td>${esc(name)}</td><td class="num">${esc(String(c))}</td><td class="num">${esc(total)}</td><td class="num">${esc(max)}</td><td class="num">${esc(avg)}</td></tr>`;
  }
  return `<section class="tier ${tierClass}"><h3>${esc(title)}</h3><table><thead><tr><th>指标</th><th>次数</th><th>总耗时(ms)</th><th>最大单次(ms)</th><th>均值(ms)</th></tr></thead><tbody>${body}</tbody></table></section>`;
}

function renderSegment(seg) {
  const heading = esc(seg.heading || '');
  const sum = seg.summary || {};
  const note = sum.perfNote ? `<p class="note">${esc(sum.perfNote)}</p>` : '';
  const pm = sum.perfMetrics || {};
  return `<div class="segment"><h2>${heading}</h2>${note}
    ${renderTierTable('P0（画布/主线程负载：DroppedFrame、Canvas2D、Paint、CompositeLayers 等）', 'p0', pm.p0)}
    ${renderTierTable('P1（脚本/内存：V8.Execute、RunTask、FunctionCall、GCEvent、UpdateLayerTree 等）', 'p1', pm.p1)}
    ${renderTierTable('P2（样式/DOM：EventDispatch、InputEvent、TimerFire、Layout、Scroll、Resize、EvaluateScript 等）', 'p2', pm.p2)}
    ${pm.other && pm.other.length ? renderTierTable('其它指标', 'other', pm.other) : ''}
  </div>`;
}

/**
 * @param {{ title: string, perfMode: string, segments: Array<{ heading: string, summary: object }>, generatedAt: string }} data
 */
export function generatePerfReportHtml(data) {
  const title = esc(data.title || 'UI 性能测试报告');
  const mode = esc(data.perfMode || '');
  const at = esc(data.generatedAt || new Date().toISOString());
  let segs = '';
  const list = data.segments || [];
  for (let i = 0; i < list.length; i++) {
    segs += renderSegment(list[i]);
  }
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<style>
body{font-family:system-ui,sans-serif;margin:24px;background:#f6f7f9;color:#222}
h1{font-size:1.25rem;margin:0 0 8px}
.meta{color:#666;font-size:13px;margin-bottom:24px}
.segment{border:1px solid #e0e0e0;border-radius:8px;padding:16px;margin-bottom:20px;background:#fff}
.segment h2{font-size:1rem;margin:0 0 12px}
.note{font-size:12px;color:#555;margin:0 0 12px;line-height:1.5}
.tier{margin-bottom:16px}
.tier h3{font-size:13px;margin:0 0 8px}
.tier.p0 h3{color:#b45309}
.tier.p1 h3{color:#1d4ed8}
.tier.p2 h3{color:#047857}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #eee}
th{background:#f9fafb;font-weight:600}
.num{font-variant-numeric:tabular-nums;white-space:nowrap}
tr.hot td{background:#fff7ed}
.empty{color:#888;font-size:12px}
</style></head><body>
<h1>${title}</h1>
<div class="meta">采集模式：${mode} · 生成时间：${at}</div>
${segs}
</body></html>`;
}
