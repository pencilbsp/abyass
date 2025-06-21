export interface Source {
  size: number;
  type: string;
  label: string;
  codec: string;
  res_id: number;
  status: boolean;
}

export interface VideoObject {
  id: string;
  slug: string;
  width: string;
  md5_id: number;
  domain: string;
  height: string;
  user_id: string;
  preload: string;
  pipIcon: string;
  sources: Source[];
  image: string | null;
  ads: { pop: string[] };
  tracker: { url: string | null };
  fullscreenOrientationLock: string;
}

export class SimpleVideo {
  constructor(public slug: string, public md5_id: number, public label: string, public size: number) {
    this.size = size;
    this.slug = slug;
    this.label = label;
    this.md5_id = md5_id;
  }

  static fromVideoObject(video: VideoObject, resolution: string): SimpleVideo {
    const source = video.sources.find((source) => source.label === resolution);

    if (!source) {
      throw new Error(`Source with label ${resolution} not found`);
    }

    return new SimpleVideo(video.slug, video.md5_id, source.label, source.size);
  }
}
