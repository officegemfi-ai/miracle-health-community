// A small stand-in for Supabase Realtime's "Postgres Changes", for local tests only.
// It speaks the Phoenix channel protocol supabase-js uses (text frames, message
// format 1.0.0 or 2.0.0), captures changes with a trigger on each table in the
// supabase_realtime publication, and checks every change against the subscriber's
// access rules (Row Level Security and column grants) before sending it, the way
// Supabase Realtime does. Not production code.
import { createHash } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
let nextId = 41000;
const ident = (s) => `"${String(s).replace(/"/g, '""')}"`;

const SETUP = `
create schema if not exists local_realtime;
revoke all on schema local_realtime from public;
create table if not exists local_realtime.changes (
  id bigserial primary key,
  schema_name text not null,
  table_name text not null,
  type text not null,
  record jsonb,
  old_record jsonb,
  at timestamptz not null default clock_timestamp()
);
create or replace function local_realtime.capture() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into local_realtime.changes (schema_name, table_name, type, record, old_record)
  values (tg_table_schema, tg_table_name, tg_op,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          case when tg_op <> 'INSERT' then to_jsonb(old) end);
  return null;
end $$;
revoke all on function local_realtime.capture() from public;
`;

// "column=op.value", as Realtime accepts them
function matches(filter, record) {
  if (!filter) return true;
  const m = /^([^=]+)=(eq|neq|lt|lte|gt|gte|in)\.(.*)$/s.exec(filter);
  if (!m || !record) return false;
  const [, col, op, raw] = m;
  const v = record[col];
  const s = v == null ? null : String(v);
  if (op === 'in') return raw.replace(/^\(|\)$/g, '').split(',').map((x) => x.trim().replace(/^"|"$/g, '')).includes(s);
  if (s == null) return false;
  const num = Number(raw); const both = !Number.isNaN(num) && typeof v === 'number';
  const a = both ? v : s; const b = both ? num : raw;
  return { eq: a === b, neq: a !== b, lt: a < b, lte: a <= b, gt: a > b, gte: a >= b }[op];
}

export async function attachRealtime(server, { pool, verify, asCaller, log = () => {} }) {
  const pub = await pool.query(`select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime'`).catch(() => ({ rows: [] }));
  if (!pub.rows.length) { log('realtime: no supabase_realtime publication, live updates are off'); return; }
  await pool.query(SETUP);
  for (const { schemaname, tablename } of pub.rows) {
    await pool.query(`create or replace trigger zz_local_realtime after insert or update or delete on ${ident(schemaname)}.${ident(tablename)}
                      for each row execute function local_realtime.capture()`);
  }
  let last = Number((await pool.query('select coalesce(max(id), 0) as m from local_realtime.changes')).rows[0].m);
  log(`realtime: watching ${pub.rows.map((r) => r.tablename).join(', ')}`);

  const keys = new Map();   // table -> primary key columns
  const cols = new Map();   // table|role -> columns that role may read
  async function pkOf(t) {
    if (!keys.has(t)) {
      const r = await pool.query(`select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
                                   where i.indrelid = $1::regclass and i.indisprimary`, [t]);
      keys.set(t, r.rows.map((x) => x.attname));
    }
    return keys.get(t);
  }
  async function readable(t, role) {
    const k = `${t}|${role}`;
    if (!cols.has(k)) {
      const r = await pool.query(`select attname from pg_attribute where attrelid = $1::regclass and attnum > 0 and not attisdropped
                                     and has_column_privilege($2, attrelid, attnum, 'SELECT')`, [t, role]);
      cols.set(k, new Set(r.rows.map((x) => x.attname)));
    }
    return cols.get(k);
  }
  // Would this subscriber see the row? Asked as them, so their access rules decide.
  async function visible(claims, t, record) {
    const pk = await pkOf(t);
    if (!pk.length) return false;
    try {
      return await asCaller(claims, async (c) => (await c.query(
        `select 1 from ${t} x, jsonb_populate_record(null::${t}, $1::jsonb) r where ${pk.map((p) => `x.${ident(p)} = r.${ident(p)}`).join(' and ')} limit 1`,
        [JSON.stringify(record)])).rowCount > 0);
    } catch { return false; }
  }

  const conns = new Set();
  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://local');
    if (url.pathname !== '/realtime/v1/websocket' || !req.headers['sec-websocket-key']) { socket.destroy(); return; }
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + GUID).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.setNoDelay(true);
    const v2 = (url.searchParams.get('vsn') || '1.0.0') === '2.0.0';
    const conn = { socket, v2, apikey: url.searchParams.get('apikey'), channels: new Map() };
    conns.add(conn);
    const close = () => { conns.delete(conn); socket.destroy(); };
    socket.on('error', close);
    socket.on('close', () => conns.delete(conn));

    const sendText = (text) => {
      const data = Buffer.from(text);
      let head;
      if (data.length < 126) head = Buffer.from([0x81, data.length]);
      else if (data.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(data.length, 2); }
      else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(data.length), 2); }
      if (!socket.destroyed) socket.write(Buffer.concat([head, data]));
    };
    conn.push = (m) => sendText(v2 ? JSON.stringify([m.join_ref ?? null, m.ref ?? null, m.topic, m.event, m.payload]) : JSON.stringify(m));
    const reply = (m, status, response = {}) => conn.push({ join_ref: m.join_ref, ref: m.ref, topic: m.topic, event: 'phx_reply', payload: { status, response } });

    const onMessage = (text) => {
      let m;
      try {
        const x = JSON.parse(text);
        m = Array.isArray(x) ? { join_ref: x[0], ref: x[1], topic: x[2], event: x[3], payload: x[4] || {} } : { ...x, payload: x.payload || {} };
      } catch { return; }
      if (m.topic === 'phoenix' && m.event === 'heartbeat') return reply(m, 'ok');
      if (m.event === 'phx_join') {
        const claims = verify(m.payload.access_token || conn.apikey);
        if (!claims) return reply(m, 'error', { reason: 'Invalid token' });
        const bindings = (m.payload.config?.postgres_changes || []).map((f) => ({ ...f, id: (nextId += 1) }));
        conn.channels.set(m.topic, { join_ref: m.join_ref, claims, bindings });
        return reply(m, 'ok', { postgres_changes: bindings });
      }
      if (m.event === 'access_token') {
        const ch = conn.channels.get(m.topic);
        const claims = verify(m.payload.access_token);
        if (ch && claims) ch.claims = claims;
        return reply(m, 'ok');
      }
      if (m.event === 'phx_leave') { conn.channels.delete(m.topic); return reply(m, 'ok'); }
      return reply(m, 'ok');
    };

    // Frames from the browser: masked, maybe fragmented
    let buf = Buffer.alloc(0);
    let parts = [];
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (buf.length < 2) return;
        const fin = (buf[0] & 0x80) !== 0; const op = buf[0] & 0x0f;
        const masked = (buf[1] & 0x80) !== 0; let len = buf[1] & 0x7f; let off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        const maskAt = off; if (masked) off += 4;
        if (buf.length < off + len) return;
        const payload = Buffer.from(buf.subarray(off, off + len));
        if (masked) for (let i = 0; i < payload.length; i += 1) payload[i] ^= buf[maskAt + (i % 4)];
        buf = buf.subarray(off + len);
        if (op === 0x8) { socket.end(Buffer.from([0x88, 0])); conns.delete(conn); return; }
        if (op === 0x9) { socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); continue; }
        if (op === 0x1 || op === 0x0) {
          parts.push(payload);
          if (fin) { const text = Buffer.concat(parts).toString('utf8'); parts = []; onMessage(text); }
        }
      }
    });
  });

  // Hand each new change to the subscribers allowed to see it
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const r = await pool.query('select * from local_realtime.changes where id > $1 order by id limit 500', [last]);
      for (const ch of r.rows) {
        last = Number(ch.id);
        if (!conns.size) continue;
        const t = `${ident(ch.schema_name)}.${ident(ch.table_name)}`;
        const row = ch.type === 'DELETE' ? ch.old_record : ch.record;
        for (const conn of conns) {
          for (const [topic, sub] of conn.channels) {
            const ids = sub.bindings.filter((b) => (b.schema === '*' || b.schema === ch.schema_name)
              && (!b.table || b.table === '*' || b.table === ch.table_name)
              && (b.event === '*' || b.event === ch.type)
              && matches(b.filter, row)).map((b) => b.id);
            if (!ids.length) continue;
            const role = sub.claims.role || 'anon';
            let record = {}; let old = {};
            if (ch.type === 'DELETE') {
              const pk = await pkOf(t);
              old = Object.fromEntries(pk.map((k) => [k, ch.old_record[k]]));
            } else {
              if (!(await visible(sub.claims, t, ch.record))) continue;
              const can = await readable(t, role);
              record = Object.fromEntries(Object.entries(ch.record).filter(([k]) => can.has(k)));
              if (ch.type === 'UPDATE') {
                const pk = await pkOf(t);
                old = Object.fromEntries(pk.map((k) => [k, ch.old_record[k]]));
              }
            }
            conn.push({
              join_ref: sub.join_ref, ref: null, topic, event: 'postgres_changes',
              payload: {
                ids,
                data: {
                  schema: ch.schema_name, table: ch.table_name, commit_timestamp: new Date(ch.at).toISOString(),
                  type: ch.type, record, old_record: old, columns: [], errors: null,
                },
              },
            });
          }
        }
      }
      if (last % 500 === 0) await pool.query('delete from local_realtime.changes where id < $1', [last - 1000]);
    } catch (e) {
      log(`realtime: ${e.message}`);
    } finally {
      busy = false;
    }
  }, 300).unref();
}
