'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io: ioc } = require('socket.io-client');
const { Game, validateOptions, failsRequired } = require('../src/game');
const ai = require('../src/ai');
const { RoomManager } = require('../src/rooms');
const { createServer } = require('../server');

const OPTION_KEYS = ['percival', 'morgana', 'mordred', 'oberon', 'lancelot'];
function randomOptions(n) {
  for (;;) {
    const o = {};
    for (const k of OPTION_KEYS) o[k] = Math.random() < 0.5;
    if (!validateOptions(n, o)) return o;
  }
}
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));

test('AI만으로 3000판: 모든 행동이 규칙에 맞고 게임이 끝난다', () => {
  const wins = { good: 0, evil: 0 };
  for (let i = 0; i < 3000; i++) {
    const n = 5 + (i % 6);
    const g = new Game(players(n), randomOptions(n));
    let steps = 0;
    while (g.phase !== 'over') {
      assert.ok(++steps < 2000, '게임이 끝나지 않음');
      let acted = false;
      for (const id of g.order) {
        const act = ai.decide(g, id);
        if (!act) continue;
        // 선 AI 는 절대 실패를 내지 않음
        if (act.action === 'card' && g.teamOf(id) === 'good') assert.equal(act.payload.card, 'success');
        if (act.action === 'card' && g.teamOf(id) === 'evil' && failsRequired(n, g.round) > 1) assert.equal(act.payload.card, 'fail');
        if (act.action === 'propose') assert.equal(new Set(act.payload.team).size, g.questSize);
        switch (act.action) {
          case 'propose': g.propose(id, act.payload.team); break;
          case 'vote': g.vote(id, act.payload.approve); break;
          case 'card': g.playCard(id, act.payload.card); break;
          case 'assassinate': g.assassinate(id, act.payload.targetId); break;
          default: assert.fail(act.action);
        }
        acted = true;
        break;
      }
      assert.ok(acted, `아무도 행동하지 않음 (phase=${g.phase})`);
    }
    wins[g.winner]++;
  }
  // 한쪽이 일방적으로 이기지 않는지 (대략적인 균형 확인)
  assert.ok(wins.good > 300 && wins.evil > 300, JSON.stringify(wins));
});

test('선 AI(멀린)는 아는 악이 들어간 원정대에 대체로 반대한다', () => {
  let rejects = 0;
  for (let i = 0; i < 200; i++) {
    const g = new Game(players(7), { percival: true, morgana: true });
    const merlin = g.playerWithRole('merlin');
    const evil = g.order.find((id) => g.knowledgeFor(merlin)[id] === 'evil');
    g.leaderIndex = g.order.indexOf(g.order.find((id) => id !== merlin));
    g.propose(g.leaderId, [evil, g.order.find((id) => id !== evil && id !== merlin)].slice(0, g.questSize));
    if (!ai.chooseVote(g, merlin, Math.random)) rejects++;
  }
  assert.ok(rejects > 150, `rejects=${rejects}`);
});

test('악 AI 둘이 같은 원정대면 한 명만 실패를 낸다 (실패 1장 필요할 때)', () => {
  const g = new Game(players(7), { percival: false, morgana: true });
  const roles = ['merlin', 'servant', 'servant', 'servant', 'assassin', 'morgana', 'minion'];
  g.order.forEach((id, i) => { g.roles[id] = roles[i]; });
  g.round = 1;
  g.results = [{ round: 0, success: true, fails: 0, team: ['p0', 'p1'] }];
  g.phase = 'quest';
  g.proposal = ['p0', 'p4', 'p5'];
  const cards = [ai.chooseCard(g, 'p4', () => 0), ai.chooseCard(g, 'p5', () => 0)];
  assert.deepEqual(cards.sort(), ['fail', 'success']);
});

test('RoomManager: AI 인원 설정 (방장만, 대기실만, 최대 10명)', () => {
  const m = new RoomManager();
  const { room, player: host } = m.createRoom('나');
  const other = m.joinRoom(room.code, '친구').player;
  assert.throws(() => m.setAICount(room, other.id, 3), /방장/);
  m.setAICount(room, host.id, 4);
  assert.equal(room.players.filter((p) => p.ai).length, 4);
  assert.ok(room.players.filter((p) => p.ai).every((p) => p.name.startsWith('AI ') && p.token === null));
  assert.throws(() => m.setAICount(room, host.id, 9), /최대/);
  m.setAICount(room, host.id, 8);
  assert.equal(room.players.length, 10);
  assert.throws(() => m.joinRoom(room.code, '늦은사람'), /가득/);
  m.setAICount(room, host.id, 2);
  assert.equal(room.players.length, 4);
  // AI 이름 중복 없음
  const names = room.players.map((p) => p.name);
  assert.equal(new Set(names).size, names.length);
  // AI 는 재접속 토큰이 없어 사칭 불가
  const aiP = room.players.find((p) => p.ai);
  assert.throws(() => m.rejoin(room.code, aiP.id, null), Error);
  // 게임 중엔 변경 불가
  m.setAICount(room, host.id, 3);
  m.beginSetup(room, host.id);
  assert.throws(() => m.setAICount(room, host.id, 4), /대기실/);
});

test('RoomManager: 방장은 항상 사람, 사람이 모두 나가면 방 삭제', () => {
  const m = new RoomManager();
  const { room, player: host } = m.createRoom('나');
  const friend = m.joinRoom(room.code, '친구').player;
  m.setAICount(room, host.id, 4);
  m.setConnected(room, host.id, false);
  assert.equal(room.hostId, friend.id);
  m.leave(room, friend.id);
  assert.equal(room.hostId, host.id); // AI 가 아니라 남은 사람에게
  m.leave(room, host.id);
  assert.equal(m.getRoom(room.code), null);
});

// ── 통합: 사람 1명 + AI ──────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, what, timeout = 8000) {
  const start = Date.now();
  for (;;) {
    try { if (pred()) return; } catch { /* noop */ }
    if (Date.now() - start > timeout) throw new Error(`시간 초과: ${what}`);
    await sleep(10);
  }
}
function client(url) {
  const c = { state: null, dms: [], evil: [], chat: [] };
  c.s = ioc(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  c.s.on('state', (st) => { c.state = st; });
  c.s.on('dm', (d) => c.dms.push(d));
  c.s.on('evilChat', (m) => c.evil.push(m));
  c.s.on('chat', (m) => c.chat.push(m));
  c.emit = (ev, p = {}) => new Promise((r) => c.s.emit(ev, p, r));
  return c;
}

async function withServer(opts, fn) {
  const srv = createServer(opts);
  await new Promise((r) => srv.server.listen(0, r));
  const url = `http://localhost:${srv.server.address().port}`;
  try { await fn(url, srv); } finally {
    srv.io.close();
    await new Promise((r) => srv.server.close(r));
  }
}

test('혼자 + AI: 방장이 AI 인원을 정하고 끝까지 플레이 (여러 판, 여러 인원)', async () => {
  await withServer({ aiDelay: () => 2, aiAssassinWait: 30, aiChatChance: 1 }, async (url) => {
    for (const aiCount of [4, 5, 6, 7, 8, 9, 4, 6, 9, 5, 7, 8]) {
      const me = client(url);
      const r = await me.emit('create', { name: '나' });
      assert.equal(r.ok, true, r.error);
      assert.equal((await me.emit('setAI', { count: aiCount })).ok, true);
      await waitFor(() => me.state.room.players.length === aiCount + 1, 'AI 입장');
      assert.equal(me.state.room.hostId, me.state.me.id);
      assert.equal((await me.emit('setupBegin')).ok, true);
      assert.equal((await me.emit('setOptions', { options: { lancelot: aiCount + 1 >= 7 && Math.random() < 0.5 } })).ok, true);
      assert.equal((await me.emit('start')).ok, true, '시작');
      await waitFor(() => me.state.game, '게임 시작');
      let guard = 0;
      while (me.state.game.phase !== 'over') {
        assert.ok(++guard < 3000, '게임이 끝나지 않음');
        const g = me.state.game;
        const myId = me.state.me.id;
        if (g.phase === 'team' && g.leaderId === myId) {
          await me.emit('propose', { team: g.order.slice(0, g.questSizes[g.round]) });
        } else if (g.phase === 'vote' && g.me.myVote === null) {
          await me.emit('vote', { approve: Math.random() < 0.7 });
        } else if (g.phase === 'quest' && g.proposal.includes(myId) && g.me.myCard === null) {
          await me.emit('card', { card: g.me.canFail ? 'fail' : 'success' });
        } else if (g.phase === 'assassination' && g.me.role === 'assassin') {
          const t = g.order.find((id) => id !== myId && !g.me.evilReveal[id]);
          await me.emit('assassinate', { targetId: t });
        }
        await sleep(5);
      }
      assert.ok(['good', 'evil'].includes(me.state.game.winner));
      // AI 에게 1:1 채팅하면 답장이 온다
      const aiId = me.state.room.players.find((p) => p.ai).id;
      assert.equal((await me.emit('dm', { to: aiId, text: '누가 수상해?' })).ok, true);
      await waitFor(() => me.dms.some((d) => d.with === aiId && d.msg.from === aiId), 'AI 답장', 5000);
      // 대기실로 돌아가도 AI 는 남아 있고 방장은 그대로
      assert.equal((await me.emit('toLobby')).ok, true);
      await waitFor(() => me.state.room.phase === 'lobby', '대기실');
      assert.equal(me.state.room.players.filter((p) => p.ai).length, aiCount);
      me.s.close();
    }
  });
});

test('AI 암살자는 사람 악 동료가 악 팀 채팅에 적은 이름을 따른다', async () => {
  await withServer({ aiDelay: () => 60000, aiAssassinWait: 60000, aiChatChance: 0 }, async (url, srv) => {
    const me = client(url);
    await me.emit('create', { name: '나' });
    await me.emit('setAI', { count: 6 });
    await me.emit('setupBegin');
    await me.emit('setOptions', { options: { percival: true, morgana: true, mordred: false, oberon: false, lancelot: false } });
    await me.emit('start');
    await waitFor(() => me.state.game, '게임 시작');
    // 역할 고정: 나 = 모르가나, AI 하나 = 암살자, 원정 3번 성공 → 암살 단계
    const room = srv.manager.getRoom(me.state.room.code);
    const g = room.game;
    const myId = me.state.me.id;
    const others = g.order.filter((id) => id !== myId);
    g.roles[myId] = 'morgana';
    g.roles[others[0]] = 'assassin';
    g.roles[others[1]] = 'minion';
    g.roles[others[2]] = 'merlin';
    g.roles[others[3]] = 'percival';
    g.roles[others[4]] = 'servant';
    g.roles[others[5]] = 'servant';
    g.results = [0, 1, 2].map((round) => ({ round, team: [], fails: 0, successes: 2, required: 1, success: true, leaderId: myId }));
    g.phase = 'assassination';
    srv.io.to(`p:${myId}`).emit('state', srv.manager.stateFor(room, myId));
    await waitFor(() => me.state.game.phase === 'assassination' && me.state.game.me.evilReveal, '암살 단계');
    const servantName = room.players.find((p) => p.id === others[4]).name;
    assert.equal((await me.emit('evilChat', { text: `${servantName}님이 멀린 같아요` })).ok, true);
    await waitFor(() => me.state.game.phase === 'over', '암살 실행', 8000);
    assert.equal(me.state.game.assassinTarget, others[4]);
    assert.equal(me.state.game.winner, 'good');
    assert.ok(me.evil.some((m) => m.from === others[0] && m.text.includes(servantName)), 'AI 암살자의 확인 메시지');
    me.s.close();
  });
});
