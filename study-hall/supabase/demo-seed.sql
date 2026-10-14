-- OPTIONAL: fictional data in a dedicated TEST project only. Not applied automatically.
insert into public.students(name,number,seat_id)
select '가상학생 '||lpad(n::text,2,'0'),'D'||lpad(n::text,3,'0'),n from generate_series(1,72)n;
-- Issue each student's random code through the teacher UI. No known production credentials seeded.
