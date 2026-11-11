'use strict';

// ─────────────────────────────────────────────────────────────
//  아발론 게임 규칙 엔진 (네트워크와 무관한 순수 로직)
// ─────────────────────────────────────────────────────────────

const ROLES = {
  merlin:        { name: '멀린',                      team: 'good' },
  percival:      { name: '퍼시벌',                    team: 'good' },
  servant:       { name: '아서 왕의 충성스러운 신하', team: 'good' },
  lancelot_good: { name: '선 랜슬롯',                 team: 'good' },
  assassin:      { name: '암살자',                    team: 'evil' },
  morgana:       { name: '모르가나',                  team: 'evil' },
  mordred:       { name: '모드레드',                  team: 'evil' },
  oberon:        { name: '오베론',                    team: 'evil' },
  minion:        { name: '모드레드의 수하',           team: 'evil' },
  lancelot_evil: { name: '악 랜슬롯',                 team: 'evil' },
};

// 인원별 [선, 악]
const TEAM_SIZES = {
  5: { good: 3, evil: 2 },
  6: { good: 4, evil: 2 },
  7: { good: 4, evil: 3 },
  8: { good: 5, evil: 3 },
  9: { good: 6, evil: 3 },
  10: { good: 6, evil: 4 },
};

// 인원별 원정 인원
const QUEST_SIZES = {
  5: [2, 3, 2, 3, 3],
  6: [2, 3, 4, 3, 4],
  7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5],
  9: [3, 4, 4, 5, 5],
  10: [3, 4, 4, 5, 5],
};

const MIN_PLAYERS = 5;
const MAX_PLAYERS = 10;
const MAX_REJECTS = 5;
const LANCELOT_SWAP_CHANCE = 2 / 7;

const DEFAULT_OPTIONS = {
  percival: true,
  morgana: true,
  mordred: false,
  oberon: false,
  lancelot: false,
};

// 7명 이상, 네 번째 원정(index 3)은 실패 2장 이상 필요
function failsRequired(playerCount, questIndex) {
  return playerCount >= 7 && questIndex === 3 ? 2 : 1;
}

function normalizeOptions(options) {
  const o = {};
  for (const k of Object.keys(DEFAULT_OPTIONS)) {
    o[k] = options && typeof options[k] === 'boolean' ? options[k] : DEFAULT_OPTIONS[k];
  }
  return o;
}

// 옵션 검증 — 문제 있으면 한국어 오류 메시지, 없으면 null
function validateOptions(playerCount, options) {
  const sizes = TEAM_SIZES[playerCount];
  if (!sizes) return `${MIN_PLAYERS}~${MAX_PLAYERS}명만 플레이할 수 있습니다.`;
  const o = normalizeOptions(options);
  const goodSpecial = 1 + (o.percival ? 1 : 0) + (o.lancelot ? 1 : 0);
  const evilSpecial = 1 + (o.morgana ? 1 : 0) + (o.mordred ? 1 : 0) + (o.oberon ? 1 : 0) + (o.lancelot ? 1 : 0);
  if (goodSpecial > sizes.good) {
    return `선 역할이 너무 많습니다. (${playerCount}명: 선 ${sizes.good}명 / 선택한 선 특수역할 ${goodSpecial}개)`;
  }
  if (evilSpecial > sizes.evil) {
    return `악 역할이 너무 많습니다. (${playerCount}명: 악 ${sizes.evil}명 / 선택한 악 특수역할 ${evilSpecial}개)`;
  }
  return null;
}

// 인원과 옵션에 맞는 역할 목록 (섞기 전)
function buildRoleList(playerCount, options) {
  const err = validateOptions(playerCount, options);
  if (err) throw new GameError(err);
  const o = normalizeOptions(options);
  const sizes = TEAM_SIZES[playerCount];
  const good = ['merlin'];
  if (o.percival) good.push('percival');
  if (o.lancelot) good.push('lancelot_good');
  while (good.length < sizes.good) good.push('servant');
  const evil = ['assassin'];
  if (o.morgana) evil.push('morgana');
  if (o.mordred) evil.push('mordred');
  if (o.oberon) evil.push('oberon');
  if (o.lancelot) evil.push('lancelot_evil');
  while (evil.length < sizes.evil) evil.push('minion');
  return good.concat(evil);
}

// 역할 구성표 [{role, name, team, count}]
function composition(playerCount, options) {
  const list = buildRoleList(playerCount, options);
  const order = ['merlin', 'percival', 'lancelot_good', 'servant', 'assassin', 'morgana', 'mordred', 'oberon', 'lancelot_evil', 'minion'];
  const counts = {};
  for (const r of list) counts[r] = (counts[r] || 0) + 1;
  return order.filter((r) => counts[r]).map((r) => ({ role: r, name: ROLES[r].name, team: ROLES[r].team, count: counts[r] }));
}

class GameError extends Error {}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class Game {
  /**
   * @param {{id:string,name:string}[]} players 좌석 순서(시계 방향)
   * @param {object} options 역할 옵션
   * @param {() => number} rng 난수 함수 (테스트용 주입 가능)
   */
  constructor(players, options, rng = Math.random) {
    const n = players.length;
    if (n < MIN_PLAYERS || n > MAX_PLAYERS) throw new GameError(`${MIN_PLAYERS}~${MAX_PLAYERS}명만 플레이할 수 있습니다.`);
    this.rng = rng;
    this.options = normalizeOptions(options);
    this.order = players.map((p) => p.id);
    this.names = {};
    for (const p of players) this.names[p.id] = p.name;
    this.n = n;
    this.questSizes = QUEST_SIZES[n].slice();

    const roleList = shuffle(buildRoleList(n, this.options), rng);
    this.roles = {};
    this.order.forEach((id, i) => { this.roles[id] = roleList[i]; });

    this.leaderIndex = Math.floor(rng() * n);
    this.round = 0;              // 0~4
    this.attempt = 1;            // 이번 라운드 몇 번째 원정대 제안인지
    this.rejectCount = 0;        // 이번 라운드 연속 부결 수
    this.results = [];           // 원정 결과
    this.voteHistory = [];
    this.lastVote = null;
    this.proposal = null;
    this.votes = {};
    this.questCards = {};
    this.lancelotHistory = [];   // 라운드별 true(바뀜)/false(그대로)
    this.lancelotFlipped = false;
    this.winner = null;
    this.reason = null;
    this.assassinTarget = null;
    this.logs = [];              // 서버가 시스템 메시지로 가져감
    this.phase = 'team';

    this.log(`게임 시작! 첫 원정대장은 ${this.nameOf(this.leaderId)}님입니다.`);
    this.startRound();
  }

  nameOf(id) { return this.names[id] || '???'; }
  log(text) { this.logs.push(text); }
  drainLogs() { const l = this.logs; this.logs = []; return l; }

  get leaderId() { return this.order[this.leaderIndex]; }
  get questSize() { return this.questSizes[this.round]; }
  get successCount() { return this.results.filter((r) => r.success).length; }
  get failCount() { return this.results.filter((r) => !r.success).length; }

  initialTeam(id) { return ROLES[this.roles[id]].team; }

  // 현재 소속 (랜슬롯은 전환 상태에 따라 바뀜)
  teamOf(id) {
    const role = this.roles[id];
    const base = ROLES[role].team;
    if ((role === 'lancelot_good' || role === 'lancelot_evil') && this.lancelotFlipped) {
      return base === 'good' ? 'evil' : 'good';
    }
    return base;
  }

  playerWithRole(role) { return this.order.find((id) => this.roles[id] === role) || null; }
  isPlayer(id) { return Object.prototype.hasOwnProperty.call(this.roles, id); }

  startRound() {
    this.phase = 'team';
    this.proposal = null;
    this.votes = {};
    this.questCards = {};
    this.rejectCount = 0;
    this.attempt = 1;
    if (this.options.lancelot) {
      const swap = this.rng() < LANCELOT_SWAP_CHANCE;
      this.lancelotHistory[this.round] = swap;
      if (swap) this.lancelotFlipped = !this.lancelotFlipped;
      this.log(swap
        ? `⟳ ${this.round + 1}라운드: 랜슬롯의 충성이 바뀌었습니다!`
        : `${this.round + 1}라운드: 랜슬롯의 충성은 그대로입니다.`);
    }
    this.log(`── ${this.round + 1}번째 원정 (${this.questSize}명${failsRequired(this.n, this.round) > 1 ? ', 실패 2장 이상 필요' : ''}) · 원정대장: ${this.nameOf(this.leaderId)}`);
  }

  advanceLeader() {
    this.leaderIndex = (this.leaderIndex + 1) % this.n;
  }

  // 원정대장이 원정대 제안
  propose(playerId, team) {
    if (this.phase !== 'team') throw new GameError('지금은 원정대를 고를 수 없습니다.');
    if (playerId !== this.leaderId) throw new GameError('원정대장만 원정대를 고를 수 있습니다.');
    if (!Array.isArray(team)) throw new GameError('잘못된 원정대입니다.');
    const unique = [...new Set(team)];
    if (unique.length !== team.length) throw new GameError('같은 사람을 두 번 고를 수 없습니다.');
    if (unique.length !== this.questSize) throw new GameError(`원정대는 ${this.questSize}명이어야 합니다.`);
    if (!unique.every((id) => this.isPlayer(id))) throw new GameError('게임에 없는 플레이어가 포함되어 있습니다.');
    // 좌석 순서로 정렬
    this.proposal = this.order.filter((id) => unique.includes(id));
    this.votes = {};
    this.phase = 'vote';
    this.log(`👑 ${this.nameOf(playerId)}님이 원정대를 제안: ${this.proposal.map((id) => this.nameOf(id)).join(', ')}`);
  }

  // 찬반 투표
  vote(playerId, approve) {
    if (this.phase !== 'vote') throw new GameError('지금은 투표할 수 없습니다.');
    if (!this.isPlayer(playerId)) throw new GameError('게임 참가자가 아닙니다.');
    if (Object.prototype.hasOwnProperty.call(this.votes, playerId)) throw new GameError('이미 투표했습니다.');
    if (typeof approve !== 'boolean') throw new GameError('잘못된 투표입니다.');
    this.votes[playerId] = approve;
    if (Object.keys(this.votes).length === this.n) this.resolveVote();
  }

  resolveVote() {
    const approves = this.order.filter((id) => this.votes[id]).length;
    const approved = approves * 2 > this.n; // 과반수 초과
    this.lastVote = {
      round: this.round,
      attempt: this.attempt,
      leaderId: this.leaderId,
      team: this.proposal.slice(),
      votes: { ...this.votes },
      approves,
      rejects: this.n - approves,
      approved,
    };
    this.voteHistory.push(this.lastVote);
    const approvers = this.order.filter((id) => this.votes[id]).map((id) => this.nameOf(id));
    const rejecters = this.order.filter((id) => !this.votes[id]).map((id) => this.nameOf(id));
    this.log(`🗳️ 투표 결과: ${approved ? '가결' : '부결'} (찬성 ${approves} / 반대 ${this.n - approves})` +
      ` · 찬성: ${approvers.join(', ') || '없음'} · 반대: ${rejecters.join(', ') || '없음'}`);
    if (approved) {
      this.phase = 'quest';
      this.questCards = {};
      this.log(`원정 출발! ${this.proposal.map((id) => this.nameOf(id)).join(', ')}님은 카드를 내 주세요.`);
    } else {
      this.rejectCount++;
      if (this.rejectCount >= MAX_REJECTS) {
        this.endGame('evil', '원정대가 5번 연속 부결되었습니다.');
        return;
      }
      this.attempt++;
      this.proposal = null;
      this.votes = {};
      this.advanceLeader();
      this.phase = 'team';
      this.log(`원정대장이 ${this.nameOf(this.leaderId)}님으로 넘어갑니다. (연속 부결 ${this.rejectCount}/5)`);
    }
  }

  // 원정 카드 제출
  playCard(playerId, card) {
    if (this.phase !== 'quest') throw new GameError('지금은 원정 카드를 낼 수 없습니다.');
    if (!this.proposal.includes(playerId)) throw new GameError('원정대원만 카드를 낼 수 있습니다.');
    if (Object.prototype.hasOwnProperty.call(this.questCards, playerId)) throw new GameError('이미 카드를 냈습니다.');
    if (card !== 'success' && card !== 'fail') throw new GameError('잘못된 카드입니다.');
    if (card === 'fail' && this.teamOf(playerId) === 'good') throw new GameError('선 플레이어는 성공 카드만 낼 수 있습니다.');
    this.questCards[playerId] = card;
    if (Object.keys(this.questCards).length === this.proposal.length) this.resolveQuest();
  }

  resolveQuest() {
    const fails = Object.values(this.questCards).filter((c) => c === 'fail').length;
    const required = failsRequired(this.n, this.round);
    const success = fails < required;
    this.results.push({
      round: this.round,
      team: this.proposal.slice(),
      leaderId: this.leaderId,
      fails,
      successes: this.proposal.length - fails,
      required,
      success,
    });
    this.log(`${success ? '✅' : '❌'} ${this.round + 1}번째 원정 ${success ? '성공' : '실패'}! (성공 카드 ${this.proposal.length - fails}장 / 실패 카드 ${fails}장)`);
    this.questCards = {};
    if (this.successCount >= 3) {
      this.phase = 'assassination';
      this.proposal = null;
      this.log('원정 3번 성공! 악 플레이어들이 정체를 공개하고, 암살자가 멀린을 지목합니다.');
      return;
    }
    if (this.failCount >= 3) {
      this.endGame('evil', '원정이 3번 실패했습니다.');
      return;
    }
    this.round++;
    this.advanceLeader();
    this.startRound();
  }

  // 암살자의 멀린 지목
  assassinate(playerId, targetId) {
    if (this.phase !== 'assassination') throw new GameError('지금은 암살할 수 없습니다.');
    if (this.roles[playerId] !== 'assassin') throw new GameError('암살자만 지목할 수 있습니다.');
    if (!this.isPlayer(targetId)) throw new GameError('게임에 없는 플레이어입니다.');
    if (targetId === playerId) throw new GameError('자기 자신은 지목할 수 없습니다.');
    if (this.teamOf(targetId) === 'evil') throw new GameError('악 플레이어는 지목할 수 없습니다.');
    this.assassinTarget = targetId;
    const hit = this.roles[targetId] === 'merlin';
    this.log(`🗡️ 암살자 ${this.nameOf(playerId)}님이 ${this.nameOf(targetId)}님을 지목했습니다.`);
    if (hit) this.endGame('evil', `암살자가 멀린(${this.nameOf(targetId)})을 찾아냈습니다!`);
    else this.endGame('good', `암살 실패! ${this.nameOf(targetId)}님은 멀린이 아니었습니다. (멀린: ${this.nameOf(this.playerWithRole('merlin'))})`);
  }

  endGame(winner, reason) {
    this.phase = 'over';
    this.winner = winner;
    this.reason = reason;
    this.log(`🏁 ${winner === 'good' ? '선' : '악'}의 승리! ${reason}`);
  }

  // 시작 시 각자가 알 수 있는 정보 {playerId: 'evil' | 'merlin?' | 'lancelot'}
  knowledgeFor(viewerId) {
    const role = this.roles[viewerId];
    const k = {};
    if (!role) return k;
    for (const id of this.order) {
      if (id === viewerId) continue;
      const r = this.roles[id];
      const evil = ROLES[r].team === 'evil';
      if (role === 'merlin') {
        if (evil && r !== 'mordred') k[id] = 'evil';
      } else if (role === 'percival') {
        if (r === 'merlin' || r === 'morgana') k[id] = 'merlin?';
      } else if (ROLES[role].team === 'evil' && role !== 'oberon') {
        if (evil && r !== 'oberon') k[id] = 'evil';
      }
      if ((role === 'lancelot_good' || role === 'lancelot_evil') && (r === 'lancelot_good' || r === 'lancelot_evil')) {
        k[id] = 'lancelot';
      }
    }
    return k;
  }

  // 공개 정보 (모두에게 동일)
  publicView() {
    const over = this.phase === 'over';
    const reveal = this.phase === 'assassination' || over;
    return {
      phase: this.phase,
      round: this.round,
      order: this.order.slice(),
      leaderId: this.leaderId,
      questSizes: this.questSizes.slice(),
      failsRequired: this.questSizes.map((_, i) => failsRequired(this.n, i)),
      results: this.results.map((r) => ({ ...r, team: r.team.slice() })),
      rejectCount: this.rejectCount,
      attempt: this.attempt,
      proposal: this.proposal ? this.proposal.slice() : null,
      votedIds: Object.keys(this.votes),
      lastVote: this.lastVote ? { ...this.lastVote, team: this.lastVote.team.slice(), votes: { ...this.lastVote.votes } } : null,
      questPlayedIds: Object.keys(this.questCards),
      lancelotEnabled: this.options.lancelot,
      lancelotHistory: this.lancelotHistory.slice(),
      composition: composition(this.n, this.options),
      options: { ...this.options },
      assassinId: reveal ? this.playerWithRole('assassin') : null,
      assassinTarget: this.assassinTarget,
      winner: this.winner,
      reason: this.reason,
      allRoles: over ? { ...this.roles } : null,
      finalTeams: over ? Object.fromEntries(this.order.map((id) => [id, this.teamOf(id)])) : null,
    };
  }

  // 개인 정보
  privateView(viewerId) {
    if (!this.isPlayer(viewerId)) return null;
    const role = this.roles[viewerId];
    const team = this.teamOf(viewerId);
    const knowledge = this.knowledgeFor(viewerId);
    let evilReveal = null;
    // 암살 단계: 현재 악 플레이어끼리 정체 공개
    if ((this.phase === 'assassination' || this.phase === 'over') && team === 'evil') {
      evilReveal = {};
      for (const id of this.order) if (this.teamOf(id) === 'evil') evilReveal[id] = this.roles[id];
    }
    return {
      role,
      roleName: ROLES[role].name,
      initialTeam: ROLES[role].team,
      team,
      knowledge,
      evilReveal,
      myVote: Object.prototype.hasOwnProperty.call(this.votes, viewerId) ? this.votes[viewerId] : null,
      myCard: Object.prototype.hasOwnProperty.call(this.questCards, viewerId) ? this.questCards[viewerId] : null,
      canFail: team === 'evil',
    };
  }
}

module.exports = {
  ROLES,
  TEAM_SIZES,
  QUEST_SIZES,
  MIN_PLAYERS,
  MAX_PLAYERS,
  MAX_REJECTS,
  LANCELOT_SWAP_CHANCE,
  DEFAULT_OPTIONS,
  failsRequired,
  normalizeOptions,
  validateOptions,
  buildRoleList,
  composition,
  shuffle,
  Game,
  GameError,
};
