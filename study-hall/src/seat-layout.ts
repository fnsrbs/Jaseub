import type { Seat } from "./domain";

// Reference: project room, six seats per row, paired desks with two aisles.
export const classroomSeats = (): Seat[] =>
  Array.from({ length: 72 }, (_, i) => ({
    id: i + 1,
    row: 12 - Math.floor(i / 6),
    col: [1, 2, 4, 5, 7, 8][5 - (i % 6)],
    enabled: true,
  }));
