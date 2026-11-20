// Boards of the railway stations of some countries, like the ones at their stations: the other stops get the generic
// board. A country is added with a CountryBoard (see row.ts) in COUNTRY_BOARDS.
import type { DeparturesResult } from "../shared/types";
import { adifBoard } from "./adif";
import { dbBoard } from "./db";
import { nationalRailBoard } from "./nationalRail";
import { nsBoard } from "./ns";
import { rfiBoard } from "./rfi";
import type { CountryBoard } from "./row";
import { sbbBoard } from "./sbb";
import { sncbBoard } from "./sncb";
import { sncfBoard } from "./sncf";

export { theoreticalMark, type BoardRow, type CountryBoard } from "./row";

/** France, Germany, Italy, Spain, Belgium, the United Kingdom, Switzerland and the Netherlands. */
const COUNTRY_BOARDS: CountryBoard[] = [sncfBoard, dbBoard, rfiBoard, adifBoard, sncbBoard, nationalRailBoard, sbbBoard, nsBoard];

/** Board of the station of [data] like the ones of its country, if any. */
export const countryBoard = (data: DeparturesResult): CountryBoard | undefined => COUNTRY_BOARDS.find((board) => board.matches(data));

/** Style of the boards of the countries. */
export const countryBoardsCss = COUNTRY_BOARDS.map((board) => board.css).join("");
