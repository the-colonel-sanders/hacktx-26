export interface GunshotEvent {
  id: string;
  lat: number;
  lng: number;
  timestamp: string;
}

export interface NearbyBuilding {
  placeId: string;
  name: string;
  type?: string;
  address?: string;
  lat: number;
  lng: number;
  rating?: number;
  phone?: string;
  website?: string;
  thumbnail?: string;
  distanceM?: number;
}

export interface NearbyResult {
  eventId: string;
  fetchedAt: string;
  buildings: NearbyBuilding[];
}