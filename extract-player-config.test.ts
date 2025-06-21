import { describe, expect, it } from "bun:test";

import { extractPlayerConfig } from "./utils/extract-player-config";
import sampleScript from "./source.txt" with { type: "text" };

describe("extractPlayerConfig", () => {
  it("should correctly extract the player configuration object from the setup call", () => {
    const config = extractPlayerConfig(sampleScript);
    // The sampleScript merges L and H, so expect both sets of properties
    expect(config.sources).toBeArray();
  });
});
