export type BlogContentBlock =
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

export type BlogImage = {
  url: string;
  sourceUrl: string | null;
  creditName: string | null;
  creditUrl: string | null;
};

export type BlogPost = {
  slug: string;
  title: string;
  metaTitle: string | null;
  metaDescription: string | null;
  dek: string | null;
  content: BlogContentBlock[];
  tags: string[];
  image: BlogImage | null;
  publishedAt: string;
};
