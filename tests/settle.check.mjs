/* ============================================================
   정산 — 순수 함수 검사

   실행: node tests/settle.check.mjs

   ★ 돈 계산은 "대충 맞다"가 없습니다.
     1원이 사라지면 사용자는 계산 전체를 의심합니다. 그래서
     눈으로 보는 대신 수천 가지 경우를 만들어 합이 맞는지 잽니다.
   ============================================================ */

import { settle } from "../app/assets/settle.js";

let fails = 0;
const ok = (cond, what) => {
  if (cond) console.log("  OK    " + what);
  else { console.log("  실패  " + what); fails++; }
};
const eq = (got, want, what) =>
  ok(JSON.stringify(got) === JSON.stringify(want),
     `${what}  (받음 ${JSON.stringify(got)})`);

const sum = (a) => a.reduce((s, x) => s + x, 0);

/* ============================================================
   1. 기본
   ============================================================ */
console.log("── 기본");
{
  const r = settle([], 4);
  eq(r.total, 0, "지출이 없으면 총액 0");
  eq(r.transfers, [], "지출이 없으면 주고받을 것도 없음");
  ok(r.ok, "지출이 없어도 검산 통과");
}
{
  /* 2명이 똑같이 냈으면 주고받을 게 없습니다 */
  const r = settle([{ payer: "민수", amount: 5000 }, { payer: "지아", amount: 5000 }], 2);
  eq(r.total, 10000, "총액");
  eq(r.share, 5000, "1인당");
  eq(r.transfers, [], "똑같이 냈으면 정산할 게 없음");
}
{
  const r = settle([{ payer: "민수", amount: 10000 }], 2);
  eq(r.transfers.length, 1, "한 명만 냈으면 한 번 보내면 끝");
  eq(r.transfers[0].amount, 5000, "절반을 보냄");
  eq(r.transfers[0].to, "민수", "낸 사람이 받음");
}

/* ============================================================
   2. 1원도 새지 않는가  ← 이 파일의 핵심
   ============================================================ */
console.log("── 1원도 새지 않는가");
{
  /* 나누어떨어지지 않는 금액들 */
  for (const [total, n] of [[10000, 3], [10001, 3], [1, 7], [99999, 8], [777, 13]]) {
    const r = settle([{ payer: "민수", amount: total }], n);
    const owed = r.payers.map((p) => p.paid - p.balance);   // 각자 떠안은 몫
    eq(sum(owed), total, `${total}원 ÷ ${n}명 — 몫의 합이 총액과 같다`);
    eq(sum(r.payers.map((p) => p.balance)), 0, `${total}원 ÷ ${n}명 — 잔액의 합이 0`);
    const spread = Math.max(...owed) - Math.min(...owed);
    ok(spread <= 1, `${total}원 ÷ ${n}명 — 사람 간 차이가 1원 이내 (${spread}원)`);
  }
}
{
  /* 무작위 2,000판 — 손으로는 못 만들 조합까지 */
  let bad = 0, worstSpread = 0, maxTransfers = 0;
  const rand = (seed) => () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const rnd = rand(42);
  const NAMES = ["민수", "지아", "현우", "서연", "준호", "하늘", "도윤", "유진"];

  for (let t = 0; t < 2000; t++) {
    const n = 1 + Math.floor(rnd() * 8);
    const howMany = 1 + Math.floor(rnd() * 10);
    const expenses = Array.from({ length: howMany }, () => ({
      payer: NAMES[Math.floor(rnd() * NAMES.length)],
      amount: 1 + Math.floor(rnd() * 500000),
    }));
    const r = settle(expenses, n);

    const total = expenses.reduce((s, e) => s + e.amount, 0);
    const owed = r.payers.map((p) => p.paid - p.balance);
    const balancesZero = sum(r.payers.map((p) => p.balance)) === 0;
    const owedMatches = sum(owed) === total;
    const spread = Math.max(...owed) - Math.min(...owed);

    /* 주고받고 나면 모두의 잔액이 0 이 되어야 합니다 */
    const net = new Map(r.payers.map((p) => [p.name, p.balance]));
    for (const tr of r.transfers) {
      net.set(tr.from, net.get(tr.from) + tr.amount);
      net.set(tr.to, net.get(tr.to) - tr.amount);
    }
    const allSettled = [...net.values()].every((v) => v === 0);
    const noSelf = r.transfers.every((tr) => tr.from !== tr.to);
    const positive = r.transfers.every((tr) => tr.amount > 0 && Number.isInteger(tr.amount));

    if (!(balancesZero && owedMatches && spread <= 1 && allSettled && r.ok && noSelf && positive)) bad++;
    worstSpread = Math.max(worstSpread, spread);
    maxTransfers = Math.max(maxTransfers, r.transfers.length);
  }
  eq(bad, 0, "무작위 2,000판 전부 합이 맞고 정산 후 잔액 0");
  eq(worstSpread, 1, "사람 간 몫 차이는 끝까지 1원 이내");
  ok(maxTransfers <= 8, `주고받는 횟수가 과하지 않다 (최대 ${maxTransfers}번)`);
}

/* ============================================================
   3. 현실에서 실제로 들어오는 입력들
   ============================================================ */
console.log("── 이상한 입력");
{
  const r = settle([{ payer: "민수", amount: 3000 }, { payer: " 민수 ", amount: 2000 }], 2);
  eq(r.payers.filter((p) => !p.ghost).length, 1, "앞뒤 공백만 다르면 같은 사람");
  eq(r.payers[0].paid, 5000, "같은 사람 금액은 합쳐짐");
}
{
  const r = settle([
    { payer: "민수", amount: 1000 }, { payer: "", amount: 9999 },
    { payer: "지아", amount: 0 }, { payer: "현우", amount: -500 },
    { payer: "서연", amount: "2000" },
  ], 3);
  eq(r.total, 3000, "빈 이름·0원·음수는 빼고, 숫자 문자열은 받아줌");
}
{
  const r = settle([{ payer: "민수", amount: 1000 }], 0);
  eq(r.people, 1, "인원 0 이면 1명으로 (0 으로 나누기 방지)");
}
{
  /* 인원보다 결제자가 많은 경우 — 친구가 더 붙었을 때 실제로 생깁니다 */
  const r = settle([
    { payer: "민수", amount: 3000 }, { payer: "지아", amount: 3000 },
    { payer: "현우", amount: 3000 },
  ], 2);
  eq(r.ghosts, 0, "결제자가 인원보다 많으면 유령을 안 만듦");
  eq(sum(r.payers.map((p) => p.balance)), 0, "그래도 잔액 합은 0");
}
{
  const r = settle([{ payer: "민수", amount: 100000000 }], 8);
  eq(r.share, 12500000, "큰 금액도 정확");
  ok(r.ok, "큰 금액 검산 통과");
}

/* ============================================================
   4. 같은 입력이면 같은 결과 (새로고침해도 숫자가 안 바뀜)
   ============================================================ */
console.log("── 결과가 매번 같은가");
{
  const expenses = [
    { payer: "지아", amount: 12000 }, { payer: "민수", amount: 7000 },
    { payer: "현우", amount: 31000 },
  ];
  const a = JSON.stringify(settle(expenses, 5));
  const b = JSON.stringify(settle([...expenses].reverse(), 5));
  eq(a === b, true, "지출 순서가 바뀌어도 결과가 같다");

  const c = JSON.stringify(settle(expenses, 5));
  eq(a === c, true, "두 번 불러도 결과가 같다");
}

/* ============================================================
   5. 유령 표시
   ============================================================ */
console.log("── 아직 안 낸 사람");
{
  const r = settle([{ payer: "민수", amount: 40000 }], 4);
  eq(r.ghosts, 3, "4명 중 1명만 결제 → 유령 3명");
  eq(r.payers.filter((p) => p.ghost).length, 3, "유령이 명단에 들어감");
  eq(r.transfers.length, 3, "세 명이 각각 보냄");
  ok(r.transfers.every((t) => t.amount === 10000), "각자 1인분씩");
}

console.log("");
if (fails === 0) console.log("전부 통과");
else { console.log(`실패 ${fails}건`); process.exit(1); }
