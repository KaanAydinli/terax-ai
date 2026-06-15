import { describe, expect, it } from "vitest";
import { logicalDropPoint } from "./dropPoint";

describe("logicalDropPoint", () => {
  it("keeps logical viewport coordinates unchanged", () => {
    expect(logicalDropPoint(120, 80, 800, 600, 2)).toEqual({ x: 120, y: 80 });
  });

  it("scales physical coordinates back to logical viewport coordinates", () => {
    expect(logicalDropPoint(1600, 1200, 800, 600, 2)).toEqual({
      x: 800,
      y: 600,
    });
  });
});
