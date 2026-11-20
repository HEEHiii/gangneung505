/* ============================================================
   settle.js — 누가 누구에게 얼마를 보내면 되는지

   화면 그리기와 완전히 분리된 순수 함수입니다.
   같은 입력에 늘 같은 출력이 나오고, 바깥을 전혀 건드리지 않습니다.
   그래서 tests/settle.check.mjs 가 수십 가지 경우를 바로 돌려볼 수
   있습니다 — 원래 505 코드는 DOM 에 용접돼 있어 테스트가 불가능했습니다.

   ★ 돈 계산에서 제일 중요한 것: 1원도 새지 않아야 합니다.

     총액 10,000원을 3명이 나누면 3333.33… 입니다. 이걸 반올림해서
     3333 씩 셋으로 하면 9,999원이 되어 1원이 사라집니다. 액수가
     커지거나 사람이 많아지면 이 오차가 눈에 띄고, "계산이 틀렸다"는
     인상을 줍니다. 돈 앱에서 그건 치명적입니다.

     그래서 소수점을 아예 쓰지 않습니다. 몫을 정수로 깔고 나머지
     원 단위를 앞사람부터 1원씩 더 떠안깁니다. 10,000원을 3명이면
     3334 / 3333 / 3333 이 되어 합이 정확히 10,000원입니다.

     나머지를 누가 떠안을지는 이름순으로 정합니다. 무작위로 하면
     새로고침할 때마다 숫자가 바뀌어 믿음이 안 갑니다.
   ============================================================ */

/* 1원 미만은 "같다"고 봅니다.
   정수로만 계산하므로 사실 0 이어야 맞지만, 혹시 소수가 섞여
   들어와도 0.4원 보내라는 소리를 하지 않도록 여유를 둡니다. */
const EPS = 1;

/**
 * @param {Array<{payer:string, amount:number}>} expenses  쓴 돈 목록
 * @param {number} people                                   여행 인원
 * @returns {{
 *   total:number, share:number, people:number,
 *   payers:Array<{name:string, paid:number, balance:number, ghost:boolean}>,
 *   transfers:Array<{from:string, to:string, amount:number}>,
 *   ghosts:number, ok:boolean
 * }}
 */
export function settle(expenses, people) {
  const N = Math.max(1, Math.floor(Number(people) || 1));

  /* ── 1. 사람별로 낸 돈 합치기 ──
     같은 이름은 같은 사람입니다. "민수"를 두 번 적어도 하나로 봅니다. */
  const paid = new Map();
  let total = 0;
  for (const e of expenses || []) {
    const name = String(e && e.payer != null ? e.payer : "").trim();
    const amount = Math.round(Number(e && e.amount) || 0);
    if (!name || !(amount > 0)) continue;      // 빈 이름·0원·음수는 무시
    paid.set(name, (paid.get(name) || 0) + amount);
    total += amount;
  }

  if (total === 0) {
    return { total: 0, share: 0, people: N, payers: [], transfers: [], ghosts: 0, ok: true };
  }

  /* ── 2. 아직 한 푼도 안 낸 사람 채우기 ──
     4명 여행인데 2명만 결제했다면, 나머지 2명도 각자 몫을 내야
     계산이 맞습니다. 이름을 모르니 자리만 만들어 둡니다. */
  const names = [...paid.keys()].sort((a, b) => a.localeCompare(b, "ko"));
  const ghosts = Math.max(0, N - names.length);
  const roster = [
    ...names.map((name) => ({ name, paid: paid.get(name), ghost: false })),
    ...Array.from({ length: ghosts }, (_, i) => ({
      name: `아직 안 낸 사람 ${i + 1}`, paid: 0, ghost: true,
    })),
  ];

  /* ── 3. 1인당 몫을 정수로 ──
     나머지 원은 앞사람부터 1원씩. 합이 정확히 total 이 됩니다. */
  const head = roster.length;                  // 실제로 나눠 가질 사람 수
  const base = Math.floor(total / head);
  const extra = total - base * head;           // 0 이상 head 미만
  const payers = roster.map((p, i) => {
    const owes = base + (i < extra ? 1 : 0);
    return { name: p.name, paid: p.paid, balance: p.paid - owes, ghost: p.ghost };
  });

  /* ── 4. 가장 많이 낸 사람 ← 가장 적게 낸 사람 순으로 맞춰나가기 ──
     큰 쪽부터 붙이면 주고받는 횟수가 적어집니다.
     (최소 횟수를 보장하진 않지만, 사람 수가 적어 충분히 좋습니다) */
  const owe = payers.filter((p) => p.balance < -EPS)
                    .map((p) => ({ name: p.name, left: -p.balance }))
                    .sort((a, b) => b.left - a.left || a.name.localeCompare(b.name, "ko"));
  const get = payers.filter((p) => p.balance > EPS)
                    .map((p) => ({ name: p.name, left: p.balance }))
                    .sort((a, b) => b.left - a.left || a.name.localeCompare(b.name, "ko"));

  const transfers = [];
  let i = 0, j = 0;
  while (i < owe.length && j < get.length) {
    const amount = Math.min(owe[i].left, get[j].left);
    if (amount > 0) transfers.push({ from: owe[i].name, to: get[j].name, amount });
    owe[i].left -= amount;
    get[j].left -= amount;
    if (owe[i].left <= EPS - 1) i++;
    if (get[j].left <= EPS - 1) j++;
  }

  /* ── 5. 검산 ──
     보낸 돈과 받은 돈이 안 맞으면 어딘가 잘못된 것입니다.
     조용히 틀린 숫자를 보여주느니 ok:false 로 알립니다. */
  const sent = new Map(), got = new Map();
  for (const t of transfers) {
    sent.set(t.from, (sent.get(t.from) || 0) + t.amount);
    got.set(t.to, (got.get(t.to) || 0) + t.amount);
  }
  const ok = payers.every((p) => {
    const net = (got.get(p.name) || 0) - (sent.get(p.name) || 0);
    return Math.abs(net - p.balance) <= EPS - 1;
  });

  return {
    total, share: base, people: N,
    payers, transfers, ghosts, ok,
  };
}
