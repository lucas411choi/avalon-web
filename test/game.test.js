'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  Game, GameError, ROLES, TEAM_SIZES, QUEST_SIZES, validateOptions, buildRoleList, failsRequired, composition,
} = require('../src/game');

const OPTION_KEYS = ['percival', 'morgana', 'mordred', 'oberon', 'lancelot'];
const allOptionCombos = () => {
  const out = [];
  for (let mask = 0; mask < 32; mask++) {
    const o = {};
    OPTION_KEYS.forEach((k, i) => { o[k] = !!(mask & (1 << i)); });
    out.push(o);
  }
  return out;
};

function players(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
}

// 역할을 직접 지정한 게임
function riggedGame(roleList, options = {}, rng = Math.random) {
  const ps = players(roleList.length);
  const g = new Game(ps, options, rng);
  ps.forEach((p, i) => { g.roles[p.id] = roleList[i]; });
  g.leaderIndex = 0;
  return g;
}

function voteAll(g, approveFn) {
  for (const id of g.order) g.vote(id, approveFn(id));
}

function passQuest(g, team = g.order.slice(0, g.questSize)) {
  g.propose(g.leaderId, team);
  voteAll(g, () => true);
  for (const id of team) g.playCard(id, 'success');
}

function failQuest(g, evilId) {
  const team = [evilId, ...g.order.filter((id) => id !== evilId)].slice(0, g.questSize);
  g.propose(g.leaderId, team);
  voteAll(g, () => true);
  const need = failsRequired(g.n, g.round);
  let fails = 0;
  for (const id of team) {
    if (g.teamOf(id) === 'evil' && fails < need) { g.playCard(id, 'fail'); fails++; } else g.playCard(id, 'success');
  }
}

test('인원별 선/악 수와 원정 인원 표가 규칙과 같다', () => {
  assert.deepEqual(TEAM_SIZES[5], { good: 3, evil: 2 });
  assert.deepEqual(TEAM_SIZES[6], { good: 4, evil: 2 });
  assert.deepEqual(TEAM_SIZES[7], { good: 4, evil: 3 });
  assert.deepEqual(TEAM_SIZES[8], { good: 5, evil: 3 });
  assert.deepEqual(TEAM_SIZES[9], { good: 6, evil: 3 });
  assert.deepEqual(TEAM_SIZES[10], { good: 6, evil: 4 });
  assert.deepEqual(QUEST_SIZES[5], [2, 3, 2, 3, 3]);
  assert.deepEqual(QUEST_SIZES[6], [2, 3, 4, 3, 4]);
  assert.deepEqual(QUEST_SIZES[7], [2, 3, 3, 4, 4]);
  for (const n of [8, 9, 10]) assert.deepEqual(QUEST_SIZES[n], [3, 4, 4, 5, 5]);
});

test('7명 이상 네 번째 원정만 실패 2장 필요', () => {
  for (let n = 5; n <= 10; n++) {
    for (let q = 0; q < 5; q++) {
      assert.equal(failsRequired(n, q), n >= 7 && q === 3 ? 2 : 1, `n=${n} q=${q}`);
    }
  }
});

test('모든 인원 × 모든 옵션 조합: 유효하면 역할 수가 정확하다', () => {
  for (let n = 5; n <= 10; n++) {
    for (const o of allOptionCombos()) {
      const err = validateOptions(n, o);
      const goodSp = 1 + o.percival + o.lancelot;
      const evilSp = 1 + o.morgana + o.mordred + o.oberon + o.lancelot;
      const expectValid = goodSp <= TEAM_SIZES[n].good && evilSp <= TEAM_SIZES[n].evil;
      assert.equal(err === null, expectValid, `n=${n} ${JSON.stringify(o)}`);
      if (!expectValid) {
        assert.throws(() => buildRoleList(n, o), GameError);
        continue;
      }
      const roles = buildRoleList(n, o);
      assert.equal(roles.length, n);
      assert.equal(roles.filter((r) => ROLES[r].team === 'good').length, TEAM_SIZES[n].good);
      assert.equal(roles.filter((r) => ROLES[r].team === 'evil').length, TEAM_SIZES[n].evil);
      assert.equal(roles.filter((r) => r === 'merlin').length, 1);
      assert.equal(roles.filter((r) => r === 'assassin').length, 1);
      assert.equal(roles.includes('percival'), o.percival);
      assert.equal(roles.includes('morgana'), o.morgana);
      assert.equal(roles.includes('mordred'), o.mordred);
      assert.equal(roles.includes('oberon'), o.oberon);
      assert.equal(roles.includes('lancelot_good'), o.lancelot);
      assert.equal(roles.includes('lancelot_evil'), o.lancelot);
      const comp = composition(n, o);
      assert.equal(comp.reduce((a, c) => a + c.count, 0), n);
      // 실제 게임 생성도 문제 없어야 함
      const g = new Game(players(n), o);
      assert.equal(Object.keys(g.roles).length, n);
    }
  }
});

test('5명 미만 / 10명 초과는 시작 불가', () => {
  assert.throws(() => new Game(players(4), {}), GameError);
  assert.throws(() => new Game(players(11), {}), GameError);
});

test('9명 구성 예시: 멀린·퍼시벌·랜슬롯 2·신하 3 / 암살자·모르가나', () => {
  const comp = composition(9, { percival: true, morgana: true, mordred: false, oberon: false, lancelot: true });
  const byRole = Object.fromEntries(comp.map((c) => [c.role, c.count]));
  assert.deepEqual(byRole, { merlin: 1, percival: 1, lancelot_good: 1, servant: 3, assassin: 1, morgana: 1, lancelot_evil: 1 });
  // 9명은 악이 3명이므로 악 특수역할 4개(암살자·모르가나·모드레드·악 랜슬롯)는 불가
  assert.notEqual(validateOptions(9, { percival: true, morgana: true, mordred: true, lancelot: true }), null);
});

test('시야: 멀린은 모드레드를 뺀 악(오베론 포함)을 본다', () => {
  // p0 멀린, p1 퍼시벌, p2 신하, p3 신하, p4 신하, p5 신하, p6 암살자, p7 모드레드, p8 오베론, p9 모르가나
  const g = riggedGame(['merlin', 'percival', 'servant', 'servant', 'servant', 'servant', 'assassin', 'mordred', 'oberon', 'morgana'],
    { percival: true, morgana: true, mordred: true, oberon: true });
  const k = g.knowledgeFor('p0');
  assert.deepEqual(Object.keys(k).sort(), ['p6', 'p8', 'p9']);
  assert.ok(Object.values(k).every((v) => v === 'evil'));
});

test('시야: 퍼시벌은 멀린과 모르가나를 구분 없이 본다', () => {
  const g = riggedGame(['merlin', 'percival', 'servant', 'servant', 'servant', 'servant', 'assassin', 'mordred', 'oberon', 'morgana'],
    { percival: true, morgana: true, mordred: true, oberon: true });
  assert.deepEqual(g.knowledgeFor('p1'), { p0: 'merlin?', p9: 'merlin?' });
  assert.deepEqual(g.knowledgeFor('p2'), {}); // 신하는 아무것도 모름
});

test('시야: 악은 오베론을 뺀 악끼리 알고, 오베론은 아무도 모른다', () => {
  const g = riggedGame(['merlin', 'percival', 'servant', 'servant', 'servant', 'servant', 'assassin', 'mordred', 'oberon', 'morgana'],
    { percival: true, morgana: true, mordred: true, oberon: true });
  assert.deepEqual(g.knowledgeFor('p6'), { p7: 'evil', p9: 'evil' });
  assert.deepEqual(g.knowledgeFor('p7'), { p6: 'evil', p9: 'evil' });
  assert.deepEqual(g.knowledgeFor('p9'), { p6: 'evil', p7: 'evil' });
  assert.deepEqual(g.knowledgeFor('p8'), {});
});

test('시야: 랜슬롯끼리만 서로 알고, 악 랜슬롯과 다른 악은 서로 모른다 / 멀린은 악 랜슬롯도 본다', () => {
  const g = riggedGame(['merlin', 'lancelot_good', 'servant', 'servant', 'assassin', 'lancelot_evil', 'minion'], { percival: false, morgana: false, lancelot: true });
  assert.deepEqual(g.knowledgeFor('p1'), { p5: 'lancelot' });
  assert.deepEqual(g.knowledgeFor('p5'), { p1: 'lancelot' });
  assert.deepEqual(g.knowledgeFor('p4'), { p6: 'evil' });
  assert.deepEqual(g.knowledgeFor('p6'), { p4: 'evil' });
  assert.deepEqual(g.knowledgeFor('p0'), { p4: 'evil', p5: 'evil', p6: 'evil' });
});

test('투표: 찬성이 과반수를 넘어야 가결 (6명 중 3명 찬성은 부결)', () => {
  const g = riggedGame(['merlin', 'percival', 'servant', 'servant', 'assassin', 'morgana']);
  g.propose('p0', ['p0', 'p1']);
  voteAll(g, (id) => ['p0', 'p1', 'p2'].includes(id));
  assert.equal(g.phase, 'team');
  assert.equal(g.rejectCount, 1);
  assert.equal(g.leaderId, 'p1');
  assert.equal(g.lastVote.approved, false);
  g.propose('p1', ['p0', 'p1']);
  voteAll(g, (id) => ['p0', 'p1', 'p2', 'p3'].includes(id));
  assert.equal(g.phase, 'quest');
  assert.equal(g.lastVote.approved, true);
});

test('투표: 같은 사람이 두 번 투표할 수 없고, 비참가자는 투표 불가', () => {
  const g = riggedGame(['merlin', 'percival', 'servant', 'assassin', 'morgana']);
  g.propose('p0', ['p0', 'p1']);
  g.vote('p2', true);
  assert.throws(() => g.vote('p2', false), GameError);
  assert.throws(() => g.vote('nobody', true), GameError);
  assert.throws(() => g.vote('p3', 'yes'), GameError);
});

test('5번 연속 부결되면 즉시 악 승리', () => {
  const g = riggedGame(['merlin', 'percival', 'servant', 'assassin', 'morgana']);
  for (let i = 0; i < 5; i++) {
    assert.equal(g.phase, 'team');
    g.propose(g.leaderId, g.order.slice(0, 2));
    voteAll(g, () => false);
  }
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, 'evil');
});

test('연속 부결 수는 원정이 끝나면 초기화된다', () => {
  const g = riggedGame(['merlin', 'percival', 'servant', 'assassin', 'morgana']);
  for (let i = 0; i < 4; i++) {
    g.propose(g.leaderId, g.order.slice(0, 2));
    voteAll(g, () => false);
  }
  assert.equal(g.rejectCount, 4);
  passQuest(g, ['p0', 'p1']);
  assert.equal(g.round, 1);
  assert.equal(g.rejectCount, 0);
});

test('원정대장 규칙: 원정대장만, 정확한 인원만, 중복 없이', () => {
  const g = riggedGame(['merlin', 'percival', 'servant', 'assassin', 'morgana']);
  assert.throws(() => g.propose('p1', ['p0', 'p1']), GameError);
  assert.throws(() => g.propose('p0', ['p0']), GameError);
  assert.throws(() => g.propose('p0', ['p0', 'p0']), GameError);
  assert.throws(() => g.propose('p0', ['p0', 'zzz']), GameError);
  g.propose('p0', ['p3', 'p0']); // 자신 포함 OK
  assert.deepEqual(g.proposal, ['p0', 'p3']);
  assert.throws(() => g.propose('p0', ['p0', 'p1']), GameError); // 투표 중엔 불가
});

test('원정: 선은 실패를 낼 수 없고, 원정대원만 낼 수 있다', () => {
  const g = riggedGame(['merlin', 'percival', 'servant', 'assassin', 'morgana']);
  g.propose('p0', ['p0', 'p3']);
  voteAll(g, () => true);
  assert.throws(() => g.playCard('p0', 'fail'), GameError);
  assert.throws(() => g.playCard('p1', 'success'), GameError);
  g.playCard('p0', 'success');
  assert.throws(() => g.playCard('p0', 'success'), GameError);
  g.playCard('p3', 'fail');
  assert.equal(g.results.length, 1);
  assert.equal(g.results[0].success, false);
  assert.equal(g.results[0].fails, 1);
  assert.equal(g.leaderId, 'p1');
});

test('7명 네 번째 원정: 실패 1장이면 성공, 2장이면 실패', () => {
  const roles = ['merlin', 'percival', 'servant', 'servant', 'assassin', 'morgana', 'minion'];
  const g = riggedGame(roles);
  passQuest(g, ['p0', 'p1']);
  failQuest(g, 'p4');
  passQuest(g, ['p0', 'p1', 'p2']);
  assert.equal(g.round, 3);
  // 1장 실패 → 성공
  g.propose(g.leaderId, ['p0', 'p1', 'p4', 'p5']);
  voteAll(g, () => true);
  g.playCard('p0', 'success'); g.playCard('p1', 'success'); g.playCard('p4', 'fail'); g.playCard('p5', 'success');
  assert.equal(g.results[3].success, true);
  assert.equal(g.phase, 'assassination');

  const g2 = riggedGame(roles);
  passQuest(g2, ['p0', 'p1']);
  failQuest(g2, 'p4');
  passQuest(g2, ['p0', 'p1', 'p2']);
  g2.propose(g2.leaderId, ['p0', 'p1', 'p4', 'p5']);
  voteAll(g2, () => true);
  g2.playCard('p0', 'success'); g2.playCard('p1', 'success'); g2.playCard('p4', 'fail'); g2.playCard('p5', 'fail');
  assert.equal(g2.results[3].success, false);
  assert.equal(g2.results[3].required, 2);
});

test('원정 3번 실패 → 악 즉시 승리', () => {
  const g = riggedGame(['merlin', 'percival', 'servant', 'assassin', 'morgana']);
  failQuest(g, 'p3');
  failQuest(g, 'p3');
  assert.equal(g.phase, 'team');
  failQuest(g, 'p3');
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, 'evil');
});

test('원정 3번 성공 → 암살: 멀린 맞히면 악, 틀리면 선 승리', () => {
  const make = () => {
    const g = riggedGame(['merlin', 'percival', 'servant', 'assassin', 'morgana']);
    passQuest(g, ['p0', 'p1']);
    passQuest(g, ['p0', 'p1', 'p2']);
    passQuest(g, ['p0', 'p1']);
    return g;
  };
  const g = make();
  assert.equal(g.phase, 'assassination');
  const pv = g.publicView();
  assert.equal(pv.assassinId, 'p3');
  assert.equal(pv.allRoles, null);
  // 악 플레이어끼리 정체 공개
  assert.deepEqual(g.privateView('p4').evilReveal, { p3: 'assassin', p4: 'morgana' });
  assert.equal(g.privateView('p0').evilReveal, null);
  assert.throws(() => g.assassinate('p4', 'p0'), GameError); // 암살자만
  assert.throws(() => g.assassinate('p3', 'p4'), GameError); // 악은 지목 불가
  assert.throws(() => g.assassinate('p3', 'p3'), GameError);
  g.assassinate('p3', 'p0');
  assert.equal(g.winner, 'evil');
  assert.ok(g.publicView().allRoles);

  const g2 = make();
  g2.assassinate('p3', 'p1');
  assert.equal(g2.winner, 'good');
  assert.throws(() => g2.assassinate('p3', 'p0'), GameError); // 끝난 뒤엔 불가
});

test('랜슬롯: 전환되면 소속이 바뀌고 카드 제약도 바뀐다', () => {
  // rng 0.99 → 다음 라운드 시작 때 다시 전환되지 않도록 고정
  const g = riggedGame(['merlin', 'lancelot_good', 'servant', 'servant', 'assassin', 'lancelot_evil', 'minion'], { percival: false, morgana: false, lancelot: true }, () => 0.99);
  g.lancelotFlipped = true;
  assert.equal(g.teamOf('p1'), 'evil');
  assert.equal(g.teamOf('p5'), 'good');
  g.propose(g.leaderId, ['p1', 'p5']);
  voteAll(g, () => true);
  assert.throws(() => g.playCard('p5', 'fail'), GameError);
  g.playCard('p5', 'success');
  g.playCard('p1', 'fail');
  assert.equal(g.results[0].success, false);
  assert.equal(g.privateView('p1').team, 'evil');
  assert.equal(g.privateView('p1').initialTeam, 'good');
});

test('랜슬롯: 매 원정 전 확률(2/7)로 전환 기록이 남는다', () => {
  // rng: 항상 0 → 매번 전환
  const always = () => 0;
  const g = new Game(players(7), { percival: false, morgana: false, lancelot: true }, always);
  assert.deepEqual(g.lancelotHistory, [true]);
  assert.equal(g.lancelotFlipped, true);
  const never = () => 0.99;
  const g2 = new Game(players(7), { percival: false, morgana: false, lancelot: true }, never);
  assert.deepEqual(g2.lancelotHistory, [false]);
  assert.equal(g2.lancelotFlipped, false);
  // 랜슬롯 미사용이면 기록 없음
  const g3 = new Game(players(7), {});
  assert.deepEqual(g3.lancelotHistory, []);
  // 확률 경계: 2/7 미만이면 전환
  let calls = 0;
  const g4 = new Game(players(7), { lancelot: true, percival: false, morgana: false }, () => { calls++; return 0.5; });
  assert.equal(g4.lancelotHistory[0], false);
  g4.rng = () => 2 / 7 - 0.0001;
  g4.round = 1;
  g4.startRound();
  assert.equal(g4.lancelotHistory[1], true);
  assert.ok(calls > 0);
});

test('랜슬롯 전환 확률이 약 2/7 이다 (통계)', () => {
  let swaps = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const g = new Game(players(7), { percival: false, morgana: false, lancelot: true });
    if (g.lancelotHistory[0]) swaps++;
  }
  const p = swaps / N;
  assert.ok(Math.abs(p - 2 / 7) < 0.02, `p=${p}`);
});

test('공개 정보에 역할이 새지 않는다', () => {
  const g = new Game(players(8), { percival: true, morgana: true });
  const pv = g.publicView();
  assert.equal(pv.allRoles, null);
  assert.equal(pv.finalTeams, null);
  assert.equal(pv.assassinId, null);
  for (const id of g.order) assert.ok(!JSON.stringify(pv).includes(`"${id}":"`), '플레이어 ID 와 역할이 짝지어지면 안 됨');
  // 투표 중에는 누가 투표했는지만 공개
  g.propose(g.leaderId, g.order.slice(0, 3));
  g.vote('p0', false);
  const v = g.publicView();
  assert.deepEqual(v.votedIds, ['p0']);
  assert.equal(v.lastVote, null);
  assert.equal(g.privateView('p0').myVote, false);
  assert.equal(g.privateView('p1').myVote, null);
});

test('무작위 전체 게임 시뮬레이션 3000판: 항상 정상 종료하고 규칙을 지킨다', () => {
  for (let i = 0; i < 3000; i++) {
    const n = 5 + (i % 6);
    const combos = allOptionCombos().filter((o) => validateOptions(n, o) === null);
    const opts = combos[Math.floor(Math.random() * combos.length)];
    const g = new Game(players(n), opts);
    let steps = 0;
    while (g.phase !== 'over') {
      if (++steps > 500) assert.fail('게임이 끝나지 않음');
      if (g.phase === 'team') {
        const team = [...g.order].sort(() => Math.random() - 0.5).slice(0, g.questSize);
        g.propose(g.leaderId, team);
      } else if (g.phase === 'vote') {
        for (const id of g.order) g.vote(id, Math.random() < 0.6);
      } else if (g.phase === 'quest') {
        for (const id of g.proposal) {
          const evil = g.teamOf(id) === 'evil';
          g.playCard(id, evil && Math.random() < 0.5 ? 'fail' : 'success');
        }
      } else if (g.phase === 'assassination') {
        const assassin = g.playerWithRole('assassin');
        const candidates = g.order.filter((id) => g.teamOf(id) === 'good');
        g.assassinate(assassin, candidates[Math.floor(Math.random() * candidates.length)]);
      }
    }
    assert.ok(g.winner === 'good' || g.winner === 'evil');
    assert.ok(g.results.length <= 5);
    const s = g.results.filter((r) => r.success).length;
    const f = g.results.length - s;
    assert.ok(s <= 3 && f <= 3);
    if (g.winner === 'good') {
      assert.equal(s, 3);
      assert.notEqual(g.roles[g.assassinTarget], 'merlin');
    }
    for (const r of g.results) {
      assert.equal(r.team.length, QUEST_SIZES[n][r.round]);
      assert.equal(r.success, r.fails < failsRequired(n, r.round));
    }
  }
});
