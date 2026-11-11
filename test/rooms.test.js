'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RoomManager } = require('../src/rooms');
const { GameError } = require('../src/game');

function roomWith(n) {
  const m = new RoomManager();
  const { room, player: host } = m.createRoom('방장');
  const ps = [host];
  for (let i = 1; i < n; i++) ps.push(m.joinRoom(room.code, `P${i}`).player);
  return { m, room, ps };
}

test('방 만들기 / 참가: 4자리 코드, 소문자 코드도 OK', () => {
  const m = new RoomManager();
  const { room } = m.createRoom('철수');
  assert.match(room.code, /^[A-Z]{4}$/);
  const { player } = m.joinRoom(room.code.toLowerCase(), '영희');
  assert.equal(room.players.length, 2);
  assert.equal(player.name, '영희');
});

test('참가 오류: 없는 방, 빈 이름, 중복 이름, 긴 이름, 10명 초과', () => {
  const { m, room } = roomWith(10);
  assert.throws(() => m.joinRoom('ZZZZ', 'a'), GameError);
  assert.throws(() => m.joinRoom(room.code, 'x'), /가득/);
  const m2 = new RoomManager();
  const r2 = m2.createRoom('철수').room;
  assert.throws(() => m2.joinRoom(r2.code, '   '), GameError);
  assert.throws(() => m2.joinRoom(r2.code, '철수'), /같은 이름/);
  assert.throws(() => m2.joinRoom(r2.code, '가'.repeat(13)), GameError);
});

test('게임 시작은 방장만, 5명부터', () => {
  const { m, room, ps } = roomWith(4);
  assert.throws(() => m.beginSetup(room, ps[0].id), /5명/);
  ps.push(m.joinRoom(room.code, 'P4').player);
  assert.throws(() => m.beginSetup(room, ps[1].id), /방장/);
  m.beginSetup(room, ps[0].id);
  assert.equal(room.phase, 'setup');
  // 준비 중에는 새로 참가 불가
  assert.throws(() => m.joinRoom(room.code, '늦은사람'), GameError);
  assert.throws(() => m.startGame(room, ps[1].id), /방장/);
  m.startGame(room, ps[0].id);
  assert.equal(room.phase, 'game');
  assert.ok(room.game);
  assert.equal(room.game.n, 5);
});

test('캐릭터 선정: 인원에 안 맞는 옵션이면 시작 불가', () => {
  const { m, room, ps } = roomWith(5);
  m.beginSetup(room, ps[0].id);
  m.setOptions(room, ps[0].id, { morgana: true, mordred: true });
  assert.throws(() => m.startGame(room, ps[0].id), /악 역할이 너무 많/);
  const st = m.stateFor(room, ps[0].id);
  assert.ok(st.room.optionsError);
  assert.equal(st.room.composition, null);
  m.setOptions(room, ps[0].id, { mordred: false });
  m.startGame(room, ps[0].id);
  assert.equal(room.phase, 'game');
});

test('setup 중 누가 나가면 대기실로 돌아감 / 방장 위임', () => {
  const { m, room, ps } = roomWith(5);
  m.beginSetup(room, ps[0].id);
  m.leave(room, ps[0].id);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.players.length, 4);
  assert.equal(room.hostId, ps[1].id);
});

test('모두 나가면 방이 사라진다', () => {
  const { m, room, ps } = roomWith(2);
  m.leave(room, ps[0].id);
  m.leave(room, ps[1].id);
  assert.equal(m.getRoom(room.code), null);
});

test('강퇴는 방장만, 대기실에서만', () => {
  const { m, room, ps } = roomWith(6);
  assert.throws(() => m.kick(room, ps[1].id, ps[2].id), /방장/);
  m.kick(room, ps[0].id, ps[2].id);
  assert.equal(room.players.length, 5);
  m.beginSetup(room, ps[0].id);
  m.startGame(room, ps[0].id);
  assert.throws(() => m.kick(room, ps[0].id, ps[1].id), GameError);
});

test('재접속: 올바른 토큰만 허용, 게임 중 나가도 자리 유지', () => {
  const { m, room, ps } = roomWith(5);
  m.beginSetup(room, ps[0].id);
  m.startGame(room, ps[0].id);
  m.leave(room, ps[3].id);
  assert.equal(room.players.length, 5);
  assert.equal(room.players[3].connected, false);
  assert.throws(() => m.rejoin(room.code, ps[3].id, 'wrong'), GameError);
  const { player } = m.rejoin(room.code, ps[3].id, ps[3].token);
  assert.equal(player.id, ps[3].id);
});

test('방장 연결이 끊기면 다른 사람에게 방장 위임', () => {
  const { m, room, ps } = roomWith(5);
  m.setConnected(room, ps[0].id, false);
  assert.equal(room.hostId, ps[1].id);
  m.setConnected(room, ps[0].id, true);
  assert.equal(room.hostId, ps[1].id);
});

test('연결 끊긴 사람이 있으면 시작 불가', () => {
  const { m, room, ps } = roomWith(5);
  m.beginSetup(room, ps[0].id);
  m.setConnected(room, ps[4].id, false);
  assert.throws(() => m.startGame(room, ps[0].id), /연결이 끊긴/);
});

test('채팅: 빈 메시지 거부, 300자 제한, 1:1 채팅은 두 사람만 조회', () => {
  const { m, room, ps } = roomWith(3);
  assert.throws(() => m.chat(room, ps[0].id, '   '), GameError);
  const long = m.chat(room, ps[0].id, 'a'.repeat(500));
  assert.equal(long.text.length, 300);
  m.dm(room, ps[0].id, ps[1].id, '안녕');
  m.dm(room, ps[1].id, ps[0].id, '반가워');
  assert.equal(m.dmsFor(room, ps[0].id)[ps[1].id].length, 2);
  assert.equal(m.dmsFor(room, ps[1].id)[ps[0].id].length, 2);
  assert.deepEqual(m.dmsFor(room, ps[2].id), {});
  assert.throws(() => m.dm(room, ps[0].id, ps[0].id, 'x'), GameError);
  assert.throws(() => m.dm(room, ps[0].id, 'nobody', 'x'), GameError);
});

test('악 팀 채팅은 암살 단계의 악 플레이어만', () => {
  const { m, room, ps } = roomWith(5);
  m.beginSetup(room, ps[0].id);
  m.startGame(room, ps[0].id);
  const g = room.game;
  const evil = g.order.filter((id) => g.teamOf(id) === 'evil');
  const good = g.order.filter((id) => g.teamOf(id) === 'good');
  assert.throws(() => m.evilChat(room, evil[0], 'hi'), GameError); // 아직 암살 단계 아님
  // 원정 3번 성공시키기
  while (g.phase !== 'assassination') {
    const team = good.slice(0, g.questSize).concat(evil).slice(0, g.questSize);
    m.act(room, g.leaderId, 'propose', { team });
    for (const id of g.order) m.act(room, id, 'vote', { approve: true });
    for (const id of g.proposal) m.act(room, id, 'card', { card: 'success' });
  }
  m.evilChat(room, evil[0], '멀린은 누구?');
  assert.throws(() => m.evilChat(room, good[0], '나도'), GameError);
  assert.deepEqual(m.evilMembers(room).sort(), evil.sort());
  // 상태: 악은 악 팀 공개, 선은 모름
  assert.ok(m.stateFor(room, evil[0]).game.me.evilReveal);
  assert.equal(m.stateFor(room, good[0]).game.me.evilReveal, null);
});

test('역할 예상(메모)은 본인에게만 보인다', () => {
  const { m, room, ps } = roomWith(5);
  assert.throws(() => m.predict(room, ps[0].id, ps[1].id, 'merlin'), GameError); // 게임 전
  m.beginSetup(room, ps[0].id);
  m.startGame(room, ps[0].id);
  m.predict(room, ps[0].id, ps[1].id, 'mordred');
  m.predict(room, ps[0].id, ps[2].id, 'evil');
  assert.throws(() => m.predict(room, ps[0].id, ps[0].id, 'merlin'), GameError);
  assert.throws(() => m.predict(room, ps[0].id, ps[1].id, 'king'), GameError);
  assert.deepEqual(m.stateFor(room, ps[0].id).predictions, { [ps[1].id]: 'mordred', [ps[2].id]: 'evil' });
  assert.deepEqual(m.stateFor(room, ps[1].id).predictions, {});
  m.predict(room, ps[0].id, ps[1].id, null);
  assert.deepEqual(m.stateFor(room, ps[0].id).predictions, { [ps[2].id]: 'evil' });
});

test('stateFor: 다른 사람의 역할이 섞이지 않는다', () => {
  const { m, room, ps } = roomWith(7);
  m.beginSetup(room, ps[0].id);
  m.startGame(room, ps[0].id);
  const g = room.game;
  for (const p of ps) {
    const st = m.stateFor(room, p.id);
    assert.equal(st.game.me.role, g.roles[p.id]);
    assert.equal(st.game.allRoles, null);
    const json = JSON.stringify(st);
    for (const q of ps) {
      if (q.id === p.id) continue;
      assert.ok(!json.includes(`"${q.id}":"${g.roles[q.id]}"`), '다른 사람의 역할이 노출됨');
    }
  }
});

test('게임 종료 후 대기실로: 방장만, 끊긴 사람 정리', () => {
  const { m, room, ps } = roomWith(5);
  m.beginSetup(room, ps[0].id);
  m.startGame(room, ps[0].id);
  m.setConnected(room, ps[4].id, false);
  assert.throws(() => m.returnToLobby(room, ps[1].id), /방장/);
  m.returnToLobby(room, ps[0].id);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.game, null);
  assert.equal(room.players.length, 4);
});

test('정리(sweep): 대기실에서 오래 끊긴 사람 퇴장, 빈 방 삭제', () => {
  const { m, room, ps } = roomWith(3);
  m.setConnected(room, ps[2].id, false);
  const now = Date.now();
  m.sweep(now + 3 * 60 * 1000);
  assert.equal(room.players.length, 2);
  m.setConnected(room, ps[0].id, false);
  m.setConnected(room, ps[1].id, false);
  room.lastActive = now - 31 * 60 * 1000;
  m.sweep(now);
  assert.equal(m.getRoom(room.code), null);
});
