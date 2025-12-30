import md5 from "md5";
import { dirname, join } from "path";
import { mkdir, readdir, rm, unlink } from "fs/promises";

import { existsSync, statSync } from "fs";

import { Semaphore } from "./utils/semaphore";
import { AesCtrHelper } from "./utils/aes-helper";

interface Config {
  resolution: string;
  outputFile?: string;
  connections?: number;
  headers?: Map<string, string>;
}

type Source = {
  sub: string;
  size: number;
  label: string;
  codec: string;
  res_id: number;
  status: boolean;
};

type Media = {
  mp4: {
    sources: Source[];
    domains: string[];
  };
};

type Payload = {
  slug: string;
  md5_id: number;
  user_id: number;
  media: Media | string;
  config: { poster: boolean; preview: boolean };
};

type Segment = {
  key: string;
  size: number;
  url: string;
  partNumber: number;
  range?: string;
  urlFristData?: string;
};

export class Abyass {
  public version = 1;
  private payload?: Payload;
  private static readonly SEGMENT_SIZE = 2097152;

  public readonly DEFAULT_CONCURRENT_DOWNLOAD_LIMIT = 4;

  public static readonly HYDRAX_CDN = "https://abysscdn.com";
  public static readonly VALID_METADATA =
    /JSON\.parse\((?:window\.|)atob\(["']([^"]+)["']\)\)/;

  constructor(private readonly videoId: string) {
    this.videoId = videoId;
  }

  private async encryptPath(path: string, keySeed: number | string) {
    const aes = new AesCtrHelper();
    await aes.expandKey(keySeed);
    const encrypted = await aes.encrypt(path);
    const binary =
      typeof encrypted === "string"
        ? encrypted
        : Array.from(encrypted)
            .map((byte) => String.fromCharCode(byte))
            .join("");
    return btoa(btoa(binary).replace(/=/g, "")).replace(/=/g, "");
  }

  public getPayload() {
    return this.payload;
  }

  public async createSegments(
    targetLabel?: "1080p" | "720p" | "360p" | string
  ): Promise<{ baseUrl: string; segments: Segment[]; source: Source }> {
    if (!this.payload) {
      throw new Error("Payload chưa được nạp, hãy gọi extract() trước.");
    }
    if (typeof this.payload.media === "string") {
      throw new Error("Payload media chưa được giải mã.");
    }

    const { domains } = this.payload.media.mp4;
    const sources = this.payload.media.mp4.sources.sort(
      (a, b) => b.size - a.size
    );

    const source = targetLabel
      ? sources.find(
          (item) => item.label === targetLabel && item.codec === "h264"
        ) ?? sources[0]
      : sources[0];
    if (!source) throw new Error("Video này không có nguồn media nào");

    let domain = domains.find((item) => item.includes(source.sub));
    if (!domain) {
      domain = domains[source.size % domains.length];
    }
    if (!domain) throw new Error("Video này không có domain nạp dữ liệu");

    const baseUrl =
      "https://" +
      domain +
      "/mp4/" +
      this.payload.md5_id +
      "/" +
      source.res_id +
      "/" +
      source.size +
      "/" +
      Abyass.SEGMENT_SIZE;

    const { pathname, origin, search } = new URL(baseUrl);
    const totalParts = Math.ceil(source.size / Abyass.SEGMENT_SIZE);
    const segments: Segment[] = [];

    for (let partNumber = 0; partNumber < totalParts; partNumber++) {
      let partSize = Abyass.SEGMENT_SIZE;
      if (partNumber + 1 === totalParts) {
        partSize = source.size % Abyass.SEGMENT_SIZE;
      }
      const key = md5(pathname) + "/" + partNumber;
      const encrypted = await this.encryptPath(
        pathname + "/" + partNumber + search,
        source.size
      );
      segments.push({
        key,
        partNumber,
        size: partSize,
        url: `${origin}/sora/${source.size}/${encrypted}`,
      });
    }

    return { baseUrl, segments, source };
  }

  private async mergeSegmentsIntoMp4File(
    segmentFolderPath: string,
    output: string
  ): Promise<void> {
    const files = await readdir(segmentFolderPath);
    const segmentFiles = files
      .filter((file) => file.startsWith("segment_"))
      .sort((a, b) => {
        const numA = parseInt(a.replace("segment_", ""));
        const numB = parseInt(b.replace("segment_", ""));
        return numA - numB;
      });

    const outputFile = Bun.file(output);
    const writer = outputFile.writer();

    for (const file of segmentFiles) {
      const segmentFile = Bun.file(join(segmentFolderPath, file));
      const data = await segmentFile.arrayBuffer();
      writer.write(data);
    }

    await writer.end();

    try {
      await rm(segmentFolderPath, { recursive: true, force: true });
    } catch (error) {
      console.error("Failed to delete folder: ", segmentFolderPath);
    }
  }

  private async initializeDownloadTempDir(
    config: Config,
    segments: Segment[],
    source: Source
  ): Promise<{ path: string; remainingSegments: number[] }> {
    const tempFolderName = `temp_${this.payload?.slug}_${source.label}`;
    const tempFolder = join(
      dirname(config.outputFile || process.cwd()),
      tempFolderName
    );
    const totalSegments = segments.length;

    if (existsSync(tempFolder) && statSync(tempFolder).isDirectory()) {
      const existingSegments: number[] = [];
      const files = await readdir(tempFolder);

      for (const file of files) {
        const filePath = join(tempFolder, file);
        if (statSync(filePath).isFile() && /segment_\d+/.test(file)) {
          const num = parseInt(file.replace("segment_", ""));
          const expectedSize = segments[num]?.size || Abyass.SEGMENT_SIZE;
          if (!isNaN(num) && statSync(filePath).size < expectedSize) {
            await unlink(filePath);
          } else if (!isNaN(num)) {
            existingSegments.push(num);
          }
        } else {
          const num = parseInt(file.replace("segment_", ""));
          if (!isNaN(num)) {
            existingSegments.push(num);
          }
        }
      }

      const allSegmentNames = Array.from(
        { length: totalSegments },
        (_, i) => i
      );
      const missingSegmentNames = allSegmentNames.filter(
        (num) => !existingSegments.includes(num)
      );

      return {
        path: tempFolder,
        remainingSegments: missingSegmentNames,
      };
    } else {
      await mkdir(tempFolder, { recursive: true });
    }

    return {
      path: tempFolder,
      remainingSegments: [],
    };
  }

  // Trong Config bạn không cần thay đổi, callback ta truyền ngoài
  // Thay đổi signature của downloadVideo:
  async downloadVideo(
    config: Config,
    onProgress?: (
      percent: number,
      downloadedBytes: number,
      totalBytes: number
    ) => void
  ): Promise<void> {
    const { segments, source } = await this.createSegments(config.resolution);

    const tempDir = await this.initializeDownloadTempDir(
      config,
      segments,
      source
    );

    const segmentsToDownload =
      tempDir.remainingSegments.length > 0
        ? segments
            .map((segment, index) => [index, segment] as const)
            .filter(([idx]) => tempDir.remainingSegments.includes(idx))
        : segments.map((segment, index) => [index, segment] as const);

    const headers = new Headers({
      referer: Abyass.HYDRAX_CDN + "/",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
    });
    if (config.headers) {
      for (const [key, value] of config.headers) {
        headers.set(key, value);
      }
    }

    const semaphore = new Semaphore(
      config.connections || this.DEFAULT_CONCURRENT_DOWNLOAD_LIMIT
    );

    let downloadedBytes = 0;

    const downloadSegmentTask = async (
      index: number,
      segment: Segment
    ): Promise<void> => {
      const release = await semaphore.acquire();
      try {
        const file = Bun.file(join(tempDir.path, `segment_${index}`));
        const writer = file.writer();

        const response = await fetch(segment.url, { headers });
        if (!response.ok) {
          throw new Error(`Failed to fetch segment: ${response.statusText}`);
        }
        if (!response.body) {
          throw new Error("Response body is null");
        }
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          writer.write(value);
          downloadedBytes += value.byteLength;
          if (onProgress) {
            const percent = Math.min(
              100,
              (downloadedBytes / source.size) * 100
            );
            onProgress(percent, downloadedBytes, source.size);
          }
        }

        await writer.end();
      } finally {
        release();
      }
    };

    // chạy download
    await Promise.all(
      segmentsToDownload.map(([idx, segment]) =>
        downloadSegmentTask(idx, segment)
      )
    );

    // sau khi xong merge file
    if (config.outputFile) {
      await this.mergeSegmentsIntoMp4File(tempDir.path, config.outputFile);
    }
  }

  public getHighestSource() {
    if (!this.payload) throw new Error("");
    if (typeof this.payload.media === "string") throw new Error("");

    return this.payload.media.mp4.sources.sort((a, b) => b.size - a.size)[0];
  }

  async extract() {
    const response = await fetch(`https://abysscdn.com/?v=${this.videoId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch video response: ${response.statusText}`);
    }
    let html = await response.text();
    html = html.replace(/\s\s+/, " ");
    const datas_string = html.match(/datas\s=\s"(.*?)";/)?.[1];

    if (!datas_string) throw new Error("");

    this.payload = JSON.parse(atob(datas_string));

    if (typeof this.payload?.media === "string") {
      const aes = new AesCtrHelper();
      const key = [
        this.payload.user_id,
        this.payload.slug,
        this.payload.md5_id,
      ].join(":");
      await aes.expandKey(key);
      const decrypted = await aes.decrypt(this.payload.media);
      const mediaText =
        typeof decrypted === "string"
          ? decrypted
          : new TextDecoder().decode(decrypted);
      this.payload.media = JSON.parse(mediaText);
    }
  }
}
