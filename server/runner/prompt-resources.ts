import { errorMessage, type RunEventInput, RunEventKind, untrusted } from "@cubicecho/agent-core";
import { McpPoolError } from "@cubicecho/agent-mcp-pool";
import {
  type ResourceRead,
  type ResourceRef,
  resourceKey,
  resourcePlaceholder,
  resourceRefs,
} from "../../shared/resource-placeholder.ts";
import { mcp } from "./mcp.ts";

/**
 * The MCP resources a step's prompt names with `{{resource:<slug>:<uri>}}`, read as the step
 * starts.
 *
 * A prompt from `mcpPrompt` is expanded once and stored, so a server's author rephrasing a
 * template cannot change a working task. A resource is the opposite case: it is data, and the
 * point of naming it is to get what it says now — this week's notes, today's house rules — so it
 * is read on every run and never stored as the prompt.
 *
 * Only the step's own prompt is scanned. A placeholder in an earlier step's output, a webhook
 * body or a resource's own text is left as written: none of those were written by whoever wrote
 * the task, and a read they could ask for is a read a model or a sender could aim.
 */

/**
 * The most characters one placeholder puts into a prompt. A fixed bound rather than a column:
 * it is there so a log or a dump named by mistake cannot fill a model's window, not as a knob,
 * and ten thousand tokens or so is more than any document a prompt should carry whole. A read
 * past it is cut head and tail by the pool, says so in the text, and the watcher is told.
 */
export const RESOURCE_MAX_CHARS = 40_000;

/** What a step's reads came to: the text for each placeholder, and the record of each read. */
export interface PromptResources {
  /** The fenced text by `resourceKey`, for `renderPrompt`. */
  texts: Map<string, string>;
  /** One entry per distinct resource, for `run_steps.resources`, failed ones included. */
  reads: ResourceRead[];
  /** Why the step cannot run, when a read failed: the first failure, in prompt order. */
  failure?: string;
}

export interface ReadOptions {
  /** The run profile's MCP scope. Undefined is every server, as for the step's tools. */
  servers?: ReadonlySet<string>;
  signal?: AbortSignal;
  onEvent?: (event: RunEventInput) => void;
}

const UNREACHABLE = "no MCP server by that slug is one this run can reach";

/**
 * Why the pool would not read it, in words for the step's error. Out of scope and not configured
 * are said the same way, as the pool says them for a tool: a task an agent wrote must not learn
 * which servers exist beyond the ones its run was given.
 */
function refusal(error: unknown): string {
  if (error instanceof McpPoolError) {
    if (error.code === "unknown-server" || error.code === "out-of-scope") {
      return UNREACHABLE;
    }
    if (error.code === "disabled") {
      return "the server is disabled";
    }
    if (error.code === "unsupported") {
      return "the server does not serve resources";
    }
  }
  return errorMessage(error);
}

async function readOne(
  ref: ResourceRef,
  { servers, signal }: ReadOptions,
): Promise<{ read: ResourceRead; text?: string }> {
  const failed = (reason: string) => ({
    read: {
      ...ref,
      readAt: new Date().toISOString(),
      chars: 0,
      truncated: false,
      error: `Could not read ${resourcePlaceholder(ref)}: ${reason}.`,
    },
  });

  // The placeholder names a slug, and the pool is addressed by row id. A slug nothing here has
  // is refused in the words of one outside the scope, for `refusal`'s reason.
  const server = mcp.state().find((entry) => entry.slug === ref.server);
  if (!server) {
    return failed(UNREACHABLE);
  }
  try {
    const found = await mcp.readResource(server.id, ref.uri, {
      maxChars: RESOURCE_MAX_CHARS,
      servers,
      signal,
    });
    return {
      read: {
        ...ref,
        readAt: new Date().toISOString(),
        chars: found.text.length,
        truncated: found.truncated,
        ...(found.mimeType ? { mimeType: found.mimeType } : {}),
      },
      text: untrusted(found.text, { source: resourceKey(ref) }),
    };
  } catch (error) {
    signal?.throwIfAborted();
    return failed(refusal(error));
  }
}

/**
 * Reads every resource `prompt` names, each once, all at once.
 *
 * A failed read does not throw: every read is recorded, the ones that worked too, and `failure`
 * says why the step cannot go on. A prompt missing its input is a different prompt, and a model
 * run on it would answer it — confidently, and about nothing.
 */
export async function readPromptResources(
  prompt: string,
  options: ReadOptions = {},
): Promise<PromptResources> {
  const refs = resourceRefs(prompt);
  const results = await Promise.all(refs.map((ref) => readOne(ref, options)));

  const texts = new Map<string, string>();
  for (const [index, { read, text }] of results.entries()) {
    if (text !== undefined) {
      texts.set(resourceKey(refs[index]), text);
    }
    if (read.error) {
      continue;
    }
    options.onEvent?.({
      kind: RunEventKind.Notice,
      text: read.truncated
        ? `resource ${resourceKey(read)} was cut to ${RESOURCE_MAX_CHARS} characters`
        : `read resource ${resourceKey(read)} (${read.chars} characters)`,
    });
  }

  const failure = results.find(({ read }) => read.error)?.read.error;
  return { texts, reads: results.map(({ read }) => read), ...(failure ? { failure } : {}) };
}
