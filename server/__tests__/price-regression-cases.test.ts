/**
 * Loads and validates the price pipeline regression fixture.
 * Run unit/integration tests for specific case types in their respective PRs
 * (e.g. parse_only in PR1/PR2, aggregation_only in PR5, vin_lookup/oem_price with mocks).
 */
import * as fs from "fs";
import * as path from "path";

const FIXTURE_PATH = path.join(__dirname, "fixtures", "price-regression-cases.json");

type CaseType = "vin_lookup" | "oem_price" | "parse_only" | "aggregation_only";

interface RegressionCase {
  id: string;
  type: CaseType;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
  notes?: string;
}

interface Fixture {
  version: number;
  description: string;
  cases: RegressionCase[];
}

describe("price-regression-cases fixture", () => {
  let fixture: Fixture;

  beforeAll(() => {
    const raw = fs.readFileSync(FIXTURE_PATH, "utf-8");
    fixture = JSON.parse(raw) as Fixture;
  });

  it("has valid version and cases array", () => {
    expect(fixture.version).toBe(1);
    expect(Array.isArray(fixture.cases)).toBe(true);
    expect(fixture.cases.length).toBeGreaterThanOrEqual(10);
  });

  it("each case has id, type, input, expected", () => {
    const types: CaseType[] = ["vin_lookup", "oem_price", "parse_only", "aggregation_only"];
    for (const c of fixture.cases) {
      expect(c.id).toBeDefined();
      expect(typeof c.id).toBe("string");
      expect(types).toContain(c.type);
      expect(c.input).toBeDefined();
      expect(typeof c.input).toBe("object");
      expect(c.expected).toBeDefined();
      expect(typeof c.expected).toBe("object");
    }
  });

  it("has at least one case of each type used in the plan", () => {
    const types = new Set(fixture.cases.map((c) => c.type));
    expect(types.has("vin_lookup")).toBe(true);
    expect(types.has("oem_price")).toBe(true);
    expect(types.has("parse_only")).toBe(true);
    expect(types.has("aggregation_only")).toBe(true);
  });

  it("aggregation_only case expected structure", () => {
    const agg = fixture.cases.find((c) => c.type === "aggregation_only");
    expect(agg).toBeDefined();
    expect(agg!.input.prices).toBeDefined();
    expect(Array.isArray(agg!.input.prices)).toBe(true);
    expect(agg!.expected.afterOutlierRemoval ?? agg!.expected.maxPriceUnder).toBeDefined();
  });

  it("parse_only case expected structure", () => {
    const parse = fixture.cases.find((c) => c.type === "parse_only");
    expect(parse).toBeDefined();
    expect(parse!.input.content ?? parse!.input.text).toBeDefined();
  });
});
