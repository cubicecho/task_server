import { createServerCard, type ServerCard } from "@cubicecho/mcp-discovery";
import { type LanServer, type ServerWatchHandlers, toMcpHost } from "@cubicecho/mcp-discovery/mdns";
import { describe, expect, it, vi } from "vitest";
import { createLanServers, freeSlug } from "../server/discovery/lan-servers.ts";

/** A server another host announces, as `watchServers` reports it. */
function lanServer(
  instance: string,
  card: Partial<ServerCard> & { name: string },
  url: string,
  requiredHeaders: string[] = [],
): LanServer {
  const full = createServerCard({
    version: "1.0.0",
    description: "Something useful.",
    remotes: [
      {
        type: "streamable-http",
        url,
        headers: requiredHeaders.map((name) => ({ name, isRequired: true, isSecret: true })),
      },
    ],
    ...card,
  });
  const host = toMcpHost({ name: instance, host: "nas.local", port: 3000, addresses: [], txt: {} });
  return {
    key: `${instance}/${full.name}`,
    host,
    card: full,
    cardUrl: null,
    connection: { url, requiredHeaders },
  };
}

type Row = { slug: string; transport: "stdio" | "http"; url: string };

/** A LAN watch over a fake network, with the setting and the rows under the test's control. */
function setup() {
  const state = { wanted: true, rows: [] as Row[] };
  let handlers: ServerWatchHandlers | undefined;
  const stop = vi.fn(async () => undefined);
  const watch = vi.fn(async (given: ServerWatchHandlers) => {
    handlers = given;
    return { stop };
  });
  const lan = createLanServers({
    isWanted: () => state.wanted,
    ownInstanceName: "Task Server on box",
    servers: async () => state.rows,
    log: () => undefined,
    watch,
  });
  const announce = (server: LanServer) => handlers?.onUp(server);
  const leave = (server: LanServer) => handlers?.onDown?.(server);
  return { lan, state, watch, stop, announce, leave };
}

const skills = lanServer(
  "MCP Skills on nas",
  { name: "io.github.cubicecho.mcp-skills.nas/skills", title: "Skills" },
  "http://192.168.1.20:3000/mcp",
  ["Authorization"],
);

describe("createLanServers", () => {
  it("offers a found server with a free slug and the headers it needs", async () => {
    const { lan, announce } = setup();
    await lan.sync();
    announce(skills);
    expect(await lan.list()).toEqual([
      {
        key: skills.key,
        cardName: "io.github.cubicecho.mcp-skills.nas/skills",
        title: "Skills",
        description: "Something useful.",
        version: "1.0.0",
        host: "MCP Skills on nas",
        url: "http://192.168.1.20:3000/mcp",
        requiredHeaders: ["Authorization"],
        suggestedSlug: "skills",
        addedAs: null,
      },
    ]);
  });

  it("never offers itself, nor a card it could not connect to as it stands", async () => {
    const { lan, announce } = setup();
    await lan.sync();
    announce(
      lanServer(
        "Task Server on box",
        { name: "io.github.cubicecho.task-server.box/tasks" },
        "http://10.0.0.1/mcp",
      ),
    );
    announce({
      ...lanServer("Templated on nas", { name: "com.example/templated" }, "http://10.0.0.2/{x}"),
      connection: null,
    });
    expect(await lan.list()).toEqual([]);
  });

  it("offers a router's aggregate like any other server", async () => {
    const { lan, announce } = setup();
    await lan.sync();
    announce(
      lanServer(
        "MCP Router on nas",
        {
          name: "io.github.cubicecho.mcp-router.nas/aggregate",
          _meta: { "io.github.cubicecho.mcp-router/role": "aggregate" },
        },
        "http://192.168.1.20:3100/mcp",
      ),
    );
    expect(await lan.list()).toMatchObject([{ suggestedSlug: "aggregate" }]);
  });

  it("says which row already points at a found server, however its URL was written", async () => {
    const { lan, state, announce } = setup();
    await lan.sync();
    announce(skills);
    state.rows = [{ slug: "my-skills", transport: "http", url: "http://192.168.1.20:3000/mcp/" }];
    expect((await lan.list())[0]).toMatchObject({ addedAs: "my-skills", suggestedSlug: "skills" });
  });

  it("suggests a slug no row has taken", async () => {
    const { lan, state, announce } = setup();
    await lan.sync();
    announce(skills);
    state.rows = [
      { slug: "skills", transport: "stdio", url: "" },
      { slug: "skills-2", transport: "http", url: "http://other/mcp" },
    ];
    expect((await lan.list())[0]?.suggestedSlug).toBe("skills-3");
  });

  it("forgets a server whose host left", async () => {
    const { lan, announce, leave } = setup();
    await lan.sync();
    announce(skills);
    leave(skills);
    expect(await lan.list()).toEqual([]);
  });

  it("watches only while the setting is on", async () => {
    const { lan, state, watch, stop, announce } = setup();
    state.wanted = false;
    await lan.sync();
    expect(watch).not.toHaveBeenCalled();
    state.wanted = true;
    await lan.sync();
    await lan.sync();
    expect(watch).toHaveBeenCalledTimes(1);
    announce(skills);
    state.wanted = false;
    await lan.sync();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(await lan.list()).toEqual([]);
  });

  it("carries on, watching nothing, when the network cannot be watched", async () => {
    const log = vi.fn();
    const lan = createLanServers({
      isWanted: () => true,
      ownInstanceName: "Task Server on box",
      servers: async () => [],
      log,
      watch: async () => {
        throw new Error("multicast is blocked");
      },
    });
    await lan.sync();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("multicast is blocked"));
    expect(await lan.list()).toEqual([]);
  });

  it("stops watching on close", async () => {
    const { lan, stop } = setup();
    await lan.sync();
    await lan.close();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

describe("freeSlug", () => {
  it("takes the card's own name and makes it something a tool can be namespaced by", () => {
    expect(freeSlug("com.example/Weather Forecasts!", new Set())).toBe("weather-forecasts");
    expect(freeSlug("com.example/", new Set())).toBe("server");
    expect(freeSlug("bare", new Set(["bare"]))).toBe("bare-2");
  });
});
