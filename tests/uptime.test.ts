import { describe, expect, it } from "vitest";
import { uptime } from "@/lib/uptime";

const at = (iso: string, now: string) => uptime(iso, Date.parse(now));

describe("uptime", () => {
  it("counts seconds under a minute", () => {
    expect(at("2026-09-07T12:00:00Z", "2026-09-07T12:00:00Z")).toBe("0s");
    expect(at("2026-09-07T12:00:00Z", "2026-09-07T12:00:59Z")).toBe("59s");
  });

  it("changes unit at each boundary rather than a step early or late", () => {
    expect(at("2026-09-07T12:00:00Z", "2026-09-07T12:01:00Z")).toBe("1m");
    expect(at("2026-09-07T12:00:00Z", "2026-09-07T12:59:59Z")).toBe("59m");
    expect(at("2026-09-07T12:00:00Z", "2026-09-07T13:00:00Z")).toBe("1h");
    expect(at("2026-09-07T12:00:00Z", "2026-09-08T11:59:59Z")).toBe("23h");
    expect(at("2026-09-07T12:00:00Z", "2026-09-08T12:00:00Z")).toBe("1d");
  });

  it("truncates rather than rounds, so a server is never shown as older than it is", () => {
    expect(at("2026-09-07T12:00:00Z", "2026-09-07T12:01:59Z")).toBe("1m");
    expect(at("2026-09-07T12:00:00Z", "2026-09-14T23:59:59Z")).toBe("7d");
  });

  it("shows nothing for a start in the future, which is a skewed clock and not an age", () => {
    expect(at("2026-09-07T12:00:01Z", "2026-09-07T12:00:00Z")).toBeNull();
  });

  it("shows nothing for a timestamp it cannot read", () => {
    expect(uptime("")).toBeNull();
    expect(uptime("not a date")).toBeNull();
  });
});
