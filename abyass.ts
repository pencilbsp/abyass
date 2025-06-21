import { JSDOM } from "jsdom";
import { dirname, join } from "path";
import { Deobfuscator } from "synchrony";
import { readdir, mkdir, rm, unlink } from "fs/promises";

import { generateKey } from "./utils/utils";
import { existsSync, statSync } from "fs";

import { Semaphore } from "./utils/semaphore";
import { CryptoHelper } from "./utils/crypto-helper";
import { SimpleVideo, type VideoObject } from "./utils/video";
import { extractPlayerConfig } from "./utils/extract-player-config";

interface Config {
  resolution: string;
  outputFile?: string;
  connections?: number;
  headers?: Map<string, string>;
}

export class Abyass {
  public version = 1;
  private videoObject!: VideoObject;
  private cryptoHelper: CryptoHelper;
  private static readonly SEGMENT_SIZE = 2097152;

  public readonly DEFAULT_CONCURRENT_DOWNLOAD_LIMIT = 4;

  public static readonly HYDRAX_CDN = "https://abysscdn.com";
  public static readonly VALID_METADATA = /JSON\.parse\((?:window\.|)atob\(["']([^"]+)["']\)\)/;

  constructor(private readonly videoId: string) {
    this.videoId = videoId;
    this.cryptoHelper = new CryptoHelper();
  }

  private getSegmentUrl() {
    return `https://${this.videoObject.domain}/${this.videoObject.id}`;
  }

  private generateRanges(size: number, step: number = Abyass.SEGMENT_SIZE): Array<[number, number]> {
    const ranges: Array<[number, number]> = [];

    // if the size is less than or equal to step size return a single range
    if (size <= step) {
      ranges.push([0, size - 1]);
      return ranges;
    }

    let start = 0;
    while (start < size) {
      const end = Math.min(start + step - 1, size - 1); // trừ 1 để tránh overlap
      ranges.push([start, end]);
      start = end + 1; // bắt đầu từ vị trí tiếp theo
    }

    return ranges;
  }

  private async generateSegmentsBody(simpleVideo: SimpleVideo): Promise<Record<number, string>> {
    const fragmentList: Record<number, string> = {};
    await this.cryptoHelper.expandKey(generateKey(simpleVideo.slug));

    const ranges = this.generateRanges(simpleVideo.size);

    for (const [index, range] of ranges.entries()) {
      const body = {
        ...simpleVideo,
        range: { start: range[0], end: range[1] },
      };
      const encryptedBody = await this.cryptoHelper.encrypt(JSON.stringify(body));
      fragmentList[index] = encryptedBody;
    }

    return fragmentList;
  }

  private async *requestSegment(url: string, body: string, chunkSize: number = 65536) {
    const response = await fetch(url, {
      method: "POST",
      body: JSON.stringify({ hash: body }),
      headers: {
        "content-type": "application/json",
        origin: Abyass.HYDRAX_CDN,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to request segment: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error("Response body is null");
    }

    const reader = response.body.getReader();

    let buffer = new Uint8Array(0); // Buffer tạm thời để lưu các chunk

    // Đọc các chunk từ stream và yield mỗi chunk có kích thước tùy chỉnh
    while (true) {
      const { done, value } = await reader.read();

      if (done) break; // Khi không còn dữ liệu nữa, kết thúc

      // Nối phần dữ liệu mới vào buffer
      buffer = new Uint8Array([...buffer, ...value]);

      // Nếu buffer đủ kích thước chunkSize, yield ra chunk đó
      while (buffer.length >= chunkSize) {
        const chunk = buffer.slice(0, chunkSize);
        buffer = buffer.slice(chunkSize); // Cắt buffer còn lại
        yield chunk;
      }
    }

    // Yield phần còn lại của buffer nếu có
    if (buffer.length > 0) {
      yield buffer;
    }
  }

  private async mergeSegmentsIntoMp4File(segmentFolderPath: string, output: string): Promise<void> {
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
    simpleVideo: SimpleVideo,
    totalSegments: number
  ): Promise<{ path: string; remainingSegments: number[] }> {
    const tempFolderName = `temp_${simpleVideo.slug}_${simpleVideo.label}`;
    const tempFolder = join(dirname(config.outputFile || process.cwd()), tempFolderName);

    if (existsSync(tempFolder) && statSync(tempFolder).isDirectory()) {
      const existingSegments: number[] = [];
      const files = await readdir(tempFolder);

      for (const file of files) {
        const filePath = join(tempFolder, file);
        if (statSync(filePath).isFile() && /segment_\d+/.test(file) && statSync(filePath).size < Abyass.SEGMENT_SIZE) {
          await unlink(filePath);
        } else {
          const num = parseInt(file.replace("segment_", ""));
          if (!isNaN(num)) {
            existingSegments.push(num);
          }
        }
      }

      const allSegmentNames = Array.from({ length: totalSegments }, (_, i) => i);
      const missingSegmentNames = allSegmentNames.filter((num) => !existingSegments.includes(num));

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
    onProgress?: (percent: number, downloadedBytes: number, totalBytes: number) => void
  ): Promise<void> {
    const simpleVideo = SimpleVideo.fromVideoObject(this.videoObject, config.resolution);
    const totalBytes = simpleVideo.size; // tổng số bytes của video

    const segmentBodies = await this.generateSegmentsBody(simpleVideo);
    const segmentUrl = this.getSegmentUrl();
    await this.cryptoHelper.expandKey(generateKey(simpleVideo.size));

    const tempDir = await this.initializeDownloadTempDir(config, simpleVideo, Object.keys(segmentBodies).length);

    const segmentsToDownload =
      tempDir.remainingSegments.length > 0
        ? Object.entries(segmentBodies).filter(([idx]) => tempDir.remainingSegments.includes(Number(idx)))
        : Object.entries(segmentBodies);

    const semaphore = new Semaphore(config.connections || this.DEFAULT_CONCURRENT_DOWNLOAD_LIMIT);

    let downloadedBytes = 0;

    const downloadSegmentTask = async (index: number, body: string): Promise<void> => {
      const release = await semaphore.acquire();
      try {
        let isHeader = true;
        const file = Bun.file(join(tempDir.path, `segment_${index}`));
        const writer = file.writer();

        for await (const chunk of this.requestSegment(segmentUrl, body)) {
          const data = isHeader
            ? await (async () => {
                isHeader = false;
                return this.cryptoHelper.decrypt(chunk);
              })()
            : chunk;

          writer.write(data);
          // cập nhật progress
          downloadedBytes += typeof data === "string" ? data.length : data.byteLength;
          if (onProgress) {
            const percent = Math.min(100, (downloadedBytes / totalBytes) * 100);
            onProgress(percent, downloadedBytes, totalBytes);
          }
        }

        await writer.end();
      } finally {
        release();
      }
    };

    // chạy download
    await Promise.all(segmentsToDownload.map(([idx, body]) => downloadSegmentTask(Number(idx), body)));

    // sau khi xong merge file
    if (config.outputFile) {
      await this.mergeSegmentsIntoMp4File(tempDir.path, config.outputFile);
    }
  }

  public getVideoObject(): VideoObject {
    return JSON.parse(JSON.stringify(this.videoObject));
  }

  public getHighestSource() {
    const res_id = Math.max(...this.videoObject.sources.map((source) => source.res_id));
    const source = this.videoObject.sources.find((source) => source.res_id === res_id);
    return source;
  }

  async extract() {
    const response = await fetch(`https://abysscdn.com/?v=${this.videoId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch video response: ${response.statusText}`);
    }
    const html = await response.text();

    const {
      window: { document },
    } = new JSDOM(html);

    const scripts = Array.from(document.querySelectorAll("script"));
    const maxLength = Math.max(...scripts.map(({ textContent }) => (textContent ? textContent.length : 0)));

    const script = scripts.find(({ textContent }) => (textContent ? textContent.length === maxLength : false));

    if (!script || !script.textContent) {
      throw new Error("No suitable script found to extract encrypted string");
    }

    const deobfuscator = new Deobfuscator();
    const content = await deobfuscator.deobfuscateSource(script.textContent);

    this.videoObject = extractPlayerConfig(content);
  }
}
