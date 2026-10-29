// Claude's Messages API, the two ways Miracle AI's agents call it: streamed (the guide,
// whose words reach the member as they are written) and plain (the agents that answer
// by filling in a form: the Safety agent, the Synergy auditor and the final check).
export const API = 'https://api.anthropic.com/v1/messages';

export type Block = { type: string; [key: string]: unknown };
export type Message = { role: 'user' | 'assistant'; content: string | Block[] };
export type Result = { content: Block[]; stop: string | null; usage: Record<string, unknown> };
export type Tool = { name: string; description: string; input_schema: Record<string, unknown> };
export type CallOpts = { apiKey: string; fetchImpl?: typeof fetch; signal?: AbortSignal };

export class ApiError extends Error {
  constructor(readonly status: number, readonly kind: string, message: string) {
    super(message);
  }
  // Busy, rate-limited or a hiccup on Anthropic's side: worth one more try
  get retryable(): boolean {
    return this.status === 429 || this.status === 529 || this.status >= 500 ||
      this.kind === 'overloaded_error' || this.kind === 'api_error' || this.kind === 'network';
  }
  // The model isn't available to this key (retired, or not enabled): try the fallback model
  get missingModel(): boolean {
    return this.status === 404 || this.kind === 'not_found_error' ||
      (this.status === 400 && /model/i.test(this.message));
  }
}

const headers = (apiKey: string) => ({
  'content-type': 'application/json',
  'x-api-key': apiKey,
  'anthropic-version': '2023-06-01',
});

async function apiError(res: Response): Promise<ApiError> {
  let kind = 'http_error';
  let message = `Claude API ${res.status}`;
  try {
    const body = await res.json();
    kind = body?.error?.type ?? kind;
    message = `${message}: ${String(body?.error?.message ?? '').slice(0, 300)}`;
  } catch { /* not JSON */ }
  return new ApiError(res.status, kind, message);
}

// The 5.x models think adaptively and take an effort level; older ones take neither.
// "form" calls (a forced tool answer) turn thinking off where the model allows it, since a
// forced tool choice and thinking don't mix.
const GEN5 = /^claude-(opus|sonnet|haiku)-5|^claude-(fable|mythos)/;
export function tuning(model: string, opts: { form?: boolean; effort?: string } = {}): Record<string, unknown> {
  if (!GEN5.test(model)) return {};
  const out: Record<string, unknown> = { output_config: { effort: opts.effort ?? 'low' } };
  if (opts.form && /^claude-haiku-5/.test(model)) out.thinking = { type: 'disabled' };
  return out;
}
// Whether a form call can force the tool (thinking off, or a model that doesn't think)
export const canForceTool = (model: string) => !GEN5.test(model) || /^claude-haiku-5/.test(model);

// Server-sent events, one {event, data} at a time
export async function* sse(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  const flush = function* (final: boolean) {
    for (;;) {
      const m = /\r?\n\r?\n/.exec(buf);
      if (!m && !final) return;
      const raw = m ? buf.slice(0, m.index) : buf;
      buf = m ? buf.slice(m.index + m[0].length) : '';
      let event = 'message';
      const data: string[] = [];
      for (const line of raw.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length) yield { event, data: data.join('\n') };
      if (!m) return;
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      yield* flush(false);
    }
    if (buf.trim()) yield* flush(true);
  } finally {
    reader.releaseLock();
  }
}

// One streamed call. Text reaches onText as it arrives; the finished blocks (thinking with
// its signature, text, tool calls with their parsed input) come back in order, ready to be
// sent back as the assistant's turn in a tool loop.
export async function stream(
  req: Record<string, unknown>,
  opts: CallOpts & { onText?: (t: string) => void },
): Promise<Result> {
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(API, {
      method: 'POST', headers: headers(opts.apiKey), body: JSON.stringify({ ...req, stream: true }), signal: opts.signal,
    });
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    throw new ApiError(0, 'network', String(e).slice(0, 200));
  }
  if (!res.ok || !res.body) throw await apiError(res);
  const blocks: Block[] = [];
  const partial: string[] = [];
  let stop: string | null = null;
  let usage: Record<string, unknown> = {};
  for await (const { data } of sse(res.body)) {
    let ev: Record<string, any>;
    try { ev = JSON.parse(data); } catch { continue; }
    switch (ev.type) {
      case 'message_start':
        usage = { ...(ev.message?.usage ?? {}) };
        break;
      case 'content_block_start': {
        const b = { ...(ev.content_block ?? { type: 'unknown' }) } as Block;
        blocks[ev.index] = b;
        partial[ev.index] = '';
        if (b.type === 'text' && typeof b.text === 'string' && b.text) opts.onText?.(b.text);
        break;
      }
      case 'content_block_delta': {
        const b = blocks[ev.index];
        const d = ev.delta ?? {};
        if (!b) break;
        if (d.type === 'text_delta') {
          b.text = String(b.text ?? '') + d.text;
          opts.onText?.(d.text);
        } else if (d.type === 'input_json_delta') {
          partial[ev.index] += d.partial_json ?? '';
        } else if (d.type === 'thinking_delta') {
          b.thinking = String(b.thinking ?? '') + (d.thinking ?? '');
        } else if (d.type === 'signature_delta') {
          b.signature = String(b.signature ?? '') + (d.signature ?? '');
        }
        break;
      }
      case 'content_block_stop': {
        const b = blocks[ev.index];
        if (b?.type === 'tool_use') {
          try { b.input = partial[ev.index] ? JSON.parse(partial[ev.index]) : {}; } catch { b.input = {}; }
        }
        break;
      }
      case 'message_delta':
        stop = ev.delta?.stop_reason ?? stop;
        usage = { ...usage, ...(ev.usage ?? {}) };
        break;
      case 'error':
        throw new ApiError(ev.error?.type === 'overloaded_error' ? 529 : 500, ev.error?.type ?? 'api_error',
          String(ev.error?.message ?? 'stream error').slice(0, 300));
    }
  }
  return { content: blocks.filter(Boolean), stop, usage };
}

// One plain call
export async function call(req: Record<string, unknown>, opts: CallOpts): Promise<Result> {
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(API, {
      method: 'POST', headers: headers(opts.apiKey), body: JSON.stringify(req), signal: opts.signal,
    });
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    throw new ApiError(0, 'network', String(e).slice(0, 200));
  }
  if (!res.ok) throw await apiError(res);
  const data = await res.json();
  return { content: Array.isArray(data?.content) ? data.content : [], stop: data?.stop_reason ?? null, usage: data?.usage ?? {} };
}

// An agent that answers by filling in a form (a tool's input). Falls back to JSON in the
// text if the model wrote it out instead. Null if there's nothing readable.
export async function form<T>(
  tool: Tool,
  req: { model: string; system: string; messages: Message[]; max_tokens: number },
  opts: CallOpts,
): Promise<T | null> {
  const force = canForceTool(req.model);
  const r = await call({
    ...req,
    ...tuning(req.model, { form: true }),
    tools: [tool],
    tool_choice: force ? { type: 'tool', name: tool.name } : { type: 'auto' },
  }, opts);
  const use = r.content.find((b) => b.type === 'tool_use' && b.name === tool.name);
  if (use && use.input && typeof use.input === 'object') return use.input as T;
  const text = r.content.filter((b) => b.type === 'text').map((b) => String(b.text ?? '')).join('');
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(text.slice(s, e + 1)) as T; } catch { return null; }
}

// Try again once or twice when Anthropic is busy; never after the member has seen words
export async function retry<T>(fn: () => Promise<T>, opts: { tries?: number; delays?: number[]; canRetry?: () => boolean } = {}): Promise<T> {
  const delays = opts.delays ?? [700, 1800];
  const tries = opts.tries ?? 3;
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const ok = e instanceof ApiError && e.retryable && i < tries - 1 && (opts.canRetry?.() ?? true);
      if (!ok) throw e;
      await new Promise((r) => setTimeout(r, delays[Math.min(i, delays.length - 1)]));
    }
  }
}
