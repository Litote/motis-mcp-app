// structuredContent of the tools (see server/.../dto/Dtos.kt).
import type { Bbox, Polyline } from "./map";

export interface PlaceDto {
  name: string;
  lat: number;
  lon: number;
  stopId?: string;
  modes?: string[];
  track?: string;
  arrival?: string;
  departure?: string;
  scheduledArrival?: string;
  scheduledDeparture?: string;
  cancelled?: boolean;
  tz?: string;
  /** City or region of a place asked by name. */
  area?: string;
}

export interface RouteDto {
  routeIdx: number;
  mode: string;
  names: string[];
  color?: string;
  textColor?: string;
  numStops: number;
}

export interface AreaResult {
  kind: "area" | "routeDetails";
  title: string;
  bbox: Bbox;
  zoom: number;
  stops: PlaceDto[];
  routes: RouteDto[];
  polylines: { polyline: Polyline; color?: string; routeIdx: number[] }[];
  totalStops: number;
  totalRoutes: number;
  zoomFiltered: boolean;
}

export interface ReachabilityResult {
  kind: "reachability";
  origin: PlaceDto;
  maxTravelTimeMinutes: number;
  places: { name: string; lat: number; lon: number; stopId?: string; durationMinutes?: number; transfers?: number }[];
  totalPlaces: number;
}

export interface StopTimeDto {
  time?: string;
  scheduledTime?: string;
  realTime: boolean;
  cancelled: boolean;
  mode: string;
  line: string;
  headsign: string;
  routeColor?: string;
  routeTextColor?: string;
  track?: string;
  agency: string;
  tripId: string;
}

export interface DeparturesResult {
  kind: "departures";
  stop: PlaceDto;
  arriveBy: boolean;
  stopTimes: StopTimeDto[];
  nextPageCursor?: string;
  previousPageCursor?: string;
}

export interface LegDto {
  mode: string;
  from: PlaceDto;
  to: PlaceDto;
  startTime: string;
  endTime: string;
  scheduledStartTime: string;
  scheduledEndTime: string;
  durationSeconds: number;
  realTime: boolean;
  distanceMeters?: number;
  line?: string;
  headsign?: string;
  routeColor?: string;
  routeTextColor?: string;
  agency?: string;
  tripId?: string;
  intermediateStops?: PlaceDto[];
  polyline: Polyline;
}

export interface ItineraryDto {
  startTime: string;
  endTime: string;
  durationSeconds: number;
  transfers: number;
  legs: LegDto[];
}

export interface TripResult {
  kind: "trip";
  tripId: string;
  itinerary: ItineraryDto;
}

export interface JourneyResult {
  kind: "journey";
  from: PlaceDto;
  to: PlaceDto;
  itineraries: ItineraryDto[];
  direct: ItineraryDto[];
  nextPageCursor?: string;
  previousPageCursor?: string;
}

export interface RentalProviderDto {
  id: string;
  name: string;
  groupId: string;
  operator?: string;
  url?: string;
  color?: string;
  formFactors: string[];
  /** Docking stations, or parking spots of free-floating operators. */
  stations: number;
  /** Free-floating vehicles. */
  vehicles: number;
  /** Vehicles reported for the whole service area of the provider, not located. */
  areaVehicles?: number;
}

export interface RentalsResult {
  kind: "rentals";
  title: string;
  bbox?: Bbox;
  providers: RentalProviderDto[];
  stations: {
    id: string;
    name: string;
    lat: number;
    lon: number;
    providerId: string;
    vehiclesAvailable: number;
    /** Free docks, when the provider reports them. */
    docksAvailable?: number;
    formFactors: string[];
    isRenting: boolean;
    distanceKm?: number;
  }[];
  vehicles: { id: string; lat: number; lon: number; providerId: string; formFactor: string; propulsion: string; available: boolean }[];
  totalStations: number;
  totalVehicles: number;
}
