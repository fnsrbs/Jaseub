-- Move through unused rows to preserve the immediate unique(row,col) constraint.
-- Seat IDs, assignments and enabled flags are preserved.
lock table public.seats in share row exclusive mode;
update public.seats set row = (select max(row) from public.seats) + id where id between 1 and 72;
update public.seats
set row = 12 - ((id - 1) / 6),
    col = (array[1,2,4,5,7,8])[6 - ((id - 1) % 6)]
where id between 1 and 72;
