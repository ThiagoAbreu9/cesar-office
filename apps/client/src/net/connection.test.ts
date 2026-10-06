import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeControl, PROTOCOL_VERSION, type ServerMsg } from '@cesar-office/protocol';
import { Connection, type ConnectionState, type SocketLike, type Timers } from './connection.ts';
import { ServerClock } from './server-clock.ts';

class FakeSocket implements SocketLike {
  binaryType: BinaryType = 'blob';
  readyState = 0;
  bufferedAmount = 0;
  sent: Uint8Array[] = [];
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  send(d: Uint8Array): void { this.sent.push(d); }
  close(): void { this.readyState = 3; }
  open(): void { this.readyState = 1; this.onopen?.({} as Event); }
  deliver(m: ServerMsg): void {
    const b = encodeControl(m);
    this.onmessage?.({ data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) } as MessageEvent);
  }
  drop(): void { this.readyState = 3; this.onclose?.({} as CloseEvent); }
  lastControl(): Record<string, unknown> {
    const b = this.sent[this.sent.length - 1];
    assert.ok(b);
    return JSON.parse(new TextDecoder().decode(b.subarray(1))) as Record<string, unknown>;
  }
}

function setup() {
  let now = 0;
  const sockets: FakeSocket[] = [];
  const pending: { fn: () => void; at: number }[] = [];
  const timers: Timers = {
    setTimeout: (fn, ms) => pending.push({ fn, at: now + ms }),
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
  };
  const states: ConnectionState[] = [];
  const rejoins: string[] = [];
  const conn = new Connection(
    { createSocket: () => { const s = new FakeSocket(); sockets.push(s); return s; }, clock: new ServerClock(() => now), now: () => now, timers, random: () => 0.5 },
    {
      onState: (s) => states.push(s),
      onWelcome: () => {}, onResumed: () => {}, onSnapshot: () => {}, onControl: () => {},
      onRejoinRequired: (r) => rejoins.push(r),
    },
  );
  const runTimers = (): void => {
    const due = pending.splice(0);
    for (const t of due) { now = Math.max(now, t.at); t.fn(); }
  };
  return { conn, sockets, states, rejoins, runTimers, advance: (ms: number) => { now += ms; } };
}

const welcome: ServerMsg = {
  t: 'welcome', netId: 1, userId: 'u', instanceId: 'i', resumeToken: 'r'.repeat(32), serverTime: 0, tick: 0,
  map: { mapId: 'm', version: 1, url: 'x' }, self: { x: 0, y: 0 }, entities: [],
};

test('hello → welcome → online', () => {
  const { conn, sockets, states } = setup();
  conn.connect('wss://rt', 't'.repeat(32));
  sockets[0]!.open();
  assert.deepEqual(sockets[0]!.lastControl(), { t: 'hello', v: PROTOCOL_VERSION, ticket: 't'.repeat(32) });
  sockets[0]!.deliver(welcome);
  assert.equal(conn.currentState, 'online');
  assert.deepEqual(states, ['connecting', 'handshaking', 'online']);
});

test('queda → resume com token → resumed', () => {
  const { conn, sockets, runTimers } = setup();
  conn.connect('wss://rt', 't'.repeat(32));
  sockets[0]!.open();
  sockets[0]!.deliver(welcome);
  sockets[0]!.drop();
  assert.equal(conn.currentState, 'resuming');
  runTimers();
  sockets[1]!.open();
  assert.equal(sockets[1]!.lastControl()['t'], 'resume');
  assert.equal(sockets[1]!.lastControl()['resumeToken'], 'r'.repeat(32));
  sockets[1]!.deliver({ t: 'resumed', tick: 5, entities: [], resumeToken: 'n'.repeat(32) });
  assert.equal(conn.currentState, 'online');
});

test('resume_rejected → rejoin', () => {
  const { conn, sockets, runTimers, rejoins } = setup();
  conn.connect('wss://rt', 't'.repeat(32));
  sockets[0]!.open();
  sockets[0]!.deliver(welcome);
  sockets[0]!.drop();
  runTimers();
  sockets[1]!.open();
  sockets[1]!.deliver({ t: 'resume_rejected', reason: 'expired' });
  assert.equal(conn.currentState, 'rejoining');
  assert.deepEqual(rejoins, ['expired']);
});

test('janela de 30 s esgotada → rejoin sem nova tentativa', () => {
  const { conn, sockets, runTimers, advance, rejoins } = setup();
  conn.connect('wss://rt', 't'.repeat(32));
  sockets[0]!.open();
  sockets[0]!.deliver(welcome);
  sockets[0]!.drop();
  runTimers();
  advance(31_000);
  sockets[1]!.drop();
  assert.equal(conn.currentState, 'rejoining');
  assert.deepEqual(rejoins, ['expired']);
});

test('queda antes do welcome exige novo ticket (ticket é de uso único)', () => {
  const { conn, sockets, rejoins } = setup();
  conn.connect('wss://rt', 't'.repeat(32));
  sockets[0]!.open();
  sockets[0]!.drop();
  assert.deepEqual(rejoins, ['handshake_failed']);
});
