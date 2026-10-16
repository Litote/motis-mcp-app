/**
 * Scenarios of the evaluation: user messages and what the agent should do. The examples of docs/MCP-SERVER.md (one per
 * tool rendered by a view) come first, then the behaviors the server supports (local times, options, ambiguous names).
 * The checks bear on the tool calls rather than on the answer, which depends on the timetable of the day.
 */
import { argLocalDateTime, text, tomorrow, type Scenario } from "./checks";

const TZ = "Europe/Paris";

/** Arguments of a stop or place given by name or id. */
const mentions = (field: string[], ...words: string[]) => (args: Record<string, unknown>) =>
  field.some((f) => words.every((w) => text(args[f]).includes(w)));

export const SCENARIOS: Scenario[] = [
  // examples of the documentation, one per tool rendered by a view
  {
    id: "departures",
    prompt: "Prochains départs à Lyon Part-Dieu",
    expect: {
      tools: ["departures"],
      args: [{ tool: "departures", label: "Part-Dieu", check: (a) => a.stopId !== undefined || mentions(["stop"], "part")(a) }],
    },
  },
  {
    id: "plan_journey",
    prompt: "Comment aller de Paris Gare de Lyon à Versailles ?",
    expect: {
      tools: ["plan_journey"],
      args: [
        { tool: "plan_journey", label: "from Gare de Lyon", check: mentions(["from"], "lyon") },
        { tool: "plan_journey", label: "to Versailles", check: mentions(["to"], "versailles") },
      ],
    },
  },
  {
    id: "explore_area",
    prompt: "Quelles lignes passent autour de la place Bellecour à Lyon ?",
    expect: {
      tools: ["explore_area"],
      args: [{ tool: "explore_area", label: "around Bellecour", check: (a) => mentions(["place"], "bellecour")(a) || a.minLat !== undefined }],
    },
  },
  {
    id: "route_details",
    prompt: "Montre-moi le tracé du tram T1 à Lyon",
    expect: { tools: ["explore_area", "route_details"] },
  },
  {
    id: "reachability",
    prompt: "Où peut-on aller en 30 minutes en transports depuis Lyon Part-Dieu ?",
    expect: {
      tools: ["reachability"],
      args: [
        { tool: "reachability", label: "30 min", check: (a) => a.maxTravelTimeMinutes === 30 || a.maxTravelTimeMinutes === undefined },
        { tool: "reachability", label: "from Part-Dieu", check: mentions(["place"], "part") },
      ],
    },
  },
  {
    id: "trip_details",
    prompt: "Quels arrêts dessert le prochain TGV de Lyon Part-Dieu vers Paris ?",
    expect: { tools: ["departures", "trip_details"] },
  },
  {
    id: "rentals",
    prompt: "Vélos en libre-service près de Châtelet, à Paris",
    expect: {
      tools: ["rentals"],
      args: [{ tool: "rentals", label: "around Châtelet", check: (a) => mentions(["place"], "ch")(a) || a.minLat !== undefined }],
    },
  },
  // tools without a view
  {
    id: "search_places",
    prompt: "Quel est l'identifiant de l'arrêt Lyon Part-Dieu dans MOTIS ?",
    expect: { tools: ["search_places"] },
  },
  {
    id: "server_info",
    prompt: "Quelle version de MOTIS utilise le serveur, et a-t-il du temps réel ?",
    expect: { tools: ["server_info"], answer: [{ label: "version", check: (a) => /\d+\.\d+/.test(a) }] },
  },
  // behaviors of the server
  {
    id: "local_time",
    prompt: "Comment aller de Lyon Part-Dieu à Grenoble demain à 8h ?",
    expect: {
      tools: ["plan_journey"],
      args: [
        {
          tool: "plan_journey",
          label: "tomorrow 08:00 in Lyon",
          check: (a) => argLocalDateTime(a.time, TZ) === `${tomorrow(TZ)}T08:00`,
        },
      ],
    },
  },
  {
    id: "arrive_by",
    prompt: "Je dois être à Lyon Perrache demain à 9h, en partant de Villeurbanne. Quand partir ?",
    expect: {
      tools: ["plan_journey"],
      args: [
        { tool: "plan_journey", label: "arriveBy", check: (a) => a.arriveBy === true },
        { tool: "plan_journey", label: "tomorrow 09:00", check: (a) => argLocalDateTime(a.time, TZ) === `${tomorrow(TZ)}T09:00` },
      ],
    },
  },
  {
    id: "wheelchair",
    prompt: "Itinéraire accessible en fauteuil roulant de Lyon Part-Dieu à la place Bellecour",
    expect: { tools: ["plan_journey"], args: [{ tool: "plan_journey", label: "wheelchair", check: (a) => a.wheelchair === true }] },
  },
  {
    id: "tram_only",
    prompt: "Quelles lignes de tram passent à moins de 2 km de la place Bellecour à Lyon ?",
    expect: {
      tools: ["explore_area"],
      args: [{ tool: "explore_area", label: "modes TRAM", check: (a) => text(a.modes).includes("tram") }],
    },
  },
  {
    // two Saint-Michel far apart (Paris, Bordeaux…): the server lists the candidates, the model retries or asks
    id: "ambiguous",
    prompt: "Prochains départs à Saint-Michel",
    expect: {
      tools: ["departures"],
      allowToolErrors: true,
      answer: [{ label: "asks which one or names the city", check: (a) => a.includes("?") || /paris|bordeaux|marseille/i.test(a) }],
    },
  },
  {
    id: "english",
    prompt: "Next departures at Bruxelles-Midi",
    expect: {
      tools: ["departures"],
      // answer in the language of the user, not of the place names
      answer: [{ label: "in English", check: (a) => /\b(the|next|departures?|train)\b/i.test(a) && !/\bprochains?\b/i.test(a) }],
    },
  },
];
