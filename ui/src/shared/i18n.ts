// Texts of the views in English and French, in the locale of the host (hostContext.locale), else of the browser.

const en = {
  loading: "Loading…",
  error: "Error",
  cancelled: "Cancelled",
  connectionFailed: "Connection to the host failed: {error}",
  toolFailed: "{name} failed",
  noData: "{name}: no data",
  toggleFullscreen: "Toggle fullscreen",
  earlier: "← Earlier",
  later: "Later →",
  back: "← Back",
  transfers: "{count} transfer(s)",
  track: "track {track}",

  "departures.title": "Departures",
  "departures.departures": "Departures",
  "departures.arrivals": "Arrivals",
  "departures.realTime": "real time",
  "departures.scheduled": "scheduled {time}",
  "departures.expected": "expected at {time}",
  "departures.delay": "+{minutes} min",
  "departures.cancelled": "cancelled",
  "departures.none": "No departure in this period.",
  "departures.backToBoard": "← Back to the board",

  "itinerary.title": "Journey planner",
  "itinerary.direct": "direct",
  "itinerary.none": "No itinerary found.",
  "itinerary.stops": "{count} stop(s)",
  "itinerary.options": "Options",
  "itinerary.start": "Start",
  "itinerary.end": "Destination",

  "options.leaveAt": "Leave at",
  "options.arriveBy": "Arrive by",
  "options.time": "date and time (empty: now)",
  "options.modes": "Transport",
  "options.mode.train": "Train",
  "options.mode.metro": "Metro",
  "options.mode.tram": "Tram",
  "options.mode.bus": "Bus, coach",
  "options.mode.ferry": "Ferry",
  "options.mode.other": "Other",
  "options.maxTransfers": "Max transfers",
  "options.anyTransfers": "Any",
  "options.maxWalk": "Max walk (min)",
  "options.maxWalkHint": "Walk (or bike ride) to the first stop and from the last stop",
  "options.walkingSpeed": "Walking speed",
  "options.walkingSpeed.SLOW": "Slow",
  "options.walkingSpeed.NORMAL": "Normal",
  "options.walkingSpeed.FAST": "Fast",
  "options.wheelchair": "Wheelchair accessible",
  "options.transferMargin": "Transfer margin",
  "options.transferMargin.NORMAL": "Normal",
  "options.transferMargin.COMFORTABLE": "Comfortable (+5 min)",
  "options.bike": "My bike",
  "options.bike.NONE": "No bike",
  "options.bike.TO_STATION": "To the station",
  "options.bike.ON_BOARD": "On board",
  "options.search": "Search",
  "options.noMode": "Select at least one transport mode.",

  "explorer.title": "Map explorer",
  "explorer.summary": "{stops} stops · {routes} routes",
  "explorer.stopsShown": "({count} stops shown)",
  "explorer.zoomFiltered": "minor routes hidden, zoom in",
  "explorer.routeStops": "{mode} · {count} stops",
  "explorer.loadingDepartures": "Loading departures…",
  "explorer.noDeparture": "No departure soon",
  "explorer.reachableFrom": "Reachable from {name}",
  "explorer.reachableSummary": "{count} stops within {max} min",
  "explorer.shown": "({count} shown)",

  "rentals.title": "Shared mobility",
  "rentals.summary":
    "{providers} provider(s) · {stations} station(s) or parking spot(s) · {vehicles} free-floating vehicle(s)",
  "rentals.closestShown": "(closest shown)",
  "rentals.none": "No shared mobility provider in this area.",
  "rentals.areaVehicles": "{count} in its whole area",
  "rentals.providerCounts": "{stations} st. · {vehicles} veh.",
  "rentals.vehicles": "{count} vehicle(s)",
  "rentals.docks": "{count} free dock(s)",
  "rentals.notRenting": "not renting",
  "rentals.unavailable": "unavailable",

  "mode.WALK": "Walk",
  "mode.BIKE": "Bike",
  "mode.RENTAL": "Rental",
  "mode.CAR": "Car",
  "mode.TRAM": "Tram",
  "mode.SUBWAY": "Metro",
  "mode.METRO": "Metro",
  "mode.FERRY": "Ferry",
  "mode.AIRPLANE": "Plane",
  "mode.BUS": "Bus",
  "mode.COACH": "Coach",
  "mode.RAIL": "Train",
  "mode.HIGHSPEED_RAIL": "High-speed",
  "mode.LONG_DISTANCE": "Intercity",
  "mode.NIGHT_RAIL": "Night train",
  "mode.REGIONAL_FAST_RAIL": "Regional",
  "mode.REGIONAL_RAIL": "Regional",
  "mode.SUBURBAN": "Suburban",
  "mode.FUNICULAR": "Funicular",
  "mode.AERIAL_LIFT": "Cable car",
  "mode.CABLE_CAR": "Cable car",

  "formFactor.BICYCLE": "bike",
  "formFactor.CARGO_BICYCLE": "cargo bike",
  "formFactor.CAR": "car",
  "formFactor.MOPED": "moped",
  "formFactor.SCOOTER_STANDING": "scooter",
  "formFactor.SCOOTER_SEATED": "seated scooter",
  "formFactor.OTHER": "other",

  "propulsion.HUMAN": "human",
  "propulsion.ELECTRIC_ASSIST": "electric assist",
  "propulsion.ELECTRIC": "electric",
  "propulsion.COMBUSTION": "combustion",
  "propulsion.COMBUSTION_DIESEL": "diesel",
  "propulsion.HYBRID": "hybrid",
  "propulsion.PLUG_IN_HYBRID": "plug-in hybrid",
  "propulsion.HYDROGEN_FUEL_CELL": "hydrogen",
};

export type MessageKey = keyof typeof en;

const fr: Record<MessageKey, string> = {
  loading: "Chargement…",
  error: "Erreur",
  cancelled: "Annulé",
  connectionFailed: "Échec de la connexion à l'hôte : {error}",
  toolFailed: "Échec de {name}",
  noData: "{name} : aucune donnée",
  toggleFullscreen: "Plein écran",
  earlier: "← Plus tôt",
  later: "Plus tard →",
  back: "← Retour",
  transfers: "{count} correspondance(s)",
  track: "voie {track}",

  "departures.title": "Départs",
  "departures.departures": "Départs",
  "departures.arrivals": "Arrivées",
  "departures.realTime": "temps réel",
  "departures.scheduled": "prévu à {time}",
  "departures.expected": "attendu à {time}",
  "departures.delay": "retard {minutes} min",
  "departures.cancelled": "supprimé",
  "departures.none": "Aucun départ sur cette période.",
  "departures.backToBoard": "← Retour au tableau",

  "itinerary.title": "Itinéraires",
  "itinerary.direct": "direct",
  "itinerary.none": "Aucun itinéraire trouvé.",
  "itinerary.stops": "{count} arrêt(s)",
  "itinerary.options": "Options",
  "itinerary.start": "Départ",
  "itinerary.end": "Arrivée",

  "options.leaveAt": "Partir à",
  "options.arriveBy": "Arriver avant",
  "options.time": "date et heure (vide : maintenant)",
  "options.modes": "Transports",
  "options.mode.train": "Train",
  "options.mode.metro": "Métro",
  "options.mode.tram": "Tram",
  "options.mode.bus": "Bus, car",
  "options.mode.ferry": "Ferry",
  "options.mode.other": "Autres",
  "options.maxTransfers": "Correspondances max",
  "options.anyTransfers": "Sans limite",
  "options.maxWalk": "Marche max (min)",
  "options.maxWalkHint": "Marche (ou vélo) jusqu'au premier arrêt et depuis le dernier",
  "options.walkingSpeed": "Vitesse de marche",
  "options.walkingSpeed.SLOW": "Lente",
  "options.walkingSpeed.NORMAL": "Normale",
  "options.walkingSpeed.FAST": "Rapide",
  "options.wheelchair": "Accessible en fauteuil roulant",
  "options.transferMargin": "Marge de correspondance",
  "options.transferMargin.NORMAL": "Normale",
  "options.transferMargin.COMFORTABLE": "Confortable (+5 min)",
  "options.bike": "Mon vélo",
  "options.bike.NONE": "Sans vélo",
  "options.bike.TO_STATION": "Jusqu'à la gare",
  "options.bike.ON_BOARD": "À bord",
  "options.search": "Rechercher",
  "options.noMode": "Sélectionnez au moins un mode de transport.",

  "explorer.title": "Carte",
  "explorer.summary": "{stops} arrêts · {routes} lignes",
  "explorer.stopsShown": "({count} arrêts affichés)",
  "explorer.zoomFiltered": "lignes secondaires masquées, zoomez",
  "explorer.routeStops": "{mode} · {count} arrêts",
  "explorer.loadingDepartures": "Chargement des départs…",
  "explorer.noDeparture": "Aucun départ prochainement",
  "explorer.reachableFrom": "Accessible depuis {name}",
  "explorer.reachableSummary": "{count} arrêts en moins de {max} min",
  "explorer.shown": "({count} affichés)",

  "rentals.title": "Mobilité partagée",
  "rentals.summary":
    "{providers} opérateur(s) · {stations} station(s) ou emplacement(s) · {vehicles} véhicule(s) en free-floating",
  "rentals.closestShown": "(les plus proches)",
  "rentals.none": "Aucun opérateur de mobilité partagée dans cette zone.",
  "rentals.areaVehicles": "{count} dans toute sa zone",
  "rentals.providerCounts": "{stations} st. · {vehicles} véh.",
  "rentals.vehicles": "{count} véhicule(s)",
  "rentals.docks": "{count} place(s) libre(s)",
  "rentals.notRenting": "location indisponible",
  "rentals.unavailable": "indisponible",

  "mode.WALK": "Marche",
  "mode.BIKE": "Vélo",
  "mode.RENTAL": "Location",
  "mode.CAR": "Voiture",
  "mode.TRAM": "Tram",
  "mode.SUBWAY": "Métro",
  "mode.METRO": "Métro",
  "mode.FERRY": "Ferry",
  "mode.AIRPLANE": "Avion",
  "mode.BUS": "Bus",
  "mode.COACH": "Car",
  "mode.RAIL": "Train",
  "mode.HIGHSPEED_RAIL": "Grande vitesse",
  "mode.LONG_DISTANCE": "Grandes lignes",
  "mode.NIGHT_RAIL": "Train de nuit",
  "mode.REGIONAL_FAST_RAIL": "Régional",
  "mode.REGIONAL_RAIL": "Régional",
  "mode.SUBURBAN": "Banlieue",
  "mode.FUNICULAR": "Funiculaire",
  "mode.AERIAL_LIFT": "Téléphérique",
  "mode.CABLE_CAR": "Téléphérique",

  "formFactor.BICYCLE": "vélo",
  "formFactor.CARGO_BICYCLE": "vélo cargo",
  "formFactor.CAR": "voiture",
  "formFactor.MOPED": "scooter",
  "formFactor.SCOOTER_STANDING": "trottinette",
  "formFactor.SCOOTER_SEATED": "trottinette assise",
  "formFactor.OTHER": "autre",

  "propulsion.HUMAN": "musculaire",
  "propulsion.ELECTRIC_ASSIST": "assistance électrique",
  "propulsion.ELECTRIC": "électrique",
  "propulsion.COMBUSTION": "thermique",
  "propulsion.COMBUSTION_DIESEL": "diesel",
  "propulsion.HYBRID": "hybride",
  "propulsion.PLUG_IN_HYBRID": "hybride rechargeable",
  "propulsion.HYDROGEN_FUEL_CELL": "hydrogène",
};

const MESSAGES = { en, fr };
type Language = keyof typeof MESSAGES;

let locale: string | undefined;

/** Locale of the host (hostContext.locale), or of the browser until the host gives one. */
export const hostLocale = (): string | undefined => locale ?? globalThis.navigator?.language;

/**
 * Sets the locale of the host. The static texts are translated again only when the language changes: they are
 * replaced by the data once a result is rendered (titles).
 */
export function setLocale(value: string | undefined): void {
  const previous = language();
  locale = value;
  if (language() !== previous) translateDocument();
}

export function language(): Language {
  return hostLocale()?.toLowerCase().startsWith("fr") ? "fr" : "en";
}

/** Text of [key], `{name}` placeholders replaced by [values] (not escaped). */
export function t(key: MessageKey, values: Record<string, string | number> = {}): string {
  return MESSAGES[language()][key].replaceAll(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

/** Text of [key] if it exists, else undefined (keys built from data: modes, form factors…). */
export function tOptional(key: string): string | undefined {
  return key in en ? t(key as MessageKey) : undefined;
}

/** Translates the static texts: `data-i18n` (text content) and `data-i18n-title` (title) attributes. */
export function translateDocument(): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = language();
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n as MessageKey);
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle as MessageKey);
  });
}
