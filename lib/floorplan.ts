// Floor plan in meters. Keep ROOMS in sync with supabase/seed.sql.

export type Room = { id: string; name: string; x: number; y: number };

export const FLOOR_BOUNDS = { minX: -3, maxX: 30, minY: -4, maxY: 8 };
export type Bounds = typeof FLOOR_BOUNDS;

export const ROOMS: Room[] = [
  { id: "201", name: "Room 201", x: 0, y: 0 },
  { id: "202", name: "Room 202", x: 6, y: 0 },
  { id: "203", name: "Room 203", x: 12, y: 0 },
  { id: "204", name: "Room 204", x: 18, y: 0 },
  { id: "205", name: "Room 205", x: 24, y: 0 },
  { id: "hall-w", name: "Hallway West", x: 3, y: 4 },
  { id: "hall-c", name: "Hallway Center", x: 12, y: 4 },
  { id: "hall-e", name: "Hallway East", x: 21, y: 4 },
];

export function nearestRoom<R extends { x: number; y: number }>(x: number, y: number, rooms: R[]): R | null {
  let best: R | null = null;
  let bestD = Infinity;
  for (const r of rooms) {
    const d = Math.hypot(r.x - x, r.y - y);
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}

export function inBounds(x: number, y: number): boolean {
  return x >= FLOOR_BOUNDS.minX && x <= FLOOR_BOUNDS.maxX && y >= FLOOR_BOUNDS.minY && y <= FLOOR_BOUNDS.maxY;
}

/** A phone's position: its exact x/y if it set one, else its room center. */
export function positionOf(
  row: { x?: number | null; y?: number | null; room_id: string | null },
  roomById: Map<string, { x: number; y: number }>,
): { x: number; y: number } | null {
  if (row.x != null && row.y != null) return { x: row.x, y: row.y };
  const room = row.room_id ? roomById.get(row.room_id) : undefined;
  return room ? { x: room.x, y: room.y } : null;
}
