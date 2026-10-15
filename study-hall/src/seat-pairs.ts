import {
  lottery,
  validateAssignments,
  type Seat,
  type Student,
} from "./domain";
type Assignment = { student_id: string; seat_id: number | null };
export const deskKey = (s: Seat) => `${s.row}:${Math.floor((s.col - 1) / 3)}`;
const known = (s: Student) => s.gender === "male" || s.gender === "female";
export function validateDeskPairs(
  students: Student[],
  seats: Seat[],
  pairs: Assignment[],
) {
  validateAssignments(students, seats, pairs);
  const desks = new Map<string, Student[]>();
  const changed = new Set(pairs.map((p) => p.student_id));
  for (const st of students) {
    const seatId = pairs.find((p) => p.student_id === st.id)?.seat_id;
    const seat = seats.find(
      (s) => s.id === (seatId === undefined ? st.seat_id : seatId),
    );
    if (!seat) continue;
    const group = desks.get(deskKey(seat)) || [];
    group.push(st);
    desks.set(deskKey(seat), group);
  }
  for (const group of desks.values()) {
    if (group.length < 2 || !group.some((s) => changed.has(s.id))) continue;
    if (
      group.some((s) => !known(s)) ||
      new Set(group.map((s) => s.gender)).size > 1
    )
      throw Error(
        "같은 성별끼리 짝이 되도록 좌석을 선택하세요. 미확인 성별과 고정 좌석도 확인하세요.",
      );
  }
  return pairs;
}
export function pairLottery(
  students: Student[],
  seats: Seat[],
  selected: string[],
  available: number[],
  fixed: string[],
  random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296,
) {
  // First validate capacity and preserve the existing fixed-seat behavior.
  lottery(students, seats, selected, available, fixed, random);
  const movable = students.filter(
    (s) => selected.includes(s.id) && !fixed.includes(s.id),
  );
  if (movable.some((s) => !known(s)))
    throw Error("대상 학생의 성별을 학생 관리에서 먼저 지정하세요.");
  const retained = students.filter(
    (s) => !selected.includes(s.id) || fixed.includes(s.id),
  );
  const reserved = new Set(retained.map((s) => s.seat_id));
  const groups = new Map<string, Seat[]>();
  for (const seat of seats.filter(
    (s) => s.enabled && available.includes(s.id) && !reserved.has(s.id),
  )) {
    const key = deskKey(seat);
    const group = groups.get(key) || [];
    group.push(seat);
    groups.set(key, group);
  }
  const shuffle = <T>(values: T[]) => {
    for (let i = values.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [values[i], values[j]] = [values[j], values[i]];
    }
    return values;
  };
  const desks = shuffle(
    [...groups].map(([key, slots]) => {
      const neighbors = retained.filter((st) =>
        seats.some((s) => s.id === st.seat_id && deskKey(s) === key),
      );
      const genders = new Set(neighbors.map((s) => s.gender));
      const forced = neighbors.length
        ? neighbors.every(known) && genders.size === 1
          ? neighbors[0].gender
          : "blocked"
        : null;
      return { slots: shuffle(slots), forced };
    }),
  );
  const boys = shuffle(movable.filter((s) => s.gender === "male")),
    girls = shuffle(movable.filter((s) => s.gender === "female"));
  const failed = new Set<string>();
  const solve = (i: number, m: number, f: number): Assignment[] | null => {
    if (!m && !f) return [];
    if (i === desks.length) return null;
    const key = `${i}:${m}:${f}`;
    if (failed.has(key)) return null;
    const { slots, forced } = desks[i];
    for (const gender of shuffle(["male", "female"])) {
      if (forced && forced !== gender) continue;
      const remaining = gender === "male" ? m : f;
      for (let n = Math.min(slots.length, remaining); n > 0; n--) {
        const rest = solve(
          i + 1,
          m - (gender === "male" ? n : 0),
          f - (gender === "female" ? n : 0),
        );
        if (rest) {
          const people = gender === "male" ? boys : girls;
          return [
            ...slots
              .slice(0, n)
              .map((s, j) => ({
                student_id: people[remaining - n + j].id,
                seat_id: s.id,
              })),
            ...rest,
          ];
        }
      }
    }
    const rest = solve(i + 1, m, f);
    if (rest) return rest;
    failed.add(key);
    return null;
  };
  const result = solve(0, boys.length, girls.length);
  if (!result)
    throw Error(
      "같은 성별 짝 배정이 불가능합니다. 사용할 좌석을 늘리거나 고정 좌석을 조정하세요.",
    );
  return validateDeskPairs(students, seats, [
    ...result,
    ...students
      .filter((s) => selected.includes(s.id) && fixed.includes(s.id))
      .map((s) => ({ student_id: s.id, seat_id: s.seat_id })),
  ]);
}
