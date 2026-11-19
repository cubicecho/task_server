import { expect, test } from "vitest";
import { type ArtifactLink, artifactActions, artifactLabel, isMarkdown } from "@/lib/run-artifacts";

const link = (over: Partial<ArtifactLink> = {}): ArtifactLink => ({
  uri: "ragdown://notes/plan.md",
  webUrl: "",
  serverId: "ragdown-1",
  title: "",
  name: "",
  ...over,
});

test("a private uri gets Preview and no Open", () => {
  expect(artifactActions(link())).toEqual({
    open: null,
    preview: true,
    previewRefused: undefined,
    copy: "ragdown://notes/plan.md",
  });
});

test("a private uri with a webUrl gets both, and Open goes to the webUrl", () => {
  const actions = artifactActions(link({ webUrl: "https://docs.example/plan" }));
  expect(actions).toMatchObject({ open: "https://docs.example/plan", preview: true });
  // Copy is the uri still: it is what the server resolves, and the webUrl is already a link.
  expect(actions.copy).toBe("ragdown://notes/plan.md");
});

test("an http(s) uri opens directly and is not previewed through its server", () => {
  for (const uri of ["https://example.com/report", "http://intranet/build/42"]) {
    expect(artifactActions(link({ uri }))).toMatchObject({ open: uri, preview: false });
  }
});

test("a webUrl wins over an http uri, since it is where the server says to look", () => {
  expect(
    artifactActions(link({ uri: "https://api.example/raw/1", webUrl: "https://example/view/1" }))
      .open,
  ).toBe("https://example/view/1");
});

test("a webUrl that is not a web address is never a link", () => {
  for (const webUrl of ["javascript:alert(1)", "file:///etc/passwd", "not a url"]) {
    expect(artifactActions(link({ webUrl })).open, webUrl).toBeNull();
  }
});

test("a preview whose server is gone is offered refused, with the reason", () => {
  const actions = artifactActions(link({ serverId: null }));
  expect(actions.preview).toBe(true);
  expect(actions.previewRefused).toMatch(/has been removed/);
});

test("a row is called by its title, then its name, then its uri", () => {
  expect(artifactLabel(link({ title: "The plan", name: "plan.md" }))).toBe("The plan");
  expect(artifactLabel(link({ name: "plan.md" }))).toBe("plan.md");
  expect(artifactLabel(link())).toBe("ragdown://notes/plan.md");
});

test("markdown is read off the read's type first, then the link's, ignoring parameters", () => {
  expect(isMarkdown("text/markdown; charset=utf-8", "")).toBe(true);
  expect(isMarkdown("", "text/markdown")).toBe(true);
  expect(isMarkdown("text/plain", "text/markdown")).toBe(false);
  expect(isMarkdown("", "")).toBe(false);
});
