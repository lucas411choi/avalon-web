'use strict';

// ─────────────────────────────────────────────────────────────
//  AI 플레이어 두뇌
//  AI 는 자기가 정당하게 알 수 있는 정보(자기 역할, 시작 시야, 공개 기록)만 사용합니다.
// ─────────────────────────────────────────────────────────────

const { failsRequired, TEAM_SIZES } = require('./game');

const AI_NAMES = ['아서', '가웨인', '트리스탄', '갤러해드', '보르스', '케이', '베디비어', '가레스', '라모락', '이웨인'];

// 밸런스 조절값 (AI 끼리 했을 때 선/악 승률이 비슷하도록 맞춤)
const TUNE = {
  merlinHide: 0.12,
  inTeamLimit: 1.1,
  outTeamLimit: 0.6,
  outTeamApprove: 0.35,
  assassinNoise: 1.2,
  rejectTrust: 0.3,
  evilFailFirst: 0.35,
  evilFailLater: 0.8,
  assumedFail: 0.7,
  voteEvidence: 1.15,
  approveRatio: 0.85,
};

function noise(rng, amount) {
  return (rng() - 0.5) * amount;
}

// 이 AI 가 아는 악 동료 (자기 포함). 오베론·악 랜슬롯은 아무도 모름.
function knownAllies(game, id) {
  const k = game.knowledgeFor(id);
  const allies = new Set([id]);
  if (game.teamOf(id) === 'evil') {
    for (const [pid, v] of Object.entries(k)) if (v === 'evil') allies.add(pid);
  }
  return allies;
}

// 다른 플레이어들이 얼마나 수상한지 (높을수록 악 같음)
function suspicion(game, id) {
  const s = {};
  for (const pid of game.order) s[pid] = 0;
  const myTeam = game.teamOf(id);
  for (const r of game.results) {
    const others = r.team.filter((x) => x !== id);
    if (!others.length) continue;
    if (!r.success || r.fails > 0) {
      // 내가 선인데 원정대에 있었다면 실패는 다른 사람 몫
      const weight = (r.fails * 2.2) / others.length;
      for (const x of others) s[x] += weight;
    } else {
      for (const x of others) s[x] -= 0.45;
    }
  }
  // 투표 성향: 실패한 원정대에 찬성한 사람, 성공한 원정대에 반대한 사람
  for (const v of game.voteHistory) {
    if (!v.approved) continue;
    const r = game.results.find((x) => x.round === v.round);
    if (!r) continue;
    for (const pid of game.order) {
      if (pid === id) continue;
      if (r.fails > 0 && v.votes[pid] && !r.team.includes(pid)) s[pid] += 0.25;
      if (r.fails === 0 && !v.votes[pid]) s[pid] += 0.2;
      if (r.fails > 0 && !v.votes[pid]) s[pid] -= TUNE.rejectTrust; // 실패할 원정대를 막으려 한 사람은 믿을 만함
    }
  }
  const k = game.knowledgeFor(id);
  for (const [pid, v] of Object.entries(k)) {
    if (v === 'evil' && myTeam === 'good') s[pid] += 50;
    if (v === 'merlin?') s[pid] -= 0.8;
  }
  return s;
}

// ── 추론: 가능한 모든 "악 조합"을 따져 각 플레이어가 악일 확률 계산 ──
function combos(arr, k, start = 0, cur = [], out = []) {
  if (cur.length === k) { out.push(cur.slice()); return out; }
  for (let i = start; i <= arr.length - (k - cur.length); i++) {
    cur.push(arr[i]);
    combos(arr, k, i + 1, cur, out);
    cur.pop();
  }
  return out;
}
function choose(n, k) { let r = 1; for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1); return r; }

function beliefs(game, id) {
  const evilCount = TEAM_SIZES[game.n].evil;
  const k = game.knowledgeFor(id);
  const myRole = game.roles[id];
  const pool = game.order.filter((x) => x !== id);
  const mustEvil = pool.filter((x) => k[x] === 'evil' || (k[x] === 'lancelot' && game.initialTeam(id) === 'good'));
  const merlinPair = pool.filter((x) => k[x] === 'merlin?');
  const p = TUNE.assumedFail;
  const worlds = [];
  let total = 0;
  for (const set of combos(pool, evilCount)) {
    const evil = new Set(set);
    if (!mustEvil.every((x) => evil.has(x))) continue;
    // 멀린은 모드레드 말고는 다 보이므로, 보이지 않는 악은 최대 (모드레드 수)명
    if (myRole === 'merlin') {
      const hidden = set.filter((x) => k[x] !== 'evil').length;
      if (hidden > (game.options.mordred ? 1 : 0)) continue;
    }
    if (myRole === 'percival' && merlinPair.length === 2) {
      const n = merlinPair.filter((x) => evil.has(x)).length;
      if (n !== 1) continue;
    }
    let w = 1;
    for (const r of game.results) {
      const kIn = r.team.filter((x) => evil.has(x)).length;
      if (r.fails > kIn) { w = 0; break; }
      w *= choose(kIn, r.fails) * p ** r.fails * (1 - p) ** (kIn - r.fails);
    }
    // 투표 성향(약한 증거): 악은 악이 낀 원정대에 찬성하는 경향
    for (const v of game.voteHistory) {
      const hasEvil = v.team.some((x) => evil.has(x));
      for (const x of set) {
        if (v.votes[x] === undefined) continue;
        w *= (hasEvil === v.votes[x]) ? TUNE.voteEvidence : 1 / TUNE.voteEvidence;
      }
    }
    if (w > 0) { worlds.push({ evil, w }); total += w; }
  }
  const pEvil = {};
  for (const x of game.order) pEvil[x] = 0;
  if (total === 0) {
    for (const x of pool) pEvil[x] = evilCount / pool.length;
    return { pEvil, pClean: () => 0.5 };
  }
  for (const { evil, w } of worlds) for (const x of evil) pEvil[x] += w / total;
  const pClean = (team) => {
    let c = 0;
    for (const { evil, w } of worlds) if (!team.some((x) => evil.has(x))) c += w;
    return c / total;
  };
  return { pEvil, pClean };
}

function bestTeamFor(game, id, size, b, rng, amount = 0.05) {
  const others = game.order.filter((x) => x !== id);
  const score = {};
  for (const x of others) score[x] = b.pEvil[x] + noise(rng, amount);
  return [id, ...sortBy(others, score).slice(0, size - 1)];
}

function sortBy(ids, score) {
  return ids.slice().sort((a, b) => score[a] - score[b]);
}

// ── 원정대 제안 ────────────────────────────────────────────
function chooseTeam(game, id, rng) {
  const size = game.questSize;
  const others = game.order.filter((x) => x !== id);
  if (game.teamOf(id) === 'good') return bestTeamFor(game, id, size, beliefs(game, id), rng);
  // 악: 자신 + 믿음직해 보이는(덜 의심받는) 선 위주, 실패 2장이 필요하면 동료 1명 추가
  const allies = knownAllies(game, id);
  const team = [id];
  if (failsRequired(game.n, game.round) > 1) {
    const ally = others.find((x) => allies.has(x));
    if (ally) team.push(ally);
  }
  const pub = {};
  for (const x of others) pub[x] = noise(rng, 1) + (allies.has(x) ? 1 : 0);
  for (const r of game.results) for (const x of r.team) if (r.fails > 0 && pub[x] !== undefined) pub[x] += 0.8;
  for (const x of sortBy(others.filter((o) => !team.includes(o)), pub)) {
    if (team.length >= size) break;
    team.push(x);
  }
  return team.slice(0, size);
}

// ── 찬반 투표 ──────────────────────────────────────────────
function chooseVote(game, id, rng) {
  const team = game.proposal;
  const role = game.roles[id];
  if (game.teamOf(id) === 'good') {
    if (game.rejectCount >= 4) return true; // 5번째 부결은 곧 패배
    if (game.leaderId === id) return true;
    const k = game.knowledgeFor(id);
    const knownEvil = team.some((x) => k[x] === 'evil');
    if (knownEvil) return role === 'merlin' ? rng() < TUNE.merlinHide : false; // 멀린은 가끔 숨기려고 찬성
    // 이 원정대가 깨끗할 확률을, 내가 짤 수 있는 최선의 원정대와 비교
    const b = beliefs(game, id);
    const mine = b.pClean(team);
    const best = b.pClean(bestTeamFor(game, id, team.length, b, rng, 0));
    const leniency = TUNE.approveRatio - game.rejectCount * 0.12;
    return mine >= best * leniency - 1e-9;
  }
  // 악
  const allies = knownAllies(game, id);
  const evilIn = team.some((x) => allies.has(x));
  if (evilIn) return rng() < 0.92;
  if (game.rejectCount >= 4) return rng() < 0.1;
  return rng() < 0.3;
}

// ── 원정 카드 ──────────────────────────────────────────────
function chooseCard(game, id, rng) {
  if (game.teamOf(id) === 'good') return 'success';
  const need = failsRequired(game.n, game.round);
  if (need > 1) return 'fail';
  if (game.successCount >= 2 || game.failCount >= 2) return 'fail';
  // 같은 원정대에 아는 동료가 있으면 좌석 순서가 빠른 한 명만 실패
  const allies = knownAllies(game, id);
  const alliesIn = game.proposal.filter((x) => allies.has(x));
  if (alliesIn.length > 1 && alliesIn[0] !== id) return 'success';
  if (game.round === 0) return rng() < TUNE.evilFailFirst ? 'fail' : 'success';
  return rng() < TUNE.evilFailLater ? 'fail' : 'success';
}

// ── 암살: 멀린 같은 사람 점수 (높을수록 멀린 같음) ─────────
function merlinScores(game, assassinId) {
  const evil = new Set(game.order.filter((x) => game.teamOf(x) === 'evil'));
  const evilInitial = new Set(game.order.filter((x) => game.initialTeam(x) === 'evil' && game.roles[x] !== 'mordred'));
  const cand = game.order.filter((x) => x !== assassinId && !evil.has(x));
  const score = {};
  for (const c of cand) score[c] = 0;
  for (const v of game.voteHistory) {
    const hasEvil = v.team.some((x) => evilInitial.has(x));
    for (const c of cand) {
      if (hasEvil && v.votes[c] === false) score[c] += 1;
      if (hasEvil && v.votes[c] === true) score[c] -= 0.6;
      if (!hasEvil && v.votes[c] === true) score[c] += 0.2;
    }
    if (score[v.leaderId] !== undefined) score[v.leaderId] += hasEvil ? -1 : 0.5;
  }
  return { cand, score };
}

function chooseAssassination(game, id, rng, hintId = null) {
  const { cand, score } = merlinScores(game, id);
  if (hintId && cand.includes(hintId)) return hintId;
  let best = cand[0];
  let bestScore = -Infinity;
  for (const c of cand) {
    const v = score[c] + noise(rng, TUNE.assassinNoise);
    if (v > bestScore) { bestScore = v; best = c; }
  }
  return best;
}

// 지금 이 AI 가 해야 할 행동 (없으면 null)
function decide(game, id, rng = Math.random) {
  if (!game || !game.isPlayer(id) || game.phase === 'over') return null;
  switch (game.phase) {
    case 'team':
      if (game.leaderId !== id) return null;
      return { action: 'propose', payload: { team: chooseTeam(game, id, rng) } };
    case 'vote':
      if (Object.prototype.hasOwnProperty.call(game.votes, id)) return null;
      return { action: 'vote', payload: { approve: chooseVote(game, id, rng) } };
    case 'quest':
      if (!game.proposal.includes(id) || Object.prototype.hasOwnProperty.call(game.questCards, id)) return null;
      return { action: 'card', payload: { card: chooseCard(game, id, rng) } };
    case 'assassination':
      if (game.roles[id] !== 'assassin') return null;
      return { action: 'assassinate', payload: { targetId: chooseAssassination(game, id, rng) } };
    default:
      return null;
  }
}

// 채팅 문장 ─────────────────────────────────────────────────
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

function questComment(game, id, result, nameOf, rng) {
  const s = suspicion(game, id);
  const others = game.order.filter((x) => x !== id && s[x] < 40);
  const worst = others.sort((a, b) => s[b] - s[a])[0];
  if (result.success) {
    return pick(['좋아요, 이 원정대는 믿을 만하네요.', '성공! 이 멤버 그대로 가도 되겠어요.', '역시 기사단은 든든하군요.', '다음 원정도 이렇게만 갑시다.'], rng);
  }
  return pick([
    `누가 실패를 낸 거죠? ${worst ? `${nameOf(worst)}님이 좀 수상한데요…` : ''}`,
    `실패라니… ${worst ? `저는 ${nameOf(worst)}님을 의심합니다.` : '다들 솔직해집시다.'}`,
    '이 원정대 안에 배신자가 있어요!',
    `${worst ? `${nameOf(worst)}님, 해명해 보세요.` : '흠… 누군지 꼭 찾아내야겠어요.'}`,
  ], rng);
}

function dmReply(game, id, text, nameOf, rng) {
  if (!game) return pick(['안녕하세요! 게임 시작하면 잘 부탁드려요.', '반갑습니다, 기사님.'], rng);
  const s = suspicion(game, id);
  const others = game.order.filter((x) => x !== id && s[x] < 40);
  const worst = others.sort((a, b) => s[b] - s[a])[0];
  const claim = pick(['저는 선입니다. 믿어 주세요.', '아서 왕께 충성을 맹세한 몸입니다.', '저는 결백해요!'], rng);
  if (/누구|의심|수상|악/.test(text) && worst) return `제가 보기엔 ${nameOf(worst)}님이 제일 수상해요.`;
  if (/멀린/.test(text)) return '멀린이 누군지는 저도 몰라요… 알아도 말 못 하죠.';
  return claim;
}

function assassinSuggestion(game, id, nameOf, rng) {
  const assassin = game.playerWithRole('assassin');
  const target = chooseAssassination(game, assassin, rng);
  return { targetId: target, text: pick([`제 생각엔 ${nameOf(target)}님이 멀린 같아요.`, `${nameOf(target)}님이 악을 너무 잘 피했어요. 멀린일 거예요.`], rng) };
}

module.exports = {
  TUNE,
  AI_NAMES,
  decide,
  suspicion,
  knownAllies,
  chooseTeam,
  chooseVote,
  chooseCard,
  chooseAssassination,
  merlinScores,
  questComment,
  dmReply,
  assassinSuggestion,
};
