import { describe, expect, it } from "bun:test";
import { Abyass } from "./abyass";

const slug = "DmyBErVlt";
console.log("Using slug:", slug);

describe("Abyass", async () => {
  const abyass = new Abyass(slug);
  await abyass.extract();
  it("Extract video object from slug", async () => {
    const videoObject = abyass.getVideoObject();
    expect(videoObject).toBeDefined();
  });
  it(
    "Download video from slug",
    async () => {
      const outputFile = "./download.mp4";
      await abyass.downloadVideo({ resolution: "720p", outputFile });

      const videoFile = Bun.file(outputFile);
      expect(videoFile.size).toBeGreaterThan(0);

      await videoFile.unlink(); // Clean up the downloaded file
    },
    { timeout: 120_000 }
  ); // Set timeout to 120 seconds
});
