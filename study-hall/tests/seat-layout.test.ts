import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import { classroomSeats } from "../src/seat-layout";

test("참고 시트 좌석: 72석·6열 12줄·역순·통로·배정 보존", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table seats(id int primary key,row int,col int,enabled boolean,unique(row,col));
      insert into seats select i,((i-1)/8)+1,((i-1)%8)+1,i<>1 from generate_series(1,72) i;
      create table students(id int,seat_id int references seats(id)); insert into students values(1,1);`);
    const dir = new URL("../supabase/migrations/", import.meta.url);
    const name = fs
      .readdirSync(dir)
      .find((n) => n.endsWith("_reference_seat_layout.sql"))!;
    await db.exec(fs.readFileSync(new URL(name, dir), "utf8"));
    const rows = (await db.query("select * from seats order by id")).rows;
    assert.deepEqual(
      rows,
      classroomSeats().map((s) => ({ ...s, enabled: s.id !== 1 })),
    );
    assert.equal(
      (await db.query("select seat_id from students")).rows[0].seat_id,
      1,
    );
    assert.deepEqual(
      classroomSeats()
        .filter((s) => s.row === 1)
        .map((s) => s.id)
        .reverse(),
      [72, 71, 70, 69, 68, 67],
    );
  } finally {
    await db.close();
  }
});
