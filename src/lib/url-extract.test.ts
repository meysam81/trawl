import { describe, expect, test } from "bun:test";
import { parseAndNormalize, sortUrls } from "./url-extract.ts";
import type { UrlRecord } from "./schemas.ts";

describe("parseAndNormalize", () => {
  const baseUrl = "https://example.com/page";

  test("returns null for non-http schemes", () => {
    expect(parseAndNormalize("mailto:a@b.com", baseUrl)).toBeNull();
    expect(parseAndNormalize("tel:123", baseUrl)).toBeNull();
    // eslint-disable-next-line no-script-url
    expect(parseAndNormalize("javascript:void(0)", baseUrl)).toBeNull();
    expect(
      parseAndNormalize("data:text/plain;base64,ZA==", baseUrl),
    ).toBeNull();
    expect(parseAndNormalize("ftp://x.com", baseUrl)).toBeNull();
  });

  test("returns null for empty or whitespace input", () => {
    expect(parseAndNormalize("", baseUrl)).toBeNull();
    expect(parseAndNormalize("   ", baseUrl)).toBeNull();
  });

  test("returns null for genuinely unparseable input", () => {
    // No baseUrl + no scheme → URL constructor throws.
    expect(parseAndNormalize("https://", "https://x.com")).toBeNull();
  });

  test("resolves relative URLs against baseUrl", () => {
    const result = parseAndNormalize("/foo?q=1", baseUrl);
    expect(result?.url).toBe("https://example.com/foo?q=1");
    expect(result?.domain).toBe("example.com");
  });

  test("preserves query params verbatim", () => {
    const result = parseAndNormalize(
      "https://x.com/?utm_source=foo&utm_medium=bar",
      baseUrl,
    );
    expect(result?.url).toBe("https://x.com/?utm_source=foo&utm_medium=bar");
  });

  test("lowercases domain", () => {
    const result = parseAndNormalize("https://EXAMPLE.com/Path", baseUrl);
    expect(result?.domain).toBe("example.com");
  });

  test("accepts http and https only", () => {
    expect(parseAndNormalize("http://x.com", baseUrl)?.url).toBe(
      "http://x.com/",
    );
    expect(parseAndNormalize("https://x.com", baseUrl)?.url).toBe(
      "https://x.com/",
    );
  });
});

describe("sortUrls", () => {
  const records: UrlRecord[] = [
    { url: "https://b.com/", domain: "b.com", firstIndex: 2, count: 1 },
    { url: "https://A.com/", domain: "a.com", firstIndex: 5, count: 1 },
    { url: "https://c.com/", domain: "c.com", firstIndex: 1, count: 1 },
  ];

  test("alpha sort is case-insensitive", () => {
    const sorted = sortUrls(records, "alpha");
    expect(sorted.map((r) => r.url)).toEqual([
      "https://A.com/",
      "https://b.com/",
      "https://c.com/",
    ]);
  });

  test("pageOrder sort uses firstIndex ascending", () => {
    const sorted = sortUrls(records, "pageOrder");
    expect(sorted.map((r) => r.firstIndex)).toEqual([1, 2, 5]);
  });

  test("does not mutate input", () => {
    const before = records.map((r) => r.url);
    sortUrls(records, "alpha");
    expect(records.map((r) => r.url)).toEqual(before);
  });
});
