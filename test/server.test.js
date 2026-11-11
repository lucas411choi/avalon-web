'use strict';

// 실제 서버를 띄우고 여러 소켓 클라이언트로 게임 전체를 플레이하는 통합 테스트
const test = require('node:test');
const assert = require('node:assert/strict');
const { io: ioc } = require('socket.io-client');
const { createServer } = require('../server');

let srv;
let url;

test.before(async () => {
  srv = createServer();
  await new Promise((r) => srv.server.listen(0, r));
  url = `http://localhost:${srv.server.address().port}`;
});

test.after(async () => {
  srv.io.close();
  await new Promise((r) => srv.server.close(r));
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred, what = '조건', timeout = 4000) {
  const start = Date.now();
  for (;;) {
    try { if (pred()) return; } catch { /* 아직 준비 안 됨 */ }
    if (Date.now() - start > timeout) throw new Error(`시간 초과: ${what}`);
    await sleep(10);
  }
}

class Client {
  constructor(name) {
    this.name = name;
    this.state = null;
    this.chat = [];
    this.dms = [];
    this.evil = [];
    this.session = null;
    this.kicked = null;
    this.connect();
  }

  connect() {
    this.s = ioc(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    this.s.on('state', (st) => { this.state = st; });
    this.s.on('session', (x) => { this.session = x; });
    this.s.on('chatInit', ({ chat }) => { this.chat = chat.slice(); });
    this.s.on('chat', (m) => { if (!this.chat.some((x) => x.id === m.id)) this.chat.push(m); });
    this.s.on('dm', (d) => this.dms.push(d));
    this.s.on('evilChat', (m) => this.evil.push(m));
    this.s.on('kicked', (k) => { this.kicked = k; });
  }

  emit(event, payload = {}) {
    return new Promise((resolve) => this.s.emit(event, payload, resolve));
  }

  get id() { return this.state && this.state.me && this.state.me.id; }
  get g() { return this.state && this.state.game; }
  close() { this.s.close(); }
}

function publicPart(st) {
  if (!st || !st.game) return JSON.stringify(st && st.room);
  const { me, ...pub } = st.game;
  return JSON.stringify({ room: st.room, pub });
}

async function synced(clients) {
  await waitFor(() => {
    const first = publicPart(clients[0].state);
    return clients.every((c) => publicPart(c.state) === first);
  }, '모든 클라이언트 상태 동기화');
}

async function makeRoom(n) {
  const host = new Client('방장');
  const r = await host.emit('create', { name: '방장' });
  assert.equal(r.ok, true, r.error);
  const clients = [host];
  for (let i = 1; i < n; i++) {
    const c = new Client(`P${i}`);
    const jr = await c.emit('join', { code: r.code, name: `P${i}` });
    assert.equal(jr.ok, true, jr.error);
    clients.push(c);
  }
  await waitFor(() => clients.every((c) => c.state && c.state.room.players.length === n), '전원 입장');
  return { code: r.code, host, clients };
}

async function startGame(host, clients, options) {
  let r = await host.emit('setupBegin');
  assert.equal(r.ok, true, r.error);
  if (options) {
    r = await host.emit('setOptions', { options });
    assert.equal(r.ok, true, r.error);
  }
  r = await host.emit('start');
  assert.equal(r.ok, true, r.error);
  await waitFor(() => clients.every((c) => c.g), '게임 시작');
  await synced(clients);
}

const byId = (clients, id) => clients.find((c) => c.id === id);

test('9명: 원정 3번 성공 → 암살 실패 → 선 승리 (소켓으로 전체 진행)', async () => {
  const { host, clients } = await makeRoom(9);
  await startGame(host, clients, { percival: true, morgana: true, mordred: true, oberon: false, lancelot: false });

  // 각자 자기 역할만 받는다
  for (const c of clients) {
    assert.ok(c.g.me.role);
    assert.equal(c.g.allRoles, null);
  }
  const roleOf = Object.fromEntries(clients.map((c) => [c.id, c.g.me.role]));
  const good = clients.filter((c) => c.g.me.team === 'good').map((c) => c.id);
  const evil = clients.filter((c) => c.g.me.team === 'evil').map((c) => c.id);
  assert.equal(good.length, 6);
  assert.equal(evil.length, 3);

  // 멀린 시야: 모드레드를 뺀 악
  const merlin = clients.find((c) => c.g.me.role === 'merlin');
  const expected = evil.filter((id) => roleOf[id] !== 'mordred').sort();
  assert.deepEqual(Object.keys(merlin.g.me.knowledge).sort(), expected);

  // 원정대장이 아닌 사람이 제안하면 거부
  const g0 = clients[0].g;
  const notLeader = clients.find((c) => c.id !== g0.leaderId);
  const bad = await notLeader.emit('propose', { team: g0.order.slice(0, g0.questSizes[0]) });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /원정대장/);

  // 선 플레이어는 실패 카드를 낼 수 없음 (서버가 막음) — 첫 원정에서 확인
  let checkedGoodFail = false;

  while (clients[0].g.phase !== 'assassination') {
    const g = clients[0].g;
    const leader = byId(clients, g.leaderId);
    const size = g.questSizes[g.round];
    const team = good.slice(0, size);
    let r = await leader.emit('propose', { team });
    assert.equal(r.ok, true, r.error);
    await synced(clients);
    assert.equal(clients[0].g.phase, 'vote');
    for (const c of clients) {
      r = await c.emit('vote', { approve: true });
      assert.equal(r.ok, true, r.error);
    }
    await synced(clients);
    assert.equal(clients[0].g.phase, 'quest');
    for (const id of team) {
      const c = byId(clients, id);
      if (!checkedGoodFail) {
        const f = await c.emit('card', { card: 'fail' });
        assert.equal(f.ok, false);
        checkedGoodFail = true;
      }
      r = await c.emit('card', { card: 'success' });
      assert.equal(r.ok, true, r.error);
    }
    await synced(clients);
  }
  assert.equal(clients[0].g.results.length, 3);
  assert.ok(clients[0].g.results.every((x) => x.success));

  // 암살 단계: 악끼리 정체 공개 + 악 팀 채팅
  for (const c of clients) {
    if (c.g.me.team === 'evil') assert.equal(Object.keys(c.g.me.evilReveal).length, 3);
    else assert.equal(c.g.me.evilReveal, null);
  }
  const assassin = clients.find((c) => c.g.me.role === 'assassin');
  const goodClient = byId(clients, good[0]);
  const ec = await goodClient.emit('evilChat', { text: '훔쳐보기' });
  assert.equal(ec.ok, false);
  const r1 = await assassin.emit('evilChat', { text: '멀린 누구 같아?' });
  assert.equal(r1.ok, true, r1.error);
  await waitFor(() => evil.every((id) => byId(clients, id).evil.length === 1), '악 팀 채팅 수신');
  await sleep(50);
  for (const id of good) assert.equal(byId(clients, id).evil.length, 0, '선 플레이어가 악 채팅을 받으면 안 됨');

  // 일반 플레이어는 암살 불가, 악은 지목 불가
  const r2 = await goodClient.emit('assassinate', { targetId: good[1] });
  assert.equal(r2.ok, false);
  const r3 = await assassin.emit('assassinate', { targetId: evil.find((id) => id !== assassin.id) });
  assert.equal(r3.ok, false);

  const wrong = good.find((id) => roleOf[id] !== 'merlin');
  const r4 = await assassin.emit('assassinate', { targetId: wrong });
  assert.equal(r4.ok, true, r4.error);
  await synced(clients);
  for (const c of clients) {
    assert.equal(c.g.phase, 'over');
    assert.equal(c.g.winner, 'good');
    assert.deepEqual(c.g.allRoles, roleOf);
  }
  // 시스템 메시지가 채팅에 기록됨
  assert.ok(clients[0].chat.some((m) => m.system && m.text.includes('선의 승리')));

  // 방장이 대기실로 → 다시 시작 가능
  const notHost = clients.find((c) => c.id !== c.state.room.hostId);
  assert.equal((await notHost.emit('toLobby')).ok, false);
  const hostNow = clients.find((c) => c.id === c.state.room.hostId);
  assert.equal((await hostNow.emit('toLobby')).ok, true);
  await waitFor(() => clients.every((c) => c.state.room.phase === 'lobby' && c.g === null), '대기실 복귀');

  clients.forEach((c) => c.close());
});

test('5명: 5번 연속 부결 → 악 승리', async () => {
  const { host, clients } = await makeRoom(5);
  await startGame(host, clients);
  for (let i = 0; i < 5; i++) {
    const g = clients[0].g;
    assert.equal(g.phase, 'team');
    assert.equal(g.rejectCount, i);
    const leader = byId(clients, g.leaderId);
    assert.equal((await leader.emit('propose', { team: g.order.slice(0, g.questSizes[g.round]) })).ok, true);
    await synced(clients);
    for (const c of clients) assert.equal((await c.emit('vote', { approve: false })).ok, true);
    await synced(clients);
  }
  assert.equal(clients[0].g.phase, 'over');
  assert.equal(clients[0].g.winner, 'evil');
  clients.forEach((c) => c.close());
});

test('5명: 악이 원정 3번 실패시키면 악 승리, 투표 결과는 모두 끝난 뒤 공개', async () => {
  const { host, clients } = await makeRoom(5);
  await startGame(host, clients);
  const evilIds = clients.filter((c) => c.g.me.team === 'evil').map((c) => c.id);
  while (clients[0].g.phase !== 'over') {
    const g = clients[0].g;
    const size = g.questSizes[g.round];
    const team = [evilIds[0], ...g.order.filter((id) => id !== evilIds[0])].slice(0, size);
    await byId(clients, g.leaderId).emit('propose', { team });
    await synced(clients);
    // 일부만 투표했을 때는 투표 내용이 공개되지 않음
    await clients[0].emit('vote', { approve: true });
    await synced(clients);
    for (const c of clients) {
      assert.equal(c.g.votedIds.length, 1);
      if (c !== clients[0]) assert.equal(c.g.me.myVote, null);
    }
    for (const c of clients.slice(1)) await c.emit('vote', { approve: true });
    await synced(clients);
    for (const id of team) {
      await byId(clients, id).emit('card', { card: evilIds.includes(id) ? 'fail' : 'success' });
    }
    await synced(clients);
  }
  assert.equal(clients[0].g.winner, 'evil');
  assert.equal(clients[0].g.results.filter((r) => !r.success).length, 3);
  clients.forEach((c) => c.close());
});

test('단체 채팅은 같은 방에만, 1:1 채팅은 두 사람에게만', async () => {
  const a = await makeRoom(3);
  const b = await makeRoom(2);
  const [x, y, z] = a.clients;
  assert.equal((await x.emit('chat', { text: '안녕하세요' })).ok, true);
  await waitFor(() => a.clients.every((c) => c.chat.some((m) => m.text === '안녕하세요')), '단체 채팅 수신');
  await sleep(50);
  assert.ok(!b.clients.some((c) => c.chat.some((m) => m.text === '안녕하세요')), '다른 방에 채팅이 새면 안 됨');

  assert.equal((await x.emit('dm', { to: y.id, text: '비밀 얘기' })).ok, true);
  await waitFor(() => y.dms.length === 1 && x.dms.length === 1, '1:1 수신');
  await sleep(50);
  assert.equal(z.dms.length, 0, '제3자가 1:1 메시지를 받으면 안 됨');
  assert.equal(y.dms[0].with, x.id);
  assert.equal(x.dms[0].with, y.id);
  // 다른 방 사람에게는 보낼 수 없음
  assert.equal((await x.emit('dm', { to: b.clients[0].id, text: '?' })).ok, false);
  // 방에 들어가지 않은 소켓은 채팅 불가
  const stranger = new Client('외부인');
  await waitFor(() => stranger.s.connected, '연결');
  assert.equal((await stranger.emit('chat', { text: 'hi' })).ok, false);
  [...a.clients, ...b.clients, stranger].forEach((c) => c.close());
});

test('게임 중 연결이 끊겨도 같은 역할로 재접속, 채팅 기록 복원', async () => {
  const { host, clients } = await makeRoom(6);
  await startGame(host, clients);
  await clients[0].emit('chat', { text: '재접속 테스트' });
  const victim = clients[3];
  const { session } = victim;
  const role = victim.g.me.role;
  await waitFor(() => victim.chat.some((m) => m.text === '재접속 테스트'), '채팅 수신');
  victim.close();
  await waitFor(() => clients[0].state.room.players.find((p) => p.id === session.playerId).connected === false, '끊김 표시');

  const back = new Client('재접속');
  const r = await back.emit('rejoin', session);
  assert.equal(r.ok, true, r.error);
  await waitFor(() => back.g && back.g.me.role === role, '같은 역할로 복귀');
  assert.ok(back.chat.some((m) => m.text === '재접속 테스트'), '채팅 기록 복원');
  await waitFor(() => clients[0].state.room.players.find((p) => p.id === session.playerId).connected === true, '접속 표시');

  // 잘못된 토큰은 거부
  const fake = new Client('사칭');
  const bad = await fake.emit('rejoin', { ...session, token: 'nope' });
  assert.equal(bad.ok, false);
  [...clients, back, fake].forEach((c) => c.close());
});

test('강퇴되면 kicked 이벤트를 받고 방에서 빠진다 / 게임 중엔 참가 불가', async () => {
  const { code, host, clients } = await makeRoom(6);
  const target = clients[5];
  assert.equal((await host.emit('kick', { targetId: target.id })).ok, true);
  await waitFor(() => target.kicked, 'kicked 수신');
  await waitFor(() => host.state.room.players.length === 5, '인원 감소');
  // 강퇴된 소켓은 더 이상 채팅 불가
  assert.equal((await target.emit('chat', { text: 'x' })).ok, false);
  await startGame(host, clients.slice(0, 5));
  const late = new Client('늦은사람');
  const r = await late.emit('join', { code, name: '늦은사람' });
  assert.equal(r.ok, false);
  [...clients, late].forEach((c) => c.close());
});

test('랜슬롯 포함 7명 게임이 끝까지 진행된다 (무작위 행동 10판)', async () => {
  for (let round = 0; round < 10; round++) {
    const { host, clients } = await makeRoom(7);
    await startGame(host, clients, { percival: true, morgana: true, mordred: false, oberon: false, lancelot: true });
    let guard = 0;
    while (clients[0].g.phase !== 'over') {
      assert.ok(++guard < 200, '게임이 끝나지 않음');
      const g = clients[0].g;
      if (g.phase === 'team') {
        const team = [...g.order].sort(() => Math.random() - 0.5).slice(0, g.questSizes[g.round]);
        assert.equal((await byId(clients, g.leaderId).emit('propose', { team })).ok, true);
      } else if (g.phase === 'vote') {
        for (const c of clients) await c.emit('vote', { approve: Math.random() < 0.7 });
      } else if (g.phase === 'quest') {
        for (const id of g.proposal) {
          const c = byId(clients, id);
          const card = c.g.me.canFail && Math.random() < 0.5 ? 'fail' : 'success';
          const r = await c.emit('card', { card });
          assert.equal(r.ok, true, r.error);
        }
      } else if (g.phase === 'assassination') {
        const a = clients.find((c) => c.g.me.role === 'assassin');
        const t = clients.find((c) => c !== a && !a.g.me.evilReveal[c.id]);
        assert.equal((await a.emit('assassinate', { targetId: t.id })).ok, true);
      }
      await synced(clients);
    }
    const g = clients[0].g;
    assert.ok(g.winner);
    // 원정마다 시작 전에 랜슬롯 전환 판정이 1번씩 기록됨
    assert.ok(g.lancelotHistory.length >= g.results.length && g.lancelotHistory.length <= 5);
    assert.ok(g.lancelotHistory.every((h) => typeof h === 'boolean'));
    clients.forEach((c) => c.close());
  }
});
