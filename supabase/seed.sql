-- Demo floor: 5 classrooms 6 m apart along x (y = 0), hallway running past them at y = 4.
-- The hallway is split into 3 zones: with phones on only one line (y = 0) the
-- localizer can't tell which side of the line a sound came from.
insert into rooms (id, name, x, y) values
  ('201', 'Room 201', 0, 0),
  ('202', 'Room 202', 6, 0),
  ('203', 'Room 203', 12, 0),
  ('204', 'Room 204', 18, 0),
  ('205', 'Room 205', 24, 0),
  ('hall-w', 'Hallway West', 3, 4),
  ('hall-c', 'Hallway Center', 12, 4),
  ('hall-e', 'Hallway East', 21, 4)
on conflict (id) do update set name = excluded.name, x = excluded.x, y = excluded.y;
