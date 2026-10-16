import { describe, expect, it } from "vitest";
import { linePictogram, sncfBadge, train } from "./sncf";

describe("SNCF pictograms", () => {
  it("finds the brand and number of the trains", () => {
    expect(train("HIGHSPEED_RAIL", "TGV INOUI 6633", "SNCF VOYAGEURS", "6633")).toMatchObject({ brand: "TGV INOUI", number: "6633" });
    expect(train("HIGHSPEED_RAIL", "TGV INOUI 6633")?.logo).toContain("<svg");
    expect(train("HIGHSPEED_RAIL", "OUIGO 7805")?.logo).toContain("<svg");
    expect(train("HIGHSPEED_RAIL", "TGV Lyria 9277")?.logo).toContain("<svg");
    expect(train("HIGHSPEED_RAIL", "EST", "Eurostar", "9014")).toMatchObject({ brand: "EST", number: "9014" });
    expect(train("HIGHSPEED_RAIL", "EST", "Eurostar")?.logo).toContain("<svg");
    expect(train("HIGHSPEED_RAIL", "FR 6650", "TRENITALIA", "6650")).toMatchObject({ brand: "FR", number: "6650" });
    expect(train("HIGHSPEED_RAIL", "FR 6650", "TRENITALIA", "6650")?.logo).toContain("<svg");
    expect(train("HIGHSPEED_RAIL", "FRS 9281")?.logo).toBeUndefined();
    expect(train("LONG_DISTANCE", "IC 4202", "SNCF VOYAGEURS", "4202")?.logo).toContain("INTER");
    expect(train("LONG_DISTANCE", "IC 4202", "")?.logo).toContain("INTER");
    // the Intercity of other countries
    expect(train("LONG_DISTANCE", "IC 2084", "DB Fernverkehr AG")?.logo).toBeUndefined();
    expect(train("REGIONAL_RAIL", "TER", "SNCF VOYAGEURS", "891001")).toEqual({ brand: "TER", number: "891001", logo: undefined });
    // line codes of the SNCF regional trains
    expect(train("REGIONAL_RAIL", "C17", "SNCF VOYAGEURS", "847459")).toMatchObject({ brand: "TER", number: "847459" });
    expect(train("REGIONAL_RAIL", "C17", "NMBS/SNCB", "63")).toMatchObject({ brand: "C17" });
    // the number of the line name is not the train number
    expect(train("REGIONAL_RAIL", "K 14", "SNCF VOYAGEURS", "123")).toMatchObject({ brand: "K 14", number: "123" });
    expect(train("BUS", "TGV INOUI 6633")).toBeNull();
    expect(train("RAIL", null)).toBeNull();
  });

  it("finds the pictograms of the Île-de-France lines only", () => {
    expect(linePictogram("REGIONAL_RAIL", "A", "RER")).toContain("<svg");
    expect(linePictogram("REGIONAL_RAIL", "N", "Transilien")).toContain("<svg");
    expect(linePictogram("REGIONAL_RAIL", "V", "Transilien")).toContain("#9f9825");
    expect(linePictogram("TRAM", "T4", "SNCF")).toContain("<svg");
    // lines of other networks
    expect(linePictogram("SUBURBAN", "A", "DSB")).toBeNull();
    expect(linePictogram("TRAM", "T1", "TCL")).toBeNull();
    expect(linePictogram("SUBWAY", "A", "RATP")).toBeNull();
    expect(linePictogram("REGIONAL_RAIL", "T4", "SNCF")).toBeNull();
    expect(linePictogram("REGIONAL_RAIL", "Z", "RER")).toBeNull();
    expect(linePictogram("REGIONAL_RAIL", "A", undefined)).toBeNull();
  });

  it("makes badges with the pictograms", () => {
    expect(sncfBadge("HIGHSPEED_RAIL", "TGV INOUI 6633")).toMatch(/^<span class="badge sncf-train" title="TGV INOUI 6633"><svg.*<span>6633<\/span><\/span>$/s);
    expect(sncfBadge("HIGHSPEED_RAIL", "OUIGO")).not.toContain("<span>");
    expect(sncfBadge("TRAM", "T4", "SNCF")).toMatch(/^<span class="sncf-line tram" title="T4"><svg/);
    expect(sncfBadge("REGIONAL_RAIL", "B", "RER")).toMatch(/^<span class="sncf-line " title="B"><svg/);
    expect(sncfBadge("REGIONAL_RAIL", "TER 891001")).toBeNull();
  });
});
