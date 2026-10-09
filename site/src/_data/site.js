// Everything the layout needs to say who this is.
export default {
  name: "task_server",
  tagline: "Scheduled AI tasks: a prompt, a trigger, and every run kept.",
  description:
    "Write a prompt, attach a cron schedule or a webhook, and task_server runs it against any OpenAI-compatible model with your MCP servers' tools attached, keeping the output of every run.",
  url: "https://cubicecho.github.io/task_server/",
  repo: "https://github.com/cubicecho/task_server",
  org: "https://cubicecho.com",
  // Optional — the layout only renders the ones you set. There is no npm
  // package. Releases push an image to ghcr.io/cubicecho/task_server, but its
  // package page does not answer an anonymous visitor, so there is nothing
  // public to link yet; set `docker` once there is.
  npm: null,
  docker: null,
};
