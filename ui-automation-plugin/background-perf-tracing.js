/**
 * 扩展内性能采集：chrome.debugger + CDP Tracing.start（轻量类别 + 小 buffer，避免全量 categories 崩溃）
 */

const DEBUGGER_PROTOCOL_VERSION = '1.3';

/** 仅 3 类，覆盖 RunTask/Layout/Paint/V8/cc 等，远低于 getCategories 全量 */
const PERF_CATEGORIES = ['devtools.timeline', 'v8', 'cc'];

const MAX_DURATION_ROWS = 120;

/** 与 ReturnAsStream 并行：部分环境下 tracingComplete 无 stream，事件只在 dataCollected 里 */
const dataCollectedByTabId = new Map();

/** Performance.getMetrics：start/end 区间差值基线 */
const metricsBaselineByTabId = new Map();

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method !== 'Tracing.dataCollected' || source.tabId == null) return;
  if (!dataCollectedByTabId.has(source.tabId)) return;
  const value = params && params.value;
  if (!Array.isArray(value) || !value.length) return;
  const buf = dataCollectedByTabId.get(source.tabId);
  for (let i = 0; i < value.length; i++) buf.push(value[i]);
});

/**
 * trace 事件 name 子串 → P0/P1/P2（与业务约定一致）
 * 同档内按字符串长度降序匹配，避免短串误伤（如 UpdateLayers 命中 UpdateLayerTree）。
 */
const TRACE_NAME_PRIORITY = {
  p0: [
    'CompositeLayers',
    'CompositeLayer',
    'DroppedFrame',
    'Canvas2D',
    'Paint',
    'Raster',
    'DrawFrame',
  ],
  p1: [
    'UpdateLayerTree',
    'V8.Execute',
    'FunctionCall',
    'RunTask',
    'ThreadPool_RunTask',
    'GCEvent',
    'IncrementalMarking',
    'MajorGC',
    'MinorGC',
    'V8.GC',
  ],
  p2: [
    'EvaluateScript',
    'TimerFire',
    'EventDispatch',
    'InputEvent',
    'ScrollUpdate',
    'ScrollBegin',
    'Scroll',
    'Resize',
    'Layout',
    'HitTest',
    'FireIdleCallback',
  ],
};

const TRACE_PATTERNS_SORTED = /** @type {Record<string, string[]>} */ ({});
for (const tier of ['p0', 'p1', 'p2']) {
  TRACE_PATTERNS_SORTED[tier] = [...TRACE_NAME_PRIORITY[tier]].sort((a, b) => b.length - a.length);
}

/**
 * 归并 V8 相关事件名，降低汇总表“行数噪声”
 * 仅做名字归并，不改变 dur 过滤/分桶逻辑。
 */
function normalizeTraceEventName(name) {
  const n = String(name || '');
  // V8 执行相关统一到 V8.Execute
  if (n.includes('V8.Execute')) return 'V8.Execute';

  // V8 GC/标记/回收相关统一到 V8.GC
  if (
    n.includes('GCEvent') ||
    n.includes('V8.GC') ||
    n.includes('IncrementalMarking') ||
    n.includes('MajorGC') ||
    n.includes('MinorGC')
  ) {
    return 'V8.GC';
  }

  return name;
}

/**
 * Performance.getMetrics 返回的 metrics 数组 -> { [name]: value }
 * 注意：value 在协议中通常为秒（sec），用于时我们会转为 ms。
 */
function metricsArrayToMap(metricsRes) {
  const arr = metricsRes && Array.isArray(metricsRes.metrics) ? metricsRes.metrics : [];
  const out = {};
  for (let i = 0; i < arr.length; i++) {
    const it = arr[i];
    if (!it || typeof it.name !== 'string') continue;
    const v = typeof it.value === 'number' ? it.value : Number(it.value);
    if (!Number.isFinite(v)) continue;
    out[it.name] = v;
  }
  return out;
}

function getDeltaSafeNumber(endVal, startVal) {
  if (typeof endVal !== 'number' || typeof startVal !== 'number') return null;
  const d = endVal - startVal;
  if (!Number.isFinite(d)) return null;
  return d;
}

const METRIC_DURATION_TO_TIER = {
  // 渲染/布局类
  p0: ['TaskDuration', 'LayoutDuration', 'RecalcStyleDuration'],
  // 脚本/编译类
  p1: ['ScriptDuration', 'V8CompileDuration'],
  // 其他/线程类
  p2: ['TaskOtherDuration', 'ThreadTime', 'DevToolsCommandDuration'],
};

// 对应计数指标：用于补充“次数”（部分指标为计数器）
const METRIC_DURATION_TO_COUNT = {
  LayoutDuration: 'LayoutCount',
  RecalcStyleDuration: 'RecalcStyleCount',
};

function buildPerfMetricsFromGetMetricsDelta(startMetrics, endMetrics) {
  /** @type {{p0: any[], p1: any[], p2: any[], other: any[]}} */
  const perfMetrics = { p0: [], p1: [], p2: [], other: [] };

  const tiers = ['p0', 'p1', 'p2'];
  for (let t = 0; t < tiers.length; t++) {
    const tierKey = tiers[t];
    const durationMetricNames = METRIC_DURATION_TO_TIER[tierKey] || [];
    const rows = [];

    for (let i = 0; i < durationMetricNames.length; i++) {
      const metricName = durationMetricNames[i];
      const s = startMetrics ? startMetrics[metricName] : undefined;
      const e = endMetrics ? endMetrics[metricName] : undefined;
      const deltaSec = getDeltaSafeNumber(e, s);
      if (deltaSec == null) continue;

      const totalMs = Math.max(0, deltaSec * 1000);
      const countMetricName = METRIC_DURATION_TO_COUNT[metricName];

      let count = 1;
      if (countMetricName) {
        const cs = startMetrics ? startMetrics[countMetricName] : undefined;
        const ce = endMetrics ? endMetrics[countMetricName] : undefined;
        const deltaCount = getDeltaSafeNumber(ce, cs);
        if (deltaCount != null) {
          count = Math.max(0, Math.floor(deltaCount));
        }
      }

      const avgMs = count > 0 ? totalMs / count : 0;
      // getMetrics 不提供“最大单次”，这里用均值近似最大值
      const maxMs = avgMs;
      rows.push({
        name: metricName,
        count,
        totalMs,
        maxMs,
        avgMs,
        display: `${count} 次 · 总 ${totalMs.toFixed(2)} ms · 最大 ${maxMs.toFixed(2)} ms · 均 ${avgMs.toFixed(2)} ms`,
      });
    }

    rows.sort((a, b) => b.totalMs - a.totalMs);
    perfMetrics[tierKey] = rows;
  }

  return perfMetrics;
}

async function getPerformanceMetricsSnapshot(tabId) {
  const res = await sendCommand(tabId, 'Performance.getMetrics', {});
  return metricsArrayToMap(res);
}

function sendCommand(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

/**
 * CDP IO.read 的 data 为整段 base64，但可能拆成多块返回；必须在块与块之间拼接后再 atob，
 * 否则会在 base64 边界处截断，触发「The string to be decoded is not correctly encoded」。
 */
function base64ChunksToUtf8(chunksB64) {
  const joined = (chunksB64 || [])
    .filter((s) => s != null && s !== '')
    .join('')
    .replace(/\s/g, '');
  if (!joined) return '';
  try {
    const bin = atob(joined);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(u8);
  } catch (_) {
    // 极少数绑定层可能直接给出 UTF-8 明文
    return joined;
  }
}

function extractTraceEventsFromParsed(obj) {
  if (!obj) return [];
  if (Array.isArray(obj.traceEvents)) return obj.traceEvents;
  if (Array.isArray(obj)) return obj;
  return [];
}

function stopTracingAndReadStream(tabId) {
  return new Promise((resolve, reject) => {
    const onEvent = (source, method, params) => {
      if (source.tabId !== tabId || method !== 'Tracing.tracingComplete') return;
      chrome.debugger.onEvent.removeListener(onEvent);
      (async () => {
        const readMeta = {
          hadStream: false,
          parseError: /** @type {string | null} */ (null),
          ioChunkCount: 0,
          jsonLength: 0,
          streamEventCount: 0,
        };
        try {
          const handle = params && params.stream;
          if (!handle) {
            console.warn('[perf-tracing] tracingComplete 无 stream，将尝试使用 dataCollected 缓冲', { tabId });
            resolve({ traceEvents: [], readMeta });
            return;
          }
          readMeta.hadStream = true;
          const chunks = [];
          while (true) {
            const { data, eof } = await sendCommand(tabId, 'IO.read', { handle });
            if (data) chunks.push(data);
            if (eof) break;
          }
          readMeta.ioChunkCount = chunks.length;
          try {
            await sendCommand(tabId, 'IO.close', { handle });
          } catch (_) {}
          let obj;
          try {
            const jsonStr = base64ChunksToUtf8(chunks);
            readMeta.jsonLength = jsonStr.length;
            obj = JSON.parse(jsonStr);
          } catch (e) {
            readMeta.parseError = e?.message || String(e);
            console.warn('[perf-tracing] trace JSON 解析失败', { tabId, err: readMeta.parseError });
            obj = { traceEvents: [] };
          }
          if (obj && !obj.traceEvents && Array.isArray(obj)) obj = { traceEvents: obj };
          const traceEvents = extractTraceEventsFromParsed(obj);
          readMeta.streamEventCount = traceEvents.length;
          resolve({ traceEvents, readMeta });
        } catch (e) {
          reject(e);
        }
      })();
    };

    chrome.debugger.onEvent.addListener(onEvent);
    sendCommand(tabId, 'Tracing.end').catch((e) => {
      chrome.debugger.onEvent.removeListener(onEvent);
      reject(e);
    });
  });
}

function buildDurationSummary(events) {
  const totalEvents = events.length;
  const withDur = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (!e || typeof e.dur !== 'number' || e.dur < 0) continue;
    const name = String(e.name != null ? e.name : '(unnamed)');
    const normalizedName = normalizeTraceEventName(name);
    // 过滤掉不必要的 dur 事件：只保留 P0/P1/P2 关键词命中的事件明细（去噪）
    const tier = priorityForTraceName(name);
    if (tier === 'other') continue;
    withDur.push({
      name: normalizedName,
      cat: String(e.cat != null ? e.cat : ''),
      durMs: e.dur / 1000,
    });
  }
  withDur.sort((a, b) => b.durMs - a.durMs);
  const durationTotalWithDur = withDur.length;
  const durationTruncated = withDur.length > MAX_DURATION_ROWS;
  const durationEvents = durationTruncated ? withDur.slice(0, MAX_DURATION_ROWS) : withDur;
  return {
    totalEvents,
    durationEvents,
    durationTotalWithDur,
    durationTruncated,
  };
}

function priorityForTraceName(name) {
  const n = String(name || '');
  const keys = ['p0', 'p1', 'p2'];
  for (let k = 0; k < keys.length; k++) {
    const tier = keys[k];
    const list = TRACE_PATTERNS_SORTED[tier];
    for (let i = 0; i < list.length; i++) {
      if (n.includes(list[i])) return tier;
    }
  }
  return 'other';
}

function aggregateTracePerfMetrics(events) {
  const buckets = { p0: new Map(), p1: new Map(), p2: new Map(), other: new Map() };
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (!e || typeof e.dur !== 'number' || e.dur < 0) continue;
    const name = String(e.name != null ? e.name : '(unnamed)');
    const normalizedName = normalizeTraceEventName(name);
    const durMs = e.dur / 1000;
    const tier = priorityForTraceName(name);
    const map = buckets[tier] || buckets.other;
    if (!map.has(normalizedName)) {
      map.set(normalizedName, { name: normalizedName, count: 0, totalMs: 0, maxMs: 0 });
    }
    const row = map.get(normalizedName);
    row.count += 1;
    row.totalMs += durMs;
    if (durMs > row.maxMs) row.maxMs = durMs;
  }
  function mapToRows(m) {
    const arr = [];
    m.forEach((v) => {
      arr.push({
        name: v.name,
        count: v.count,
        totalMs: v.totalMs,
        maxMs: v.maxMs,
        avgMs: v.count ? v.totalMs / v.count : 0,
        display: `${v.count} 次 · 总 ${v.totalMs.toFixed(2)} ms · 最大 ${v.maxMs.toFixed(2)} ms · 均 ${(v.totalMs / v.count).toFixed(2)} ms`,
      });
    });
    arr.sort((a, b) => b.totalMs - a.totalMs);
    return arr;
  }
  return {
    p0: mapToRows(buckets.p0),
    p1: mapToRows(buckets.p1),
    p2: mapToRows(buckets.p2),
    other: mapToRows(buckets.other),
  };
}

export async function perfTracingStart(tabId) {
  if (tabId == null) {
    throw new Error('缺少 tabId');
  }
  await chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL_VERSION);
  dataCollectedByTabId.set(tabId, []);
  try {
    await sendCommand(tabId, 'Tracing.start', {
      traceConfig: {
        recordMode: 'recordUntilFull',
        traceBufferSizeInKb: 4096,
        includedCategories: PERF_CATEGORIES,
      },
      transferMode: 'ReturnAsStream',
      streamFormat: 'json',
    });
    return { ok: true };
  } catch (e) {
    dataCollectedByTabId.delete(tabId);
    try {
      await chrome.debugger.detach({ tabId });
    } catch (_) {}
    throw e;
  }
}

export async function perfTracingStop(tabId) {
  if (tabId == null) {
    throw new Error('缺少 tabId');
  }
  try {
    const { traceEvents: streamEvents, readMeta } = await stopTracingAndReadStream(tabId);
    const collected = dataCollectedByTabId.get(tabId) || [];
    dataCollectedByTabId.delete(tabId);

    const useStream = streamEvents && streamEvents.length > 0;
    const events = useStream ? streamEvents : collected;
    const base = buildDurationSummary(events);
    const perfMetrics = aggregateTracePerfMetrics(events);

    const parts = [];
    if (readMeta) {
      parts.push(
        `stream: ${readMeta.hadStream ? '有' : '无'}，解析后 ${readMeta.streamEventCount} 条，IO 块 ${readMeta.ioChunkCount}，JSON 字节 ${readMeta.jsonLength}`,
      );
      if (readMeta.parseError) parts.push(`解析错误: ${readMeta.parseError}`);
    }
    parts.push(`dataCollected 缓冲: ${collected.length} 条`);
    const sourceHint = useStream ? '（来源：流式 JSON）' : collected.length ? '（来源：dataCollected）' : '';
    if (!events.length) {
      console.warn('[perf-tracing] 无可用 trace 事件', { tabId, readMeta, dataCollected: collected.length });
    }

    const summary = {
      collectionMode: 'Tracing',
      totalEvents: base.totalEvents,
      totalMetricsCount: base.totalEvents,
      durationEvents: base.durationEvents,
      durationTotalWithDur: base.durationTotalWithDur,
      durationTruncated: base.durationTruncated,
      perfMetrics,
      perfNote:
        '本段为 CDP Tracing（轻量类别 devtools.timeline + v8 + cc）；P0/P1/P2 按事件名归类汇总含 dur 的区间；明细表 durationEvents 仅保留关键词命中的 dur 事件（去噪）。',
      perfDiagnostic: `${parts.join('；')}${sourceHint}`,
    };
    return { ok: true, summary };
  } finally {
    try {
      await chrome.debugger.detach({ tabId });
    } catch (_) {}
  }
}
