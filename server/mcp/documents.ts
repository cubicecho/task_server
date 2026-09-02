import fs from "node:fs";
import path from "node:path";
import { argsToZodShape, type CustomTool } from "@cubicecho/graphql-mcp";
import {
  type DefinitionNode,
  type DocumentNode,
  type FragmentDefinitionNode,
  type FragmentSpreadNode,
  type GraphQLArgument,
  type GraphQLSchema,
  graphql,
  isInputType,
  type OperationDefinitionNode,
  parse,
  print,
  typeFromAST,
  valueFromAST,
} from "graphql";

/**
 * MCP tools built from GraphQL *operations* rather than from schema fields.
 *
 * The generated projection in `../mcp-endpoint.ts` turns each root field into a tool, which
 * means an agent meets the field's arguments as they are — `where: { id: { eq: … } }`, `set`,
 * `values` — and the JSON Schema for the filter types alone runs to 420 kB before a single call.
 * The shape of that surface is the database's, because that is what the schema is generated
 * from, and every leak downstream follows from it: there is no `get_task`, only `tasks` with a
 * filter; the write tools are called `update_task_single`, which is a drizzle-graphql artifact
 * that has travelled all the way into an agent's vocabulary.
 *
 * A document has none of those problems, because a person wrote it. Its variables are already
 * flat and named — `query GetTask($id: String!)` — its selection is exactly what the caller
 * wanted, and the filter ceremony lives inside it where it belongs. So the tool is the
 * operation: the name is the operation's, the arguments are its variables, the description is
 * the comment above it, and the GraphQL never reaches the client at all.
 *
 * The cost is that this file is a curated surface rather than a projection, and a new column is
 * not queryable until a document asks for it. That is the trade being made deliberately: the
 * agent-facing API becomes a thing under review in `tools.graphql`, not a shadow of the tables.
 */

/** How much of a result an agent is handed before it is cut. Mirrors the driver's own default. */
const MAX_CHARS = 50_000;

/**
 * The prose above an operation, `#` markers stripped.
 *
 * A description has to come from somewhere, and GraphQL gives an operation no place to put one:
 * the `"""…"""` descriptions the SDL uses are a schema construct, and an operation is not part
 * of the schema. A comment block is where a person would write it anyway.
 */
function leadingComment(source: string, start: number): string {
  const before = source.slice(0, start).split("\n");
  before.pop();
  const lines: string[] = [];
  for (let index = before.length - 1; index >= 0; index--) {
    const line = before[index].trim();
    if (!line.startsWith("#")) break;
    lines.unshift(line.replace(/^#\s?/, ""));
  }
  return lines.join("\n").trim();
}

/**
 * The fragments an operation actually spreads, transitively.
 *
 * Every fragment in the folder cannot simply be appended to every document: GraphQL rejects a
 * document carrying a fragment it never uses, so each operation gets exactly its own.
 */
function reachableFragments(
  node: DefinitionNode,
  fragments: Map<string, FragmentDefinitionNode>,
  found = new Set<string>(),
): Set<string> {
  JSON.stringify(node, (_key, value: unknown) => {
    if (value && typeof value === "object" && "kind" in value && value.kind === "FragmentSpread") {
      const name = (value as unknown as FragmentSpreadNode).name.value;
      const fragment = fragments.get(name);
      if (fragment && !found.has(name)) {
        found.add(name);
        reachableFragments(fragment, fragments, found);
      }
    }
    return value;
  });
  return found;
}

/**
 * An operation's variables, in the shape the driver's own argument converter takes.
 *
 * A variable definition and a field argument carry the same three things — a name, an input
 * type and an optional default — so the conversion that builds a generated tool's input schema
 * builds this one too, and a custom scalar or an enum renders here exactly as it does there.
 */
function variablesToArgs(
  operation: OperationDefinitionNode,
  schema: GraphQLSchema,
): GraphQLArgument[] {
  return (operation.variableDefinitions ?? []).map((definition) => {
    const type = typeFromAST(schema, definition.type);
    if (!type || !isInputType(type)) {
      throw new Error(`$${definition.variable.name.value} is not an input type`);
    }
    return {
      name: definition.variable.name.value,
      description: undefined,
      type,
      defaultValue: definition.defaultValue
        ? valueFromAST(definition.defaultValue, type)
        : undefined,
      deprecationReason: undefined,
      extensions: {},
      astNode: undefined,
    } as unknown as GraphQLArgument;
  });
}

/**
 * What the tool answers with — the payload, not the envelope.
 *
 * The generated tools hand back the whole `{ data, errors }` result as JSON text, which asks an
 * agent to unwrap `data` and then the root field, whose name is the *GraphQL* one and not the
 * tool it just called. An operation has one root field by construction here, so there is a
 * single obvious answer to return, and a failure is a sentence rather than an error array.
 */
function present(data: Record<string, unknown> | null | undefined, errors?: readonly Error[]) {
  if (errors?.length) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: errors.map((error) => error.message).join("\n") }],
    };
  }
  const keys = Object.keys(data ?? {});
  const payload = keys.length === 1 ? data?.[keys[0]] : data;
  const text = JSON.stringify(payload, null, 2);
  return {
    content: [
      {
        type: "text" as const,
        text:
          text.length > MAX_CHARS
            ? `${text.slice(0, MAX_CHARS)}\n\n[truncated — ask for fewer rows]`
            : text,
      },
    ],
  };
}

/** Names that describe what a write does, for the clients that gate on it. */
function annotationsFor(operation: OperationDefinitionNode, name: string) {
  if (operation.operation === "query") {
    return { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
  }
  const destroys = /^(delete|remove|stop)_/.test(name);
  return { readOnlyHint: false, destructiveHint: destroys, idempotentHint: destroys };
}

/**
 * Every named operation in `dir`, as a tool.
 *
 * Fragments are shared across the folder the way they are across the web app's documents, so a
 * selection worth reusing is written once.
 */
export function documentTools(schema: GraphQLSchema, dir: string): CustomTool[] {
  const files = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".graphql"))
    .map((file) => ({ source: fs.readFileSync(path.join(dir, file), "utf8") }));

  const parsed: { source: string; document: DocumentNode }[] = files.map((file) => ({
    ...file,
    document: parse(file.source),
  }));

  const fragments = new Map<string, FragmentDefinitionNode>();
  for (const file of parsed) {
    for (const definition of file.document.definitions) {
      if (definition.kind === "FragmentDefinition")
        fragments.set(definition.name.value, definition);
    }
  }

  return parsed.flatMap((file) =>
    file.document.definitions
      .filter(
        (definition): definition is OperationDefinitionNode =>
          definition.kind === "OperationDefinition" &&
          definition.operation !== "subscription" &&
          definition.name != null,
      )
      .map((operation) => {
        const name = operation.name?.value ?? "";
        const used = reachableFragments(operation, fragments);
        const document = [
          print(operation),
          ...[...used].map((fragment) => print(fragments.get(fragment) as FragmentDefinitionNode)),
        ].join("\n\n");

        return {
          name,
          description: leadingComment(file.source, operation.loc?.start ?? 0),
          inputSchema: argsToZodShape(variablesToArgs(operation, schema)),
          annotations: annotationsFor(operation, name),
          handler: async (args: Record<string, unknown>) => {
            const result = await graphql({
              schema,
              source: document,
              variableValues: args,
              operationName: name,
            });
            return present(result.data, result.errors);
          },
        };
      }),
  );
}
