import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  /** A date-time string at UTC, such as 2007-12-03T10:15:30Z, compliant with the `date-time` format outlined in section 5.6 of the RFC 3339 profile of the ISO 8601 standard for representation of dates and times using the Gregorian calendar. */
  DateTime: { input: string; output: string; }
  /** The `JSON` scalar type represents JSON values as specified by [ECMA-404](http://www.ecma-international.org/publications/files/ECMA-ST/ECMA-404.pdf). */
  JSON: { input: unknown; output: unknown; }
};

/** Compares an aggregated value. Several operators in one filter are ANDed together. */
export type AggregateNumberFilter = {
  eq?: InputMaybe<Scalars['Float']['input']>;
  gt?: InputMaybe<Scalars['Float']['input']>;
  gte?: InputMaybe<Scalars['Float']['input']>;
  lt?: InputMaybe<Scalars['Float']['input']>;
  lte?: InputMaybe<Scalars['Float']['input']>;
  ne?: InputMaybe<Scalars['Float']['input']>;
};

export type BooleanFilter = {
  /** Every branch matches */
  AND?: InputMaybe<Array<BooleanFilter>>;
  /** Negates the nested operators */
  NOT?: InputMaybe<BooleanFilter>;
  /** At least one branch matches; ANDed with any sibling operators */
  OR?: InputMaybe<Array<BooleanFilter>>;
  /** Matches values containing the given string. `%`, `_` and `\` are matched literally. */
  contains?: InputMaybe<Scalars['String']['input']>;
  /** Matches values ending with the given string. `%`, `_` and `\` are matched literally. */
  endsWith?: InputMaybe<Scalars['String']['input']>;
  /** Equal to */
  eq?: InputMaybe<Scalars['Boolean']['input']>;
  /** Greater than */
  gt?: InputMaybe<Scalars['Boolean']['input']>;
  /** Greater than or equal to */
  gte?: InputMaybe<Scalars['Boolean']['input']>;
  /** Case-insensitive `contains`. */
  iContains?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `endsWith`. */
  iEndsWith?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `startsWith`. */
  iStartsWith?: InputMaybe<Scalars['String']['input']>;
  ilike?: InputMaybe<Scalars['String']['input']>;
  /** Matches any one of these values (SQL `IN`) */
  inArray?: InputMaybe<Array<Scalars['Boolean']['input']>>;
  /** When true, every comparison operator in this object matches case-insensitively — `eq`, `ne`, the ordering operators, `inArray`/`notInArray` and the pattern operators all compare `lower(column)` against `lower(operand)`. Applies only to the operators beside it; a nested `AND`/`OR`/`NOT` branch sets its own. */
  insensitive?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is not NULL */
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is NULL */
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  like?: InputMaybe<Scalars['String']['input']>;
  /** Less than */
  lt?: InputMaybe<Scalars['Boolean']['input']>;
  /** Less than or equal to */
  lte?: InputMaybe<Scalars['Boolean']['input']>;
  /** Not equal to */
  ne?: InputMaybe<Scalars['Boolean']['input']>;
  notIlike?: InputMaybe<Scalars['String']['input']>;
  /** Matches none of these values (SQL `NOT IN`) */
  notInArray?: InputMaybe<Array<Scalars['Boolean']['input']>>;
  notLike?: InputMaybe<Scalars['String']['input']>;
  /** Matches values starting with the given string. `%`, `_` and `\` are matched literally. */
  startsWith?: InputMaybe<Scalars['String']['input']>;
};

export type CreateMcpServerInput = {
  args?: InputMaybe<Scalars['JSON']['input']>;
  command?: InputMaybe<Scalars['String']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  env?: InputMaybe<Scalars['JSON']['input']>;
  headers?: InputMaybe<Scalars['JSON']['input']>;
  id?: InputMaybe<Scalars['String']['input']>;
  label?: InputMaybe<Scalars['String']['input']>;
  slug: Scalars['String']['input'];
  transport?: InputMaybe<McpServersTransportEnum>;
  url?: InputMaybe<Scalars['String']['input']>;
};

export type CreateStepInput = {
  branch?: InputMaybe<Scalars['String']['input']>;
  cases?: InputMaybe<Scalars['JSON']['input']>;
  context?: InputMaybe<StepsContextEnum>;
  createdAt?: InputMaybe<Scalars['DateTime']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  id?: InputMaybe<Scalars['String']['input']>;
  kind?: InputMaybe<StepsKindEnum>;
  model?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  parentId?: InputMaybe<Scalars['String']['input']>;
  position?: InputMaybe<Scalars['Int']['input']>;
  prompt?: InputMaybe<Scalars['String']['input']>;
  systemPrompt?: InputMaybe<Scalars['String']['input']>;
  taskId: Scalars['String']['input'];
};

export type CreateTaskInput = {
  createdAt?: InputMaybe<Scalars['DateTime']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  id?: InputMaybe<Scalars['String']['input']>;
  model?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  prompt: Scalars['String']['input'];
  systemPrompt?: InputMaybe<Scalars['String']['input']>;
  updatedAt?: InputMaybe<Scalars['DateTime']['input']>;
};

export type CreateTriggerInput = {
  config?: InputMaybe<Scalars['JSON']['input']>;
  createdAt?: InputMaybe<Scalars['DateTime']['input']>;
  cron?: InputMaybe<Scalars['String']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  event?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['String']['input']>;
  kind?: InputMaybe<TriggersKindEnum>;
  taskId: Scalars['String']['input'];
  timezone?: InputMaybe<Scalars['String']['input']>;
};

export type DateTimeFilter = {
  /** Every branch matches */
  AND?: InputMaybe<Array<DateTimeFilter>>;
  /** Negates the nested operators */
  NOT?: InputMaybe<DateTimeFilter>;
  /** At least one branch matches; ANDed with any sibling operators */
  OR?: InputMaybe<Array<DateTimeFilter>>;
  /** Matches values containing the given string. `%`, `_` and `\` are matched literally. */
  contains?: InputMaybe<Scalars['String']['input']>;
  /** Matches values ending with the given string. `%`, `_` and `\` are matched literally. */
  endsWith?: InputMaybe<Scalars['String']['input']>;
  /** Equal to */
  eq?: InputMaybe<Scalars['DateTime']['input']>;
  /** Greater than */
  gt?: InputMaybe<Scalars['DateTime']['input']>;
  /** Greater than or equal to */
  gte?: InputMaybe<Scalars['DateTime']['input']>;
  /** Case-insensitive `contains`. */
  iContains?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `endsWith`. */
  iEndsWith?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `startsWith`. */
  iStartsWith?: InputMaybe<Scalars['String']['input']>;
  ilike?: InputMaybe<Scalars['String']['input']>;
  /** Matches any one of these values (SQL `IN`) */
  inArray?: InputMaybe<Array<Scalars['DateTime']['input']>>;
  /** When true, every comparison operator in this object matches case-insensitively — `eq`, `ne`, the ordering operators, `inArray`/`notInArray` and the pattern operators all compare `lower(column)` against `lower(operand)`. Applies only to the operators beside it; a nested `AND`/`OR`/`NOT` branch sets its own. */
  insensitive?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is not NULL */
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is NULL */
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  like?: InputMaybe<Scalars['String']['input']>;
  /** Less than */
  lt?: InputMaybe<Scalars['DateTime']['input']>;
  /** Less than or equal to */
  lte?: InputMaybe<Scalars['DateTime']['input']>;
  /** Not equal to */
  ne?: InputMaybe<Scalars['DateTime']['input']>;
  notIlike?: InputMaybe<Scalars['String']['input']>;
  /** Matches none of these values (SQL `NOT IN`) */
  notInArray?: InputMaybe<Array<Scalars['DateTime']['input']>>;
  notLike?: InputMaybe<Scalars['String']['input']>;
  /** Matches values starting with the given string. `%`, `_` and `\` are matched literally. */
  startsWith?: InputMaybe<Scalars['String']['input']>;
};

export type FloatFilter = {
  /** Every branch matches */
  AND?: InputMaybe<Array<FloatFilter>>;
  /** Negates the nested operators */
  NOT?: InputMaybe<FloatFilter>;
  /** At least one branch matches; ANDed with any sibling operators */
  OR?: InputMaybe<Array<FloatFilter>>;
  /** Equal to */
  eq?: InputMaybe<Scalars['Float']['input']>;
  /** Greater than */
  gt?: InputMaybe<Scalars['Float']['input']>;
  /** Greater than or equal to */
  gte?: InputMaybe<Scalars['Float']['input']>;
  /** Matches any one of these values (SQL `IN`) */
  inArray?: InputMaybe<Array<Scalars['Float']['input']>>;
  /** When true, matches rows where the column is not NULL */
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is NULL */
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** Less than */
  lt?: InputMaybe<Scalars['Float']['input']>;
  /** Less than or equal to */
  lte?: InputMaybe<Scalars['Float']['input']>;
  /** Not equal to */
  ne?: InputMaybe<Scalars['Float']['input']>;
  /** Matches none of these values (SQL `NOT IN`) */
  notInArray?: InputMaybe<Array<Scalars['Float']['input']>>;
};

export type InnerOrder = {
  direction: OrderDirection;
  /** Sort by this column's position in the `inArray` list the same request's `where` gives it, rather than by the column's own value — `direction: asc` keeps the list's order, `desc` reverses it. Requires an `inArray` filter on the same column at the top level of `where`, and cannot be combined with `after` or `distinct`. */
  matchFilterOrder?: InputMaybe<Scalars['Boolean']['input']>;
  /** Where NULL values sort. Defaults to the database's own rule (PostgreSQL: last on asc, first on desc; MySQL/SQLite: first on asc, last on desc) */
  nulls?: InputMaybe<OrderNulls>;
  /** Priority of current field */
  priority: Scalars['Int']['input'];
};

export type IntFilter = {
  /** Every branch matches */
  AND?: InputMaybe<Array<IntFilter>>;
  /** Negates the nested operators */
  NOT?: InputMaybe<IntFilter>;
  /** At least one branch matches; ANDed with any sibling operators */
  OR?: InputMaybe<Array<IntFilter>>;
  /** Equal to */
  eq?: InputMaybe<Scalars['Int']['input']>;
  /** Greater than */
  gt?: InputMaybe<Scalars['Int']['input']>;
  /** Greater than or equal to */
  gte?: InputMaybe<Scalars['Int']['input']>;
  /** Matches any one of these values (SQL `IN`) */
  inArray?: InputMaybe<Array<Scalars['Int']['input']>>;
  /** When true, matches rows where the column is not NULL */
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is NULL */
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** Less than */
  lt?: InputMaybe<Scalars['Int']['input']>;
  /** Less than or equal to */
  lte?: InputMaybe<Scalars['Int']['input']>;
  /** Not equal to */
  ne?: InputMaybe<Scalars['Int']['input']>;
  /** Matches none of these values (SQL `NOT IN`) */
  notInArray?: InputMaybe<Array<Scalars['Int']['input']>>;
};

export type JsonFilter = {
  /** Every branch matches */
  AND?: InputMaybe<Array<JsonFilter>>;
  /** Negates the nested operators */
  NOT?: InputMaybe<JsonFilter>;
  /** At least one branch matches; ANDed with any sibling operators */
  OR?: InputMaybe<Array<JsonFilter>>;
  /** Value structurally contains this JSON (Postgres `@>` / MySQL JSON_CONTAINS) */
  contains?: InputMaybe<Scalars['JSON']['input']>;
  /** JSON equality on the whole value */
  eq?: InputMaybe<Scalars['JSON']['input']>;
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** JSON inequality on the whole value */
  ne?: InputMaybe<Scalars['JSON']['input']>;
  /** Compares the value at one path inside the document. Several entries are ANDed; a single object may be passed without the list brackets. */
  path?: InputMaybe<Array<JsonPathFilter>>;
};

/** How to read the value at a JSON path before comparing it */
export enum JsonPathCast {
  /** Compare as a boolean */
  Boolean = 'BOOLEAN',
  /** Compare as a number; a non-numeric value never matches */
  Number = 'NUMBER',
  /** Compare as text (lexicographic ordering) */
  Text = 'TEXT'
}

export type JsonPathFilter = {
  /** Overrides how the value is read before comparing */
  as?: InputMaybe<JsonPathCast>;
  /** Extracted value contains this string. `%`, `_` and `\` are matched literally. */
  contains?: InputMaybe<Scalars['String']['input']>;
  /** Extracted value ends with this string. `%`, `_` and `\` are matched literally. */
  endsWith?: InputMaybe<Scalars['String']['input']>;
  /** Equal to */
  eq?: InputMaybe<Scalars['JSON']['input']>;
  /** Greater than */
  gt?: InputMaybe<Scalars['JSON']['input']>;
  /** Greater than or equal to */
  gte?: InputMaybe<Scalars['JSON']['input']>;
  /** Case-insensitive `contains`. */
  iContains?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `endsWith`. */
  iEndsWith?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `startsWith`. */
  iStartsWith?: InputMaybe<Scalars['String']['input']>;
  /** When true, matches rows where the path holds a value */
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the path is missing or holds JSON null */
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** Less than */
  lt?: InputMaybe<Scalars['JSON']['input']>;
  /** Less than or equal to */
  lte?: InputMaybe<Scalars['JSON']['input']>;
  /** Not equal to */
  ne?: InputMaybe<Scalars['JSON']['input']>;
  /** Keys to walk from the document root, e.g. `["profile", "level"]`. An all-digits key indexes an array. */
  path: Array<Scalars['String']['input']>;
  /** Extracted value starts with this string. `%`, `_` and `\` are matched literally. */
  startsWith?: InputMaybe<Scalars['String']['input']>;
};

/** How to reach an MCP server — the connection half of a row, without its identity. */
export type McpConnectionInput = {
  args?: InputMaybe<Array<Scalars['String']['input']>>;
  command?: InputMaybe<Scalars['String']['input']>;
  env?: InputMaybe<Scalars['JSON']['input']>;
  headers?: InputMaybe<Scalars['JSON']['input']>;
  transport: Scalars['String']['input'];
  url?: InputMaybe<Scalars['String']['input']>;
};

/** The result of dialling an MCP server once, without saving or pooling it. */
export type McpProbe = {
  error: Scalars['String']['output'];
  ok: Scalars['Boolean']['output'];
  tools: Array<McpTool>;
};

export type McpServer = {
  args?: Maybe<Scalars['JSON']['output']>;
  command: Scalars['String']['output'];
  /** Opaque cursor of this row's position in the query's ordering. Pass it as `after` to resume from here. Only set on rows returned by a list query. */
  cursor?: Maybe<Scalars['String']['output']>;
  enabled: Scalars['Boolean']['output'];
  env?: Maybe<Scalars['JSON']['output']>;
  headers?: Maybe<Scalars['JSON']['output']>;
  id: Scalars['String']['output'];
  label: Scalars['String']['output'];
  slug: Scalars['String']['output'];
  transport: McpServersTransportEnum;
  url: Scalars['String']['output'];
};

export type McpServerAggregate = {
  count: Scalars['Int']['output'];
  countDistinct?: Maybe<McpServerCountDistinctAggregate>;
  countNonNull?: Maybe<McpServerCountNonNullAggregate>;
  max?: Maybe<McpServerMaxAggregate>;
  min?: Maybe<McpServerMinAggregate>;
};

export type McpServerCountDistinctAggregate = {
  command: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  label: Scalars['Int']['output'];
  slug: Scalars['Int']['output'];
  transport: Scalars['Int']['output'];
  url: Scalars['Int']['output'];
};

export type McpServerCountDistinctHaving = {
  command?: InputMaybe<AggregateNumberFilter>;
  id?: InputMaybe<AggregateNumberFilter>;
  label?: InputMaybe<AggregateNumberFilter>;
  slug?: InputMaybe<AggregateNumberFilter>;
  transport?: InputMaybe<AggregateNumberFilter>;
  url?: InputMaybe<AggregateNumberFilter>;
};

export type McpServerCountNonNullAggregate = {
  args: Scalars['Int']['output'];
  command: Scalars['Int']['output'];
  enabled: Scalars['Int']['output'];
  env: Scalars['Int']['output'];
  headers: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  label: Scalars['Int']['output'];
  slug: Scalars['Int']['output'];
  transport: Scalars['Int']['output'];
  url: Scalars['Int']['output'];
};

export type McpServerCountNonNullHaving = {
  args?: InputMaybe<AggregateNumberFilter>;
  command?: InputMaybe<AggregateNumberFilter>;
  enabled?: InputMaybe<AggregateNumberFilter>;
  env?: InputMaybe<AggregateNumberFilter>;
  headers?: InputMaybe<AggregateNumberFilter>;
  id?: InputMaybe<AggregateNumberFilter>;
  label?: InputMaybe<AggregateNumberFilter>;
  slug?: InputMaybe<AggregateNumberFilter>;
  transport?: InputMaybe<AggregateNumberFilter>;
  url?: InputMaybe<AggregateNumberFilter>;
};

/** Columns of McpServer that a query can be made distinct on */
export enum McpServerDistinctColumn {
  Args = 'args',
  Command = 'command',
  Enabled = 'enabled',
  Env = 'env',
  Headers = 'headers',
  Id = 'id',
  Label = 'label',
  Slug = 'slug',
  Transport = 'transport',
  Url = 'url'
}

export type McpServerFilters = {
  /** Every branch matches */
  AND?: InputMaybe<Array<McpServerFilters>>;
  /** Negates the nested filters */
  NOT?: InputMaybe<McpServerFilters>;
  /** At least one branch matches; ANDed with any sibling fields */
  OR?: InputMaybe<Array<McpServerFilters>>;
  args?: InputMaybe<JsonFilter>;
  command?: InputMaybe<StringFilter>;
  enabled?: InputMaybe<BooleanFilter>;
  env?: InputMaybe<JsonFilter>;
  headers?: InputMaybe<JsonFilter>;
  id?: InputMaybe<StringFilter>;
  label?: InputMaybe<StringFilter>;
  slug?: InputMaybe<StringFilter>;
  transport?: InputMaybe<McpServersTransportEnumFilter>;
  url?: InputMaybe<StringFilter>;
};

export type McpServerGroupBy = {
  count: Scalars['Int']['output'];
  countDistinct?: Maybe<McpServerCountDistinctAggregate>;
  countNonNull?: Maybe<McpServerCountNonNullAggregate>;
  group: McpServerGroupKeys;
  max?: Maybe<McpServerMaxAggregate>;
  min?: Maybe<McpServerMinAggregate>;
};

/** Columns of McpServer that a query can group by */
export enum McpServerGroupByColumn {
  Command = 'command',
  Enabled = 'enabled',
  Id = 'id',
  Label = 'label',
  Slug = 'slug',
  Transport = 'transport',
  Url = 'url'
}

/** The grouped column values of one McpServer group. A column the query did not group by is null. */
export type McpServerGroupKeys = {
  command?: Maybe<Scalars['String']['output']>;
  enabled?: Maybe<Scalars['Boolean']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  label?: Maybe<Scalars['String']['output']>;
  slug?: Maybe<Scalars['String']['output']>;
  transport?: Maybe<McpServersTransportEnum>;
  url?: Maybe<Scalars['String']['output']>;
};

/** Filters McpServer groups by their aggregated values */
export type McpServerHaving = {
  /** Filters groups by how many rows they contain */
  count?: InputMaybe<AggregateNumberFilter>;
  countDistinct?: InputMaybe<McpServerCountDistinctHaving>;
  countNonNull?: InputMaybe<McpServerCountNonNullHaving>;
};

export type McpServerMaxAggregate = {
  command?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  label?: Maybe<Scalars['String']['output']>;
  slug?: Maybe<Scalars['String']['output']>;
  transport?: Maybe<McpServersTransportEnum>;
  url?: Maybe<Scalars['String']['output']>;
};

export type McpServerMinAggregate = {
  command?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  label?: Maybe<Scalars['String']['output']>;
  slug?: Maybe<Scalars['String']['output']>;
  transport?: Maybe<McpServersTransportEnum>;
  url?: Maybe<Scalars['String']['output']>;
};

export type McpServerOrderBy = {
  args?: InputMaybe<InnerOrder>;
  command?: InputMaybe<InnerOrder>;
  enabled?: InputMaybe<InnerOrder>;
  env?: InputMaybe<InnerOrder>;
  headers?: InputMaybe<InnerOrder>;
  id?: InputMaybe<InnerOrder>;
  label?: InputMaybe<InnerOrder>;
  slug?: InputMaybe<InnerOrder>;
  transport?: InputMaybe<InnerOrder>;
  url?: InputMaybe<InnerOrder>;
};

/** Live connection state for a configured MCP server, and the tools it offers. */
export type McpServerStatus = {
  error: Scalars['String']['output'];
  id: Scalars['String']['output'];
  label: Scalars['String']['output'];
  slug: Scalars['String']['output'];
  status: Scalars['String']['output'];
  tools: Array<McpTool>;
};

export enum McpServersTransportEnum {
  /** Value: http */
  Http = 'http',
  /** Value: stdio */
  Stdio = 'stdio'
}

export type McpServersTransportEnumFilter = {
  /** Every branch matches */
  AND?: InputMaybe<Array<McpServersTransportEnumFilter>>;
  /** Negates the nested operators */
  NOT?: InputMaybe<McpServersTransportEnumFilter>;
  /** At least one branch matches; ANDed with any sibling operators */
  OR?: InputMaybe<Array<McpServersTransportEnumFilter>>;
  /** Matches values containing the given string. `%`, `_` and `\` are matched literally. */
  contains?: InputMaybe<Scalars['String']['input']>;
  /** Matches values ending with the given string. `%`, `_` and `\` are matched literally. */
  endsWith?: InputMaybe<Scalars['String']['input']>;
  /** Equal to */
  eq?: InputMaybe<McpServersTransportEnum>;
  /** Greater than */
  gt?: InputMaybe<McpServersTransportEnum>;
  /** Greater than or equal to */
  gte?: InputMaybe<McpServersTransportEnum>;
  /** Case-insensitive `contains`. */
  iContains?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `endsWith`. */
  iEndsWith?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `startsWith`. */
  iStartsWith?: InputMaybe<Scalars['String']['input']>;
  ilike?: InputMaybe<Scalars['String']['input']>;
  /** Matches any one of these values (SQL `IN`) */
  inArray?: InputMaybe<Array<McpServersTransportEnum>>;
  /** When true, every comparison operator in this object matches case-insensitively — `eq`, `ne`, the ordering operators, `inArray`/`notInArray` and the pattern operators all compare `lower(column)` against `lower(operand)`. Applies only to the operators beside it; a nested `AND`/`OR`/`NOT` branch sets its own. */
  insensitive?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is not NULL */
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is NULL */
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  like?: InputMaybe<Scalars['String']['input']>;
  /** Less than */
  lt?: InputMaybe<McpServersTransportEnum>;
  /** Less than or equal to */
  lte?: InputMaybe<McpServersTransportEnum>;
  /** Not equal to */
  ne?: InputMaybe<McpServersTransportEnum>;
  notIlike?: InputMaybe<Scalars['String']['input']>;
  /** Matches none of these values (SQL `NOT IN`) */
  notInArray?: InputMaybe<Array<McpServersTransportEnum>>;
  notLike?: InputMaybe<Scalars['String']['input']>;
  /** Matches values starting with the given string. `%`, `_` and `\` are matched literally. */
  startsWith?: InputMaybe<Scalars['String']['input']>;
};

export type McpTool = {
  description: Scalars['String']['output'];
  name: Scalars['String']['output'];
};

export type Mutation = {
  createMcpServer: McpServer;
  createMcpServers: Array<McpServer>;
  createStep: Step;
  createSteps: Array<Step>;
  createTask: Task;
  createTasks: Array<Task>;
  createTrigger: Trigger;
  createTriggers: Array<Trigger>;
  deleteMcpServer: Array<McpServer>;
  deleteMcpServerSingle?: Maybe<McpServer>;
  deleteRun: Array<Run>;
  deleteRunSingle?: Maybe<Run>;
  deleteRunStep: Array<RunStep>;
  deleteRunStepSingle?: Maybe<RunStep>;
  deleteStep: Array<Step>;
  deleteStepSingle?: Maybe<Step>;
  deleteTask: Array<Task>;
  deleteTaskSingle?: Maybe<Task>;
  deleteTrigger: Array<Trigger>;
  deleteTriggerSingle?: Maybe<Trigger>;
  /** Tears down and rebuilds every MCP connection. */
  reconnectMcp: Array<McpServerStatus>;
  /** Runs a task immediately and resolves with the finished run — which means it does not answer until the run is over, and a long task is a long call. Read `runEvents` meanwhile to watch it, or `stopTask` to call it off. */
  runTask: Run;
  /** Writes the API key. Separate from updateSetting because the key is write-only: it is excluded from the Setting type so it can never be read back out. */
  setApiKey: Scalars['Boolean']['output'];
  /** Replaces a task's whole flow in one transaction, and returns it flattened into rows in the order it runs. A flow is only correct as a whole — a step's parent, its arm and its place in that arm are all relative to its siblings — so it is written as a whole rather than a row at a time. Steps sent back with their existing ids are edited in place and keep the run history that points at them; the rest are replaced. Pass an empty list to run the task's own prompt and nothing else. */
  setTaskSteps: Array<Step>;
  /** Calls off a running task. False means it was not running — a stale button, not a failure. The run is recorded as `stopped`. */
  stopTask: Scalars['Boolean']['output'];
  /** Connects to a config that need not be saved yet and lists its tools, so a server can be checked before a task depends on it. */
  testMcpServer: McpProbe;
  updateMcpServer: Array<McpServer>;
  updateMcpServerSingle?: Maybe<McpServer>;
  /** Each entry's updated rows, in entry order. An entry whose `where` matched no rows contributes `null` in its slot; an entry that matched several contributes each of its rows. */
  updateMcpServersMany: Array<Maybe<McpServer>>;
  updateSetting: Array<Setting>;
  updateSettingSingle?: Maybe<Setting>;
  /** Each entry's updated rows, in entry order. An entry whose `where` matched no rows contributes `null` in its slot; an entry that matched several contributes each of its rows. */
  updateSettingsMany: Array<Maybe<Setting>>;
  updateStep: Array<Step>;
  updateStepSingle?: Maybe<Step>;
  /** Each entry's updated rows, in entry order. An entry whose `where` matched no rows contributes `null` in its slot; an entry that matched several contributes each of its rows. */
  updateStepsMany: Array<Maybe<Step>>;
  updateTask: Array<Task>;
  updateTaskSingle?: Maybe<Task>;
  /** Each entry's updated rows, in entry order. An entry whose `where` matched no rows contributes `null` in its slot; an entry that matched several contributes each of its rows. */
  updateTasksMany: Array<Maybe<Task>>;
  updateTrigger: Array<Trigger>;
  updateTriggerSingle?: Maybe<Trigger>;
  /** Each entry's updated rows, in entry order. An entry whose `where` matched no rows contributes `null` in its slot; an entry that matched several contributes each of its rows. */
  updateTriggersMany: Array<Maybe<Trigger>>;
};


export type MutationCreateMcpServerArgs = {
  values: CreateMcpServerInput;
};


export type MutationCreateMcpServersArgs = {
  values: Array<CreateMcpServerInput>;
};


export type MutationCreateStepArgs = {
  values: CreateStepInput;
};


export type MutationCreateStepsArgs = {
  values: Array<CreateStepInput>;
};


export type MutationCreateTaskArgs = {
  values: CreateTaskInput;
};


export type MutationCreateTasksArgs = {
  values: Array<CreateTaskInput>;
};


export type MutationCreateTriggerArgs = {
  values: CreateTriggerInput;
};


export type MutationCreateTriggersArgs = {
  values: Array<CreateTriggerInput>;
};


export type MutationDeleteMcpServerArgs = {
  where?: InputMaybe<McpServerFilters>;
};


export type MutationDeleteMcpServerSingleArgs = {
  where: McpServerFilters;
};


export type MutationDeleteRunArgs = {
  where?: InputMaybe<RunFilters>;
};


export type MutationDeleteRunSingleArgs = {
  where: RunFilters;
};


export type MutationDeleteRunStepArgs = {
  where?: InputMaybe<RunStepFilters>;
};


export type MutationDeleteRunStepSingleArgs = {
  where: RunStepFilters;
};


export type MutationDeleteStepArgs = {
  where?: InputMaybe<StepFilters>;
};


export type MutationDeleteStepSingleArgs = {
  where: StepFilters;
};


export type MutationDeleteTaskArgs = {
  where?: InputMaybe<TaskFilters>;
};


export type MutationDeleteTaskSingleArgs = {
  where: TaskFilters;
};


export type MutationDeleteTriggerArgs = {
  where?: InputMaybe<TriggerFilters>;
};


export type MutationDeleteTriggerSingleArgs = {
  where: TriggerFilters;
};


export type MutationRunTaskArgs = {
  taskId: Scalars['String']['input'];
};


export type MutationSetApiKeyArgs = {
  apiKey: Scalars['String']['input'];
};


export type MutationSetTaskStepsArgs = {
  steps: Array<StepInput>;
  taskId: Scalars['String']['input'];
};


export type MutationStopTaskArgs = {
  taskId: Scalars['String']['input'];
};


export type MutationTestMcpServerArgs = {
  config: McpConnectionInput;
};


export type MutationUpdateMcpServerArgs = {
  set: UpdateMcpServerInput;
  where?: InputMaybe<McpServerFilters>;
};


export type MutationUpdateMcpServerSingleArgs = {
  set: UpdateMcpServerInput;
  where: McpServerFilters;
};


export type MutationUpdateMcpServersManyArgs = {
  updates: Array<UpdateMcpServerManyInput>;
};


export type MutationUpdateSettingArgs = {
  set: UpdateSettingInput;
  where?: InputMaybe<SettingFilters>;
};


export type MutationUpdateSettingSingleArgs = {
  set: UpdateSettingInput;
  where: SettingFilters;
};


export type MutationUpdateSettingsManyArgs = {
  updates: Array<UpdateSettingManyInput>;
};


export type MutationUpdateStepArgs = {
  set: UpdateStepInput;
  where?: InputMaybe<StepFilters>;
};


export type MutationUpdateStepSingleArgs = {
  set: UpdateStepInput;
  where: StepFilters;
};


export type MutationUpdateStepsManyArgs = {
  updates: Array<UpdateStepManyInput>;
};


export type MutationUpdateTaskArgs = {
  set: UpdateTaskInput;
  where?: InputMaybe<TaskFilters>;
};


export type MutationUpdateTaskSingleArgs = {
  set: UpdateTaskInput;
  where: TaskFilters;
};


export type MutationUpdateTasksManyArgs = {
  updates: Array<UpdateTaskManyInput>;
};


export type MutationUpdateTriggerArgs = {
  set: UpdateTriggerInput;
  where?: InputMaybe<TriggerFilters>;
};


export type MutationUpdateTriggerSingleArgs = {
  set: UpdateTriggerInput;
  where: TriggerFilters;
};


export type MutationUpdateTriggersManyArgs = {
  updates: Array<UpdateTriggerManyInput>;
};

/** Order by direction */
export enum OrderDirection {
  /** Ascending order */
  Asc = 'asc',
  /** Descending order */
  Desc = 'desc'
}

/** Where NULL values sort relative to non-NULL values */
export enum OrderNulls {
  /** NULL values sort before all non-NULL values */
  First = 'first',
  /** NULL values sort after all non-NULL values */
  Last = 'last'
}

export type Query = {
  mcpServer?: Maybe<McpServer>;
  mcpServers: Array<McpServer>;
  mcpServersAggregate: McpServerAggregate;
  mcpServersGroupBy: Array<McpServerGroupBy>;
  mcpStatus: Array<McpServerStatus>;
  /** Model ids the configured OpenAI-compatible server reports. */
  models: Array<Scalars['String']['output']>;
  run?: Maybe<Run>;
  /** What a run has said so far, oldest first, with consecutive thinking and output tokens folded into one entry each. The snapshot form of the `runEvents` subscription, for a client that polls rather than holds a stream open: pass the `seq` of the last entry you read as `afterSeq` to pick up exactly where you left off. Empty for a run that has not started, or one that finished over a minute ago. */
  runEvents: Array<RunEvent>;
  runStep?: Maybe<RunStep>;
  runSteps: Array<RunStep>;
  runStepsAggregate: RunStepAggregate;
  runStepsGroupBy: Array<RunStepGroupBy>;
  runs: Array<Run>;
  runsAggregate: RunAggregate;
  runsGroupBy: Array<RunGroupBy>;
  schedule: Array<ScheduleEntry>;
  setting?: Maybe<Setting>;
  settings: Array<Setting>;
  settingsAggregate: SettingAggregate;
  settingsGroupBy: Array<SettingGroupBy>;
  step?: Maybe<Step>;
  steps: Array<Step>;
  stepsAggregate: StepAggregate;
  stepsGroupBy: Array<StepGroupBy>;
  task?: Maybe<Task>;
  tasks: Array<Task>;
  tasksAggregate: TaskAggregate;
  tasksGroupBy: Array<TaskGroupBy>;
  trigger?: Maybe<Trigger>;
  triggers: Array<Trigger>;
  triggersAggregate: TriggerAggregate;
  triggersGroupBy: Array<TriggerGroupBy>;
};


export type QueryMcpServerArgs = {
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<McpServerOrderBy>;
  where?: InputMaybe<McpServerFilters>;
};


export type QueryMcpServersArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  distinct?: InputMaybe<Array<McpServerDistinctColumn>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<McpServerOrderBy>;
  where?: InputMaybe<McpServerFilters>;
};


export type QueryMcpServersAggregateArgs = {
  where?: InputMaybe<McpServerFilters>;
};


export type QueryMcpServersGroupByArgs = {
  groupBy: Array<McpServerGroupByColumn>;
  having?: InputMaybe<McpServerHaving>;
  where?: InputMaybe<McpServerFilters>;
};


export type QueryRunArgs = {
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<RunOrderBy>;
  where?: InputMaybe<RunFilters>;
};


export type QueryRunEventsArgs = {
  afterSeq?: InputMaybe<Scalars['Int']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  runId: Scalars['String']['input'];
};


export type QueryRunStepArgs = {
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<RunStepOrderBy>;
  where?: InputMaybe<RunStepFilters>;
};


export type QueryRunStepsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  distinct?: InputMaybe<Array<RunStepDistinctColumn>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<RunStepOrderBy>;
  where?: InputMaybe<RunStepFilters>;
};


export type QueryRunStepsAggregateArgs = {
  where?: InputMaybe<RunStepFilters>;
};


export type QueryRunStepsGroupByArgs = {
  groupBy: Array<RunStepGroupByColumn>;
  having?: InputMaybe<RunStepHaving>;
  where?: InputMaybe<RunStepFilters>;
};


export type QueryRunsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  distinct?: InputMaybe<Array<RunDistinctColumn>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<RunOrderBy>;
  where?: InputMaybe<RunFilters>;
};


export type QueryRunsAggregateArgs = {
  where?: InputMaybe<RunFilters>;
};


export type QueryRunsGroupByArgs = {
  groupBy: Array<RunGroupByColumn>;
  having?: InputMaybe<RunHaving>;
  where?: InputMaybe<RunFilters>;
};


export type QuerySettingArgs = {
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<SettingOrderBy>;
  where?: InputMaybe<SettingFilters>;
};


export type QuerySettingsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  distinct?: InputMaybe<Array<SettingDistinctColumn>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<SettingOrderBy>;
  where?: InputMaybe<SettingFilters>;
};


export type QuerySettingsAggregateArgs = {
  where?: InputMaybe<SettingFilters>;
};


export type QuerySettingsGroupByArgs = {
  groupBy: Array<SettingGroupByColumn>;
  having?: InputMaybe<SettingHaving>;
  where?: InputMaybe<SettingFilters>;
};


export type QueryStepArgs = {
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<StepOrderBy>;
  where?: InputMaybe<StepFilters>;
};


export type QueryStepsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  distinct?: InputMaybe<Array<StepDistinctColumn>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<StepOrderBy>;
  where?: InputMaybe<StepFilters>;
};


export type QueryStepsAggregateArgs = {
  where?: InputMaybe<StepFilters>;
};


export type QueryStepsGroupByArgs = {
  groupBy: Array<StepGroupByColumn>;
  having?: InputMaybe<StepHaving>;
  where?: InputMaybe<StepFilters>;
};


export type QueryTaskArgs = {
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<TaskOrderBy>;
  where?: InputMaybe<TaskFilters>;
};


export type QueryTasksArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  distinct?: InputMaybe<Array<TaskDistinctColumn>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<TaskOrderBy>;
  where?: InputMaybe<TaskFilters>;
};


export type QueryTasksAggregateArgs = {
  where?: InputMaybe<TaskFilters>;
};


export type QueryTasksGroupByArgs = {
  groupBy: Array<TaskGroupByColumn>;
  having?: InputMaybe<TaskHaving>;
  where?: InputMaybe<TaskFilters>;
};


export type QueryTriggerArgs = {
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<TriggerOrderBy>;
  where?: InputMaybe<TriggerFilters>;
};


export type QueryTriggersArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  distinct?: InputMaybe<Array<TriggerDistinctColumn>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<TriggerOrderBy>;
  where?: InputMaybe<TriggerFilters>;
};


export type QueryTriggersAggregateArgs = {
  where?: InputMaybe<TriggerFilters>;
};


export type QueryTriggersGroupByArgs = {
  groupBy: Array<TriggerGroupByColumn>;
  having?: InputMaybe<TriggerHaving>;
  where?: InputMaybe<TriggerFilters>;
};

export type Run = {
  completionTokens: Scalars['Int']['output'];
  /** Opaque cursor of this row's position in the query's ordering. Pass it as `after` to resume from here. Only set on rows returned by a list query. */
  cursor?: Maybe<Scalars['String']['output']>;
  error: Scalars['String']['output'];
  finishedAt?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['String']['output'];
  output: Scalars['String']['output'];
  promptTokens: Scalars['Int']['output'];
  startedAt: Scalars['DateTime']['output'];
  status: RunsStatusEnum;
  steps: Array<RunStep>;
  stepsAggregate: RunStepAggregate;
  task: Task;
  taskId: Scalars['String']['output'];
  toolCalls?: Maybe<Scalars['JSON']['output']>;
  totalTokens: Scalars['Int']['output'];
  trigger?: Maybe<Trigger>;
  triggerId?: Maybe<Scalars['String']['output']>;
};


export type RunStepsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  distinct?: InputMaybe<Array<RunStepDistinctColumn>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<RunStepOrderBy>;
  where?: InputMaybe<RunStepFilters>;
};


export type RunStepsAggregateArgs = {
  where?: InputMaybe<RunStepFilters>;
};


export type RunTaskArgs = {
  where?: InputMaybe<TaskFilters>;
};


export type RunTriggerArgs = {
  where?: InputMaybe<TriggerFilters>;
};

export type RunAggregate = {
  avg?: Maybe<RunAvgAggregate>;
  count: Scalars['Int']['output'];
  countDistinct?: Maybe<RunCountDistinctAggregate>;
  countNonNull?: Maybe<RunCountNonNullAggregate>;
  max?: Maybe<RunMaxAggregate>;
  min?: Maybe<RunMinAggregate>;
  sum?: Maybe<RunSumAggregate>;
};

export type RunAvgAggregate = {
  completionTokens?: Maybe<Scalars['Float']['output']>;
  promptTokens?: Maybe<Scalars['Float']['output']>;
  totalTokens?: Maybe<Scalars['Float']['output']>;
};

export type RunAvgHaving = {
  completionTokens?: InputMaybe<AggregateNumberFilter>;
  promptTokens?: InputMaybe<AggregateNumberFilter>;
  totalTokens?: InputMaybe<AggregateNumberFilter>;
};

export type RunCountDistinctAggregate = {
  completionTokens: Scalars['Int']['output'];
  error: Scalars['Int']['output'];
  finishedAt: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  output: Scalars['Int']['output'];
  promptTokens: Scalars['Int']['output'];
  startedAt: Scalars['Int']['output'];
  status: Scalars['Int']['output'];
  taskId: Scalars['Int']['output'];
  totalTokens: Scalars['Int']['output'];
  triggerId: Scalars['Int']['output'];
};

export type RunCountDistinctHaving = {
  completionTokens?: InputMaybe<AggregateNumberFilter>;
  error?: InputMaybe<AggregateNumberFilter>;
  finishedAt?: InputMaybe<AggregateNumberFilter>;
  id?: InputMaybe<AggregateNumberFilter>;
  output?: InputMaybe<AggregateNumberFilter>;
  promptTokens?: InputMaybe<AggregateNumberFilter>;
  startedAt?: InputMaybe<AggregateNumberFilter>;
  status?: InputMaybe<AggregateNumberFilter>;
  taskId?: InputMaybe<AggregateNumberFilter>;
  totalTokens?: InputMaybe<AggregateNumberFilter>;
  triggerId?: InputMaybe<AggregateNumberFilter>;
};

export type RunCountNonNullAggregate = {
  completionTokens: Scalars['Int']['output'];
  error: Scalars['Int']['output'];
  finishedAt: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  output: Scalars['Int']['output'];
  promptTokens: Scalars['Int']['output'];
  startedAt: Scalars['Int']['output'];
  status: Scalars['Int']['output'];
  taskId: Scalars['Int']['output'];
  toolCalls: Scalars['Int']['output'];
  totalTokens: Scalars['Int']['output'];
  triggerId: Scalars['Int']['output'];
};

export type RunCountNonNullHaving = {
  completionTokens?: InputMaybe<AggregateNumberFilter>;
  error?: InputMaybe<AggregateNumberFilter>;
  finishedAt?: InputMaybe<AggregateNumberFilter>;
  id?: InputMaybe<AggregateNumberFilter>;
  output?: InputMaybe<AggregateNumberFilter>;
  promptTokens?: InputMaybe<AggregateNumberFilter>;
  startedAt?: InputMaybe<AggregateNumberFilter>;
  status?: InputMaybe<AggregateNumberFilter>;
  taskId?: InputMaybe<AggregateNumberFilter>;
  toolCalls?: InputMaybe<AggregateNumberFilter>;
  totalTokens?: InputMaybe<AggregateNumberFilter>;
  triggerId?: InputMaybe<AggregateNumberFilter>;
};

/** Columns of Run that a query can be made distinct on */
export enum RunDistinctColumn {
  CompletionTokens = 'completionTokens',
  Error = 'error',
  FinishedAt = 'finishedAt',
  Id = 'id',
  Output = 'output',
  PromptTokens = 'promptTokens',
  StartedAt = 'startedAt',
  Status = 'status',
  TaskId = 'taskId',
  ToolCalls = 'toolCalls',
  TotalTokens = 'totalTokens',
  TriggerId = 'triggerId'
}

/** Something a run did while it was running — a token, a tool call, a step boundary. Held in memory for the length of the run and a minute after; the run row is the lasting record. */
export type RunEvent = {
  at: Scalars['DateTime']['output'];
  /** step | decision | turn | thinking | output | tool-call | tool-result | notice | done. */
  kind: Scalars['String']['output'];
  /** Tool name, where there is one. */
  name: Scalars['String']['output'];
  ok?: Maybe<Scalars['Boolean']['output']>;
  runId: Scalars['String']['output'];
  /** Per-run counter from 1, so a client can order and de-duplicate. */
  seq: Scalars['Int']['output'];
  /** The flow step this happened inside, so a watcher can group a run the way the task is written. Empty for what belongs to the run rather than to any one step. */
  step: Scalars['String']['output'];
  text: Scalars['String']['output'];
};

export type RunFilters = {
  /** Every branch matches */
  AND?: InputMaybe<Array<RunFilters>>;
  /** Negates the nested filters */
  NOT?: InputMaybe<RunFilters>;
  /** At least one branch matches; ANDed with any sibling fields */
  OR?: InputMaybe<Array<RunFilters>>;
  completionTokens?: InputMaybe<IntFilter>;
  error?: InputMaybe<StringFilter>;
  finishedAt?: InputMaybe<DateTimeFilter>;
  id?: InputMaybe<StringFilter>;
  output?: InputMaybe<StringFilter>;
  promptTokens?: InputMaybe<IntFilter>;
  startedAt?: InputMaybe<DateTimeFilter>;
  status?: InputMaybe<RunsStatusEnumFilter>;
  steps?: InputMaybe<RunStepListRelationFilter>;
  /** Matches rows whose task matches these filters */
  task?: InputMaybe<TaskFilters>;
  taskId?: InputMaybe<StringFilter>;
  toolCalls?: InputMaybe<JsonFilter>;
  totalTokens?: InputMaybe<IntFilter>;
  /** Matches rows whose trigger matches these filters */
  trigger?: InputMaybe<TriggerFilters>;
  triggerId?: InputMaybe<StringFilter>;
};

export type RunGroupBy = {
  avg?: Maybe<RunAvgAggregate>;
  count: Scalars['Int']['output'];
  countDistinct?: Maybe<RunCountDistinctAggregate>;
  countNonNull?: Maybe<RunCountNonNullAggregate>;
  group: RunGroupKeys;
  max?: Maybe<RunMaxAggregate>;
  min?: Maybe<RunMinAggregate>;
  sum?: Maybe<RunSumAggregate>;
};

/** Columns of Run that a query can group by */
export enum RunGroupByColumn {
  CompletionTokens = 'completionTokens',
  Error = 'error',
  FinishedAt = 'finishedAt',
  Id = 'id',
  Output = 'output',
  PromptTokens = 'promptTokens',
  StartedAt = 'startedAt',
  Status = 'status',
  TaskId = 'taskId',
  TotalTokens = 'totalTokens',
  TriggerId = 'triggerId'
}

/** The grouped column values of one Run group. A column the query did not group by is null. */
export type RunGroupKeys = {
  completionTokens?: Maybe<Scalars['Int']['output']>;
  error?: Maybe<Scalars['String']['output']>;
  finishedAt?: Maybe<Scalars['DateTime']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  output?: Maybe<Scalars['String']['output']>;
  promptTokens?: Maybe<Scalars['Int']['output']>;
  startedAt?: Maybe<Scalars['DateTime']['output']>;
  status?: Maybe<RunsStatusEnum>;
  taskId?: Maybe<Scalars['String']['output']>;
  totalTokens?: Maybe<Scalars['Int']['output']>;
  triggerId?: Maybe<Scalars['String']['output']>;
};

/** Filters Run groups by their aggregated values */
export type RunHaving = {
  avg?: InputMaybe<RunAvgHaving>;
  /** Filters groups by how many rows they contain */
  count?: InputMaybe<AggregateNumberFilter>;
  countDistinct?: InputMaybe<RunCountDistinctHaving>;
  countNonNull?: InputMaybe<RunCountNonNullHaving>;
  max?: InputMaybe<RunMaxHaving>;
  min?: InputMaybe<RunMinHaving>;
  sum?: InputMaybe<RunSumHaving>;
};

export type RunListRelationFilter = {
  /** Every related row matches */
  every?: InputMaybe<RunFilters>;
  /** No related row matches */
  none?: InputMaybe<RunFilters>;
  /** At least one related row matches */
  some?: InputMaybe<RunFilters>;
};

export type RunMaxAggregate = {
  completionTokens?: Maybe<Scalars['Int']['output']>;
  error?: Maybe<Scalars['String']['output']>;
  finishedAt?: Maybe<Scalars['DateTime']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  output?: Maybe<Scalars['String']['output']>;
  promptTokens?: Maybe<Scalars['Int']['output']>;
  startedAt?: Maybe<Scalars['DateTime']['output']>;
  status?: Maybe<RunsStatusEnum>;
  taskId?: Maybe<Scalars['String']['output']>;
  totalTokens?: Maybe<Scalars['Int']['output']>;
  triggerId?: Maybe<Scalars['String']['output']>;
};

export type RunMaxHaving = {
  completionTokens?: InputMaybe<AggregateNumberFilter>;
  promptTokens?: InputMaybe<AggregateNumberFilter>;
  totalTokens?: InputMaybe<AggregateNumberFilter>;
};

export type RunMinAggregate = {
  completionTokens?: Maybe<Scalars['Int']['output']>;
  error?: Maybe<Scalars['String']['output']>;
  finishedAt?: Maybe<Scalars['DateTime']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  output?: Maybe<Scalars['String']['output']>;
  promptTokens?: Maybe<Scalars['Int']['output']>;
  startedAt?: Maybe<Scalars['DateTime']['output']>;
  status?: Maybe<RunsStatusEnum>;
  taskId?: Maybe<Scalars['String']['output']>;
  totalTokens?: Maybe<Scalars['Int']['output']>;
  triggerId?: Maybe<Scalars['String']['output']>;
};

export type RunMinHaving = {
  completionTokens?: InputMaybe<AggregateNumberFilter>;
  promptTokens?: InputMaybe<AggregateNumberFilter>;
  totalTokens?: InputMaybe<AggregateNumberFilter>;
};

export type RunOrderBy = {
  completionTokens?: InputMaybe<InnerOrder>;
  error?: InputMaybe<InnerOrder>;
  finishedAt?: InputMaybe<InnerOrder>;
  id?: InputMaybe<InnerOrder>;
  output?: InputMaybe<InnerOrder>;
  promptTokens?: InputMaybe<InnerOrder>;
  startedAt?: InputMaybe<InnerOrder>;
  status?: InputMaybe<InnerOrder>;
  /** Order by columns of the related task row */
  task?: InputMaybe<TaskOrderBy>;
  taskId?: InputMaybe<InnerOrder>;
  toolCalls?: InputMaybe<InnerOrder>;
  totalTokens?: InputMaybe<InnerOrder>;
  /** Order by columns of the related trigger row */
  trigger?: InputMaybe<TriggerOrderBy>;
  triggerId?: InputMaybe<InnerOrder>;
};

export type RunStep = {
  branch: Scalars['String']['output'];
  completionTokens: Scalars['Int']['output'];
  /** Opaque cursor of this row's position in the query's ordering. Pass it as `after` to resume from here. Only set on rows returned by a list query. */
  cursor?: Maybe<Scalars['String']['output']>;
  depth: Scalars['Int']['output'];
  error: Scalars['String']['output'];
  finishedAt?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['String']['output'];
  kind: Scalars['String']['output'];
  name: Scalars['String']['output'];
  output: Scalars['String']['output'];
  position: Scalars['Int']['output'];
  promptTokens: Scalars['Int']['output'];
  run: Run;
  runId: Scalars['String']['output'];
  startedAt: Scalars['DateTime']['output'];
  status: RunStepsStatusEnum;
  stepId?: Maybe<Scalars['String']['output']>;
  toolCalls?: Maybe<Scalars['JSON']['output']>;
  totalTokens: Scalars['Int']['output'];
};


export type RunStepRunArgs = {
  where?: InputMaybe<RunFilters>;
};

export type RunStepAggregate = {
  avg?: Maybe<RunStepAvgAggregate>;
  count: Scalars['Int']['output'];
  countDistinct?: Maybe<RunStepCountDistinctAggregate>;
  countNonNull?: Maybe<RunStepCountNonNullAggregate>;
  max?: Maybe<RunStepMaxAggregate>;
  min?: Maybe<RunStepMinAggregate>;
  sum?: Maybe<RunStepSumAggregate>;
};

export type RunStepAvgAggregate = {
  completionTokens?: Maybe<Scalars['Float']['output']>;
  depth?: Maybe<Scalars['Float']['output']>;
  position?: Maybe<Scalars['Float']['output']>;
  promptTokens?: Maybe<Scalars['Float']['output']>;
  totalTokens?: Maybe<Scalars['Float']['output']>;
};

export type RunStepAvgHaving = {
  completionTokens?: InputMaybe<AggregateNumberFilter>;
  depth?: InputMaybe<AggregateNumberFilter>;
  position?: InputMaybe<AggregateNumberFilter>;
  promptTokens?: InputMaybe<AggregateNumberFilter>;
  totalTokens?: InputMaybe<AggregateNumberFilter>;
};

export type RunStepCountDistinctAggregate = {
  branch: Scalars['Int']['output'];
  completionTokens: Scalars['Int']['output'];
  depth: Scalars['Int']['output'];
  error: Scalars['Int']['output'];
  finishedAt: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  kind: Scalars['Int']['output'];
  name: Scalars['Int']['output'];
  output: Scalars['Int']['output'];
  position: Scalars['Int']['output'];
  promptTokens: Scalars['Int']['output'];
  runId: Scalars['Int']['output'];
  startedAt: Scalars['Int']['output'];
  status: Scalars['Int']['output'];
  stepId: Scalars['Int']['output'];
  totalTokens: Scalars['Int']['output'];
};

export type RunStepCountDistinctHaving = {
  branch?: InputMaybe<AggregateNumberFilter>;
  completionTokens?: InputMaybe<AggregateNumberFilter>;
  depth?: InputMaybe<AggregateNumberFilter>;
  error?: InputMaybe<AggregateNumberFilter>;
  finishedAt?: InputMaybe<AggregateNumberFilter>;
  id?: InputMaybe<AggregateNumberFilter>;
  kind?: InputMaybe<AggregateNumberFilter>;
  name?: InputMaybe<AggregateNumberFilter>;
  output?: InputMaybe<AggregateNumberFilter>;
  position?: InputMaybe<AggregateNumberFilter>;
  promptTokens?: InputMaybe<AggregateNumberFilter>;
  runId?: InputMaybe<AggregateNumberFilter>;
  startedAt?: InputMaybe<AggregateNumberFilter>;
  status?: InputMaybe<AggregateNumberFilter>;
  stepId?: InputMaybe<AggregateNumberFilter>;
  totalTokens?: InputMaybe<AggregateNumberFilter>;
};

export type RunStepCountNonNullAggregate = {
  branch: Scalars['Int']['output'];
  completionTokens: Scalars['Int']['output'];
  depth: Scalars['Int']['output'];
  error: Scalars['Int']['output'];
  finishedAt: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  kind: Scalars['Int']['output'];
  name: Scalars['Int']['output'];
  output: Scalars['Int']['output'];
  position: Scalars['Int']['output'];
  promptTokens: Scalars['Int']['output'];
  runId: Scalars['Int']['output'];
  startedAt: Scalars['Int']['output'];
  status: Scalars['Int']['output'];
  stepId: Scalars['Int']['output'];
  toolCalls: Scalars['Int']['output'];
  totalTokens: Scalars['Int']['output'];
};

export type RunStepCountNonNullHaving = {
  branch?: InputMaybe<AggregateNumberFilter>;
  completionTokens?: InputMaybe<AggregateNumberFilter>;
  depth?: InputMaybe<AggregateNumberFilter>;
  error?: InputMaybe<AggregateNumberFilter>;
  finishedAt?: InputMaybe<AggregateNumberFilter>;
  id?: InputMaybe<AggregateNumberFilter>;
  kind?: InputMaybe<AggregateNumberFilter>;
  name?: InputMaybe<AggregateNumberFilter>;
  output?: InputMaybe<AggregateNumberFilter>;
  position?: InputMaybe<AggregateNumberFilter>;
  promptTokens?: InputMaybe<AggregateNumberFilter>;
  runId?: InputMaybe<AggregateNumberFilter>;
  startedAt?: InputMaybe<AggregateNumberFilter>;
  status?: InputMaybe<AggregateNumberFilter>;
  stepId?: InputMaybe<AggregateNumberFilter>;
  toolCalls?: InputMaybe<AggregateNumberFilter>;
  totalTokens?: InputMaybe<AggregateNumberFilter>;
};

/** Columns of RunStep that a query can be made distinct on */
export enum RunStepDistinctColumn {
  Branch = 'branch',
  CompletionTokens = 'completionTokens',
  Depth = 'depth',
  Error = 'error',
  FinishedAt = 'finishedAt',
  Id = 'id',
  Kind = 'kind',
  Name = 'name',
  Output = 'output',
  Position = 'position',
  PromptTokens = 'promptTokens',
  RunId = 'runId',
  StartedAt = 'startedAt',
  Status = 'status',
  StepId = 'stepId',
  ToolCalls = 'toolCalls',
  TotalTokens = 'totalTokens'
}

export type RunStepFilters = {
  /** Every branch matches */
  AND?: InputMaybe<Array<RunStepFilters>>;
  /** Negates the nested filters */
  NOT?: InputMaybe<RunStepFilters>;
  /** At least one branch matches; ANDed with any sibling fields */
  OR?: InputMaybe<Array<RunStepFilters>>;
  branch?: InputMaybe<StringFilter>;
  completionTokens?: InputMaybe<IntFilter>;
  depth?: InputMaybe<IntFilter>;
  error?: InputMaybe<StringFilter>;
  finishedAt?: InputMaybe<DateTimeFilter>;
  id?: InputMaybe<StringFilter>;
  kind?: InputMaybe<StringFilter>;
  name?: InputMaybe<StringFilter>;
  output?: InputMaybe<StringFilter>;
  position?: InputMaybe<IntFilter>;
  promptTokens?: InputMaybe<IntFilter>;
  /** Matches rows whose run matches these filters */
  run?: InputMaybe<RunFilters>;
  runId?: InputMaybe<StringFilter>;
  startedAt?: InputMaybe<DateTimeFilter>;
  status?: InputMaybe<RunStepsStatusEnumFilter>;
  stepId?: InputMaybe<StringFilter>;
  toolCalls?: InputMaybe<JsonFilter>;
  totalTokens?: InputMaybe<IntFilter>;
};

export type RunStepGroupBy = {
  avg?: Maybe<RunStepAvgAggregate>;
  count: Scalars['Int']['output'];
  countDistinct?: Maybe<RunStepCountDistinctAggregate>;
  countNonNull?: Maybe<RunStepCountNonNullAggregate>;
  group: RunStepGroupKeys;
  max?: Maybe<RunStepMaxAggregate>;
  min?: Maybe<RunStepMinAggregate>;
  sum?: Maybe<RunStepSumAggregate>;
};

/** Columns of RunStep that a query can group by */
export enum RunStepGroupByColumn {
  Branch = 'branch',
  CompletionTokens = 'completionTokens',
  Depth = 'depth',
  Error = 'error',
  FinishedAt = 'finishedAt',
  Id = 'id',
  Kind = 'kind',
  Name = 'name',
  Output = 'output',
  Position = 'position',
  PromptTokens = 'promptTokens',
  RunId = 'runId',
  StartedAt = 'startedAt',
  Status = 'status',
  StepId = 'stepId',
  TotalTokens = 'totalTokens'
}

/** The grouped column values of one RunStep group. A column the query did not group by is null. */
export type RunStepGroupKeys = {
  branch?: Maybe<Scalars['String']['output']>;
  completionTokens?: Maybe<Scalars['Int']['output']>;
  depth?: Maybe<Scalars['Int']['output']>;
  error?: Maybe<Scalars['String']['output']>;
  finishedAt?: Maybe<Scalars['DateTime']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  kind?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  output?: Maybe<Scalars['String']['output']>;
  position?: Maybe<Scalars['Int']['output']>;
  promptTokens?: Maybe<Scalars['Int']['output']>;
  runId?: Maybe<Scalars['String']['output']>;
  startedAt?: Maybe<Scalars['DateTime']['output']>;
  status?: Maybe<RunStepsStatusEnum>;
  stepId?: Maybe<Scalars['String']['output']>;
  totalTokens?: Maybe<Scalars['Int']['output']>;
};

/** Filters RunStep groups by their aggregated values */
export type RunStepHaving = {
  avg?: InputMaybe<RunStepAvgHaving>;
  /** Filters groups by how many rows they contain */
  count?: InputMaybe<AggregateNumberFilter>;
  countDistinct?: InputMaybe<RunStepCountDistinctHaving>;
  countNonNull?: InputMaybe<RunStepCountNonNullHaving>;
  max?: InputMaybe<RunStepMaxHaving>;
  min?: InputMaybe<RunStepMinHaving>;
  sum?: InputMaybe<RunStepSumHaving>;
};

export type RunStepListRelationFilter = {
  /** Every related row matches */
  every?: InputMaybe<RunStepFilters>;
  /** No related row matches */
  none?: InputMaybe<RunStepFilters>;
  /** At least one related row matches */
  some?: InputMaybe<RunStepFilters>;
};

export type RunStepMaxAggregate = {
  branch?: Maybe<Scalars['String']['output']>;
  completionTokens?: Maybe<Scalars['Int']['output']>;
  depth?: Maybe<Scalars['Int']['output']>;
  error?: Maybe<Scalars['String']['output']>;
  finishedAt?: Maybe<Scalars['DateTime']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  kind?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  output?: Maybe<Scalars['String']['output']>;
  position?: Maybe<Scalars['Int']['output']>;
  promptTokens?: Maybe<Scalars['Int']['output']>;
  runId?: Maybe<Scalars['String']['output']>;
  startedAt?: Maybe<Scalars['DateTime']['output']>;
  status?: Maybe<RunStepsStatusEnum>;
  stepId?: Maybe<Scalars['String']['output']>;
  totalTokens?: Maybe<Scalars['Int']['output']>;
};

export type RunStepMaxHaving = {
  completionTokens?: InputMaybe<AggregateNumberFilter>;
  depth?: InputMaybe<AggregateNumberFilter>;
  position?: InputMaybe<AggregateNumberFilter>;
  promptTokens?: InputMaybe<AggregateNumberFilter>;
  totalTokens?: InputMaybe<AggregateNumberFilter>;
};

export type RunStepMinAggregate = {
  branch?: Maybe<Scalars['String']['output']>;
  completionTokens?: Maybe<Scalars['Int']['output']>;
  depth?: Maybe<Scalars['Int']['output']>;
  error?: Maybe<Scalars['String']['output']>;
  finishedAt?: Maybe<Scalars['DateTime']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  kind?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  output?: Maybe<Scalars['String']['output']>;
  position?: Maybe<Scalars['Int']['output']>;
  promptTokens?: Maybe<Scalars['Int']['output']>;
  runId?: Maybe<Scalars['String']['output']>;
  startedAt?: Maybe<Scalars['DateTime']['output']>;
  status?: Maybe<RunStepsStatusEnum>;
  stepId?: Maybe<Scalars['String']['output']>;
  totalTokens?: Maybe<Scalars['Int']['output']>;
};

export type RunStepMinHaving = {
  completionTokens?: InputMaybe<AggregateNumberFilter>;
  depth?: InputMaybe<AggregateNumberFilter>;
  position?: InputMaybe<AggregateNumberFilter>;
  promptTokens?: InputMaybe<AggregateNumberFilter>;
  totalTokens?: InputMaybe<AggregateNumberFilter>;
};

export type RunStepOrderBy = {
  branch?: InputMaybe<InnerOrder>;
  completionTokens?: InputMaybe<InnerOrder>;
  depth?: InputMaybe<InnerOrder>;
  error?: InputMaybe<InnerOrder>;
  finishedAt?: InputMaybe<InnerOrder>;
  id?: InputMaybe<InnerOrder>;
  kind?: InputMaybe<InnerOrder>;
  name?: InputMaybe<InnerOrder>;
  output?: InputMaybe<InnerOrder>;
  position?: InputMaybe<InnerOrder>;
  promptTokens?: InputMaybe<InnerOrder>;
  /** Order by columns of the related run row */
  run?: InputMaybe<RunOrderBy>;
  runId?: InputMaybe<InnerOrder>;
  startedAt?: InputMaybe<InnerOrder>;
  status?: InputMaybe<InnerOrder>;
  stepId?: InputMaybe<InnerOrder>;
  toolCalls?: InputMaybe<InnerOrder>;
  totalTokens?: InputMaybe<InnerOrder>;
};

export type RunStepSumAggregate = {
  completionTokens?: Maybe<Scalars['Float']['output']>;
  depth?: Maybe<Scalars['Float']['output']>;
  position?: Maybe<Scalars['Float']['output']>;
  promptTokens?: Maybe<Scalars['Float']['output']>;
  totalTokens?: Maybe<Scalars['Float']['output']>;
};

export type RunStepSumHaving = {
  completionTokens?: InputMaybe<AggregateNumberFilter>;
  depth?: InputMaybe<AggregateNumberFilter>;
  position?: InputMaybe<AggregateNumberFilter>;
  promptTokens?: InputMaybe<AggregateNumberFilter>;
  totalTokens?: InputMaybe<AggregateNumberFilter>;
};

export enum RunStepsStatusEnum {
  /** Value: error */
  Error = 'error',
  /** Value: ok */
  Ok = 'ok',
  /** Value: running */
  Running = 'running',
  /** Value: skipped */
  Skipped = 'skipped',
  /** Value: stopped */
  Stopped = 'stopped'
}

export type RunStepsStatusEnumFilter = {
  /** Every branch matches */
  AND?: InputMaybe<Array<RunStepsStatusEnumFilter>>;
  /** Negates the nested operators */
  NOT?: InputMaybe<RunStepsStatusEnumFilter>;
  /** At least one branch matches; ANDed with any sibling operators */
  OR?: InputMaybe<Array<RunStepsStatusEnumFilter>>;
  /** Matches values containing the given string. `%`, `_` and `\` are matched literally. */
  contains?: InputMaybe<Scalars['String']['input']>;
  /** Matches values ending with the given string. `%`, `_` and `\` are matched literally. */
  endsWith?: InputMaybe<Scalars['String']['input']>;
  /** Equal to */
  eq?: InputMaybe<RunStepsStatusEnum>;
  /** Greater than */
  gt?: InputMaybe<RunStepsStatusEnum>;
  /** Greater than or equal to */
  gte?: InputMaybe<RunStepsStatusEnum>;
  /** Case-insensitive `contains`. */
  iContains?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `endsWith`. */
  iEndsWith?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `startsWith`. */
  iStartsWith?: InputMaybe<Scalars['String']['input']>;
  ilike?: InputMaybe<Scalars['String']['input']>;
  /** Matches any one of these values (SQL `IN`) */
  inArray?: InputMaybe<Array<RunStepsStatusEnum>>;
  /** When true, every comparison operator in this object matches case-insensitively — `eq`, `ne`, the ordering operators, `inArray`/`notInArray` and the pattern operators all compare `lower(column)` against `lower(operand)`. Applies only to the operators beside it; a nested `AND`/`OR`/`NOT` branch sets its own. */
  insensitive?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is not NULL */
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is NULL */
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  like?: InputMaybe<Scalars['String']['input']>;
  /** Less than */
  lt?: InputMaybe<RunStepsStatusEnum>;
  /** Less than or equal to */
  lte?: InputMaybe<RunStepsStatusEnum>;
  /** Not equal to */
  ne?: InputMaybe<RunStepsStatusEnum>;
  notIlike?: InputMaybe<Scalars['String']['input']>;
  /** Matches none of these values (SQL `NOT IN`) */
  notInArray?: InputMaybe<Array<RunStepsStatusEnum>>;
  notLike?: InputMaybe<Scalars['String']['input']>;
  /** Matches values starting with the given string. `%`, `_` and `\` are matched literally. */
  startsWith?: InputMaybe<Scalars['String']['input']>;
};

export type RunSumAggregate = {
  completionTokens?: Maybe<Scalars['Float']['output']>;
  promptTokens?: Maybe<Scalars['Float']['output']>;
  totalTokens?: Maybe<Scalars['Float']['output']>;
};

export type RunSumHaving = {
  completionTokens?: InputMaybe<AggregateNumberFilter>;
  promptTokens?: InputMaybe<AggregateNumberFilter>;
  totalTokens?: InputMaybe<AggregateNumberFilter>;
};

export enum RunsStatusEnum {
  /** Value: error */
  Error = 'error',
  /** Value: ok */
  Ok = 'ok',
  /** Value: running */
  Running = 'running',
  /** Value: stopped */
  Stopped = 'stopped'
}

export type RunsStatusEnumFilter = {
  /** Every branch matches */
  AND?: InputMaybe<Array<RunsStatusEnumFilter>>;
  /** Negates the nested operators */
  NOT?: InputMaybe<RunsStatusEnumFilter>;
  /** At least one branch matches; ANDed with any sibling operators */
  OR?: InputMaybe<Array<RunsStatusEnumFilter>>;
  /** Matches values containing the given string. `%`, `_` and `\` are matched literally. */
  contains?: InputMaybe<Scalars['String']['input']>;
  /** Matches values ending with the given string. `%`, `_` and `\` are matched literally. */
  endsWith?: InputMaybe<Scalars['String']['input']>;
  /** Equal to */
  eq?: InputMaybe<RunsStatusEnum>;
  /** Greater than */
  gt?: InputMaybe<RunsStatusEnum>;
  /** Greater than or equal to */
  gte?: InputMaybe<RunsStatusEnum>;
  /** Case-insensitive `contains`. */
  iContains?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `endsWith`. */
  iEndsWith?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `startsWith`. */
  iStartsWith?: InputMaybe<Scalars['String']['input']>;
  ilike?: InputMaybe<Scalars['String']['input']>;
  /** Matches any one of these values (SQL `IN`) */
  inArray?: InputMaybe<Array<RunsStatusEnum>>;
  /** When true, every comparison operator in this object matches case-insensitively — `eq`, `ne`, the ordering operators, `inArray`/`notInArray` and the pattern operators all compare `lower(column)` against `lower(operand)`. Applies only to the operators beside it; a nested `AND`/`OR`/`NOT` branch sets its own. */
  insensitive?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is not NULL */
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is NULL */
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  like?: InputMaybe<Scalars['String']['input']>;
  /** Less than */
  lt?: InputMaybe<RunsStatusEnum>;
  /** Less than or equal to */
  lte?: InputMaybe<RunsStatusEnum>;
  /** Not equal to */
  ne?: InputMaybe<RunsStatusEnum>;
  notIlike?: InputMaybe<Scalars['String']['input']>;
  /** Matches none of these values (SQL `NOT IN`) */
  notInArray?: InputMaybe<Array<RunsStatusEnum>>;
  notLike?: InputMaybe<Scalars['String']['input']>;
  /** Matches values starting with the given string. `%`, `_` and `\` are matched literally. */
  startsWith?: InputMaybe<Scalars['String']['input']>;
};

/** A cron trigger that is currently armed, and when it next fires. */
export type ScheduleEntry = {
  cron: Scalars['String']['output'];
  nextRun?: Maybe<Scalars['String']['output']>;
  taskId: Scalars['String']['output'];
  triggerId: Scalars['String']['output'];
};

export type Setting = {
  baseUrl: Scalars['String']['output'];
  /** Opaque cursor of this row's position in the query's ordering. Pass it as `after` to resume from here. Only set on rows returned by a list query. */
  cursor?: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  maxTokens: Scalars['Int']['output'];
  maxToolIterations: Scalars['Int']['output'];
  model: Scalars['String']['output'];
  systemPrompt: Scalars['String']['output'];
  temperature: Scalars['Float']['output'];
  toolDiscovery: SettingsToolDiscoveryEnum;
  toolSelectModel: Scalars['String']['output'];
};

export type SettingAggregate = {
  avg?: Maybe<SettingAvgAggregate>;
  count: Scalars['Int']['output'];
  countDistinct?: Maybe<SettingCountDistinctAggregate>;
  countNonNull?: Maybe<SettingCountNonNullAggregate>;
  max?: Maybe<SettingMaxAggregate>;
  min?: Maybe<SettingMinAggregate>;
  sum?: Maybe<SettingSumAggregate>;
};

export type SettingAvgAggregate = {
  maxTokens?: Maybe<Scalars['Float']['output']>;
  maxToolIterations?: Maybe<Scalars['Float']['output']>;
  temperature?: Maybe<Scalars['Float']['output']>;
};

export type SettingAvgHaving = {
  maxTokens?: InputMaybe<AggregateNumberFilter>;
  maxToolIterations?: InputMaybe<AggregateNumberFilter>;
  temperature?: InputMaybe<AggregateNumberFilter>;
};

export type SettingCountDistinctAggregate = {
  baseUrl: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  maxTokens: Scalars['Int']['output'];
  maxToolIterations: Scalars['Int']['output'];
  model: Scalars['Int']['output'];
  systemPrompt: Scalars['Int']['output'];
  temperature: Scalars['Int']['output'];
  toolDiscovery: Scalars['Int']['output'];
  toolSelectModel: Scalars['Int']['output'];
};

export type SettingCountDistinctHaving = {
  baseUrl?: InputMaybe<AggregateNumberFilter>;
  id?: InputMaybe<AggregateNumberFilter>;
  maxTokens?: InputMaybe<AggregateNumberFilter>;
  maxToolIterations?: InputMaybe<AggregateNumberFilter>;
  model?: InputMaybe<AggregateNumberFilter>;
  systemPrompt?: InputMaybe<AggregateNumberFilter>;
  temperature?: InputMaybe<AggregateNumberFilter>;
  toolDiscovery?: InputMaybe<AggregateNumberFilter>;
  toolSelectModel?: InputMaybe<AggregateNumberFilter>;
};

export type SettingCountNonNullAggregate = {
  baseUrl: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  maxTokens: Scalars['Int']['output'];
  maxToolIterations: Scalars['Int']['output'];
  model: Scalars['Int']['output'];
  systemPrompt: Scalars['Int']['output'];
  temperature: Scalars['Int']['output'];
  toolDiscovery: Scalars['Int']['output'];
  toolSelectModel: Scalars['Int']['output'];
};

export type SettingCountNonNullHaving = {
  baseUrl?: InputMaybe<AggregateNumberFilter>;
  id?: InputMaybe<AggregateNumberFilter>;
  maxTokens?: InputMaybe<AggregateNumberFilter>;
  maxToolIterations?: InputMaybe<AggregateNumberFilter>;
  model?: InputMaybe<AggregateNumberFilter>;
  systemPrompt?: InputMaybe<AggregateNumberFilter>;
  temperature?: InputMaybe<AggregateNumberFilter>;
  toolDiscovery?: InputMaybe<AggregateNumberFilter>;
  toolSelectModel?: InputMaybe<AggregateNumberFilter>;
};

/** Columns of Setting that a query can be made distinct on */
export enum SettingDistinctColumn {
  BaseUrl = 'baseUrl',
  Id = 'id',
  MaxTokens = 'maxTokens',
  MaxToolIterations = 'maxToolIterations',
  Model = 'model',
  SystemPrompt = 'systemPrompt',
  Temperature = 'temperature',
  ToolDiscovery = 'toolDiscovery',
  ToolSelectModel = 'toolSelectModel'
}

export type SettingFilters = {
  /** Every branch matches */
  AND?: InputMaybe<Array<SettingFilters>>;
  /** Negates the nested filters */
  NOT?: InputMaybe<SettingFilters>;
  /** At least one branch matches; ANDed with any sibling fields */
  OR?: InputMaybe<Array<SettingFilters>>;
  baseUrl?: InputMaybe<StringFilter>;
  id?: InputMaybe<StringFilter>;
  maxTokens?: InputMaybe<IntFilter>;
  maxToolIterations?: InputMaybe<IntFilter>;
  model?: InputMaybe<StringFilter>;
  systemPrompt?: InputMaybe<StringFilter>;
  temperature?: InputMaybe<FloatFilter>;
  toolDiscovery?: InputMaybe<SettingsToolDiscoveryEnumFilter>;
  toolSelectModel?: InputMaybe<StringFilter>;
};

export type SettingGroupBy = {
  avg?: Maybe<SettingAvgAggregate>;
  count: Scalars['Int']['output'];
  countDistinct?: Maybe<SettingCountDistinctAggregate>;
  countNonNull?: Maybe<SettingCountNonNullAggregate>;
  group: SettingGroupKeys;
  max?: Maybe<SettingMaxAggregate>;
  min?: Maybe<SettingMinAggregate>;
  sum?: Maybe<SettingSumAggregate>;
};

/** Columns of Setting that a query can group by */
export enum SettingGroupByColumn {
  BaseUrl = 'baseUrl',
  Id = 'id',
  MaxTokens = 'maxTokens',
  MaxToolIterations = 'maxToolIterations',
  Model = 'model',
  SystemPrompt = 'systemPrompt',
  Temperature = 'temperature',
  ToolDiscovery = 'toolDiscovery',
  ToolSelectModel = 'toolSelectModel'
}

/** The grouped column values of one Setting group. A column the query did not group by is null. */
export type SettingGroupKeys = {
  baseUrl?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  maxTokens?: Maybe<Scalars['Int']['output']>;
  maxToolIterations?: Maybe<Scalars['Int']['output']>;
  model?: Maybe<Scalars['String']['output']>;
  systemPrompt?: Maybe<Scalars['String']['output']>;
  temperature?: Maybe<Scalars['Float']['output']>;
  toolDiscovery?: Maybe<SettingsToolDiscoveryEnum>;
  toolSelectModel?: Maybe<Scalars['String']['output']>;
};

/** Filters Setting groups by their aggregated values */
export type SettingHaving = {
  avg?: InputMaybe<SettingAvgHaving>;
  /** Filters groups by how many rows they contain */
  count?: InputMaybe<AggregateNumberFilter>;
  countDistinct?: InputMaybe<SettingCountDistinctHaving>;
  countNonNull?: InputMaybe<SettingCountNonNullHaving>;
  max?: InputMaybe<SettingMaxHaving>;
  min?: InputMaybe<SettingMinHaving>;
  sum?: InputMaybe<SettingSumHaving>;
};

export type SettingMaxAggregate = {
  baseUrl?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  maxTokens?: Maybe<Scalars['Int']['output']>;
  maxToolIterations?: Maybe<Scalars['Int']['output']>;
  model?: Maybe<Scalars['String']['output']>;
  systemPrompt?: Maybe<Scalars['String']['output']>;
  temperature?: Maybe<Scalars['Float']['output']>;
  toolDiscovery?: Maybe<SettingsToolDiscoveryEnum>;
  toolSelectModel?: Maybe<Scalars['String']['output']>;
};

export type SettingMaxHaving = {
  maxTokens?: InputMaybe<AggregateNumberFilter>;
  maxToolIterations?: InputMaybe<AggregateNumberFilter>;
  temperature?: InputMaybe<AggregateNumberFilter>;
};

export type SettingMinAggregate = {
  baseUrl?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  maxTokens?: Maybe<Scalars['Int']['output']>;
  maxToolIterations?: Maybe<Scalars['Int']['output']>;
  model?: Maybe<Scalars['String']['output']>;
  systemPrompt?: Maybe<Scalars['String']['output']>;
  temperature?: Maybe<Scalars['Float']['output']>;
  toolDiscovery?: Maybe<SettingsToolDiscoveryEnum>;
  toolSelectModel?: Maybe<Scalars['String']['output']>;
};

export type SettingMinHaving = {
  maxTokens?: InputMaybe<AggregateNumberFilter>;
  maxToolIterations?: InputMaybe<AggregateNumberFilter>;
  temperature?: InputMaybe<AggregateNumberFilter>;
};

export type SettingOrderBy = {
  baseUrl?: InputMaybe<InnerOrder>;
  id?: InputMaybe<InnerOrder>;
  maxTokens?: InputMaybe<InnerOrder>;
  maxToolIterations?: InputMaybe<InnerOrder>;
  model?: InputMaybe<InnerOrder>;
  systemPrompt?: InputMaybe<InnerOrder>;
  temperature?: InputMaybe<InnerOrder>;
  toolDiscovery?: InputMaybe<InnerOrder>;
  toolSelectModel?: InputMaybe<InnerOrder>;
};

export type SettingSumAggregate = {
  maxTokens?: Maybe<Scalars['Float']['output']>;
  maxToolIterations?: Maybe<Scalars['Float']['output']>;
  temperature?: Maybe<Scalars['Float']['output']>;
};

export type SettingSumHaving = {
  maxTokens?: InputMaybe<AggregateNumberFilter>;
  maxToolIterations?: InputMaybe<AggregateNumberFilter>;
  temperature?: InputMaybe<AggregateNumberFilter>;
};

export enum SettingsToolDiscoveryEnum {
  /** Value: eager */
  Eager = 'eager',
  /** Value: ondemand */
  Ondemand = 'ondemand'
}

export type SettingsToolDiscoveryEnumFilter = {
  /** Every branch matches */
  AND?: InputMaybe<Array<SettingsToolDiscoveryEnumFilter>>;
  /** Negates the nested operators */
  NOT?: InputMaybe<SettingsToolDiscoveryEnumFilter>;
  /** At least one branch matches; ANDed with any sibling operators */
  OR?: InputMaybe<Array<SettingsToolDiscoveryEnumFilter>>;
  /** Matches values containing the given string. `%`, `_` and `\` are matched literally. */
  contains?: InputMaybe<Scalars['String']['input']>;
  /** Matches values ending with the given string. `%`, `_` and `\` are matched literally. */
  endsWith?: InputMaybe<Scalars['String']['input']>;
  /** Equal to */
  eq?: InputMaybe<SettingsToolDiscoveryEnum>;
  /** Greater than */
  gt?: InputMaybe<SettingsToolDiscoveryEnum>;
  /** Greater than or equal to */
  gte?: InputMaybe<SettingsToolDiscoveryEnum>;
  /** Case-insensitive `contains`. */
  iContains?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `endsWith`. */
  iEndsWith?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `startsWith`. */
  iStartsWith?: InputMaybe<Scalars['String']['input']>;
  ilike?: InputMaybe<Scalars['String']['input']>;
  /** Matches any one of these values (SQL `IN`) */
  inArray?: InputMaybe<Array<SettingsToolDiscoveryEnum>>;
  /** When true, every comparison operator in this object matches case-insensitively — `eq`, `ne`, the ordering operators, `inArray`/`notInArray` and the pattern operators all compare `lower(column)` against `lower(operand)`. Applies only to the operators beside it; a nested `AND`/`OR`/`NOT` branch sets its own. */
  insensitive?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is not NULL */
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is NULL */
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  like?: InputMaybe<Scalars['String']['input']>;
  /** Less than */
  lt?: InputMaybe<SettingsToolDiscoveryEnum>;
  /** Less than or equal to */
  lte?: InputMaybe<SettingsToolDiscoveryEnum>;
  /** Not equal to */
  ne?: InputMaybe<SettingsToolDiscoveryEnum>;
  notIlike?: InputMaybe<Scalars['String']['input']>;
  /** Matches none of these values (SQL `NOT IN`) */
  notInArray?: InputMaybe<Array<SettingsToolDiscoveryEnum>>;
  notLike?: InputMaybe<Scalars['String']['input']>;
  /** Matches values starting with the given string. `%`, `_` and `\` are matched literally. */
  startsWith?: InputMaybe<Scalars['String']['input']>;
};

export type Step = {
  branch: Scalars['String']['output'];
  cases?: Maybe<Scalars['JSON']['output']>;
  context: StepsContextEnum;
  createdAt: Scalars['DateTime']['output'];
  /** Opaque cursor of this row's position in the query's ordering. Pass it as `after` to resume from here. Only set on rows returned by a list query. */
  cursor?: Maybe<Scalars['String']['output']>;
  enabled: Scalars['Boolean']['output'];
  id: Scalars['String']['output'];
  kind: StepsKindEnum;
  model: Scalars['String']['output'];
  name: Scalars['String']['output'];
  parentId?: Maybe<Scalars['String']['output']>;
  position: Scalars['Int']['output'];
  prompt: Scalars['String']['output'];
  systemPrompt: Scalars['String']['output'];
  task: Task;
  taskId: Scalars['String']['output'];
};


export type StepTaskArgs = {
  where?: InputMaybe<TaskFilters>;
};

export type StepAggregate = {
  avg?: Maybe<StepAvgAggregate>;
  count: Scalars['Int']['output'];
  countDistinct?: Maybe<StepCountDistinctAggregate>;
  countNonNull?: Maybe<StepCountNonNullAggregate>;
  max?: Maybe<StepMaxAggregate>;
  min?: Maybe<StepMinAggregate>;
  sum?: Maybe<StepSumAggregate>;
};

export type StepAvgAggregate = {
  position?: Maybe<Scalars['Float']['output']>;
};

export type StepAvgHaving = {
  position?: InputMaybe<AggregateNumberFilter>;
};

/** One arm of a decision: the case it answers to, and what runs if it does. */
export type StepBranchInput = {
  /** One of the decision's own cases, or "default" for the fall-through arm. */
  case: Scalars['String']['input'];
  steps: Array<StepInput>;
};

export type StepCountDistinctAggregate = {
  branch: Scalars['Int']['output'];
  context: Scalars['Int']['output'];
  createdAt: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  kind: Scalars['Int']['output'];
  model: Scalars['Int']['output'];
  name: Scalars['Int']['output'];
  parentId: Scalars['Int']['output'];
  position: Scalars['Int']['output'];
  prompt: Scalars['Int']['output'];
  systemPrompt: Scalars['Int']['output'];
  taskId: Scalars['Int']['output'];
};

export type StepCountDistinctHaving = {
  branch?: InputMaybe<AggregateNumberFilter>;
  context?: InputMaybe<AggregateNumberFilter>;
  createdAt?: InputMaybe<AggregateNumberFilter>;
  id?: InputMaybe<AggregateNumberFilter>;
  kind?: InputMaybe<AggregateNumberFilter>;
  model?: InputMaybe<AggregateNumberFilter>;
  name?: InputMaybe<AggregateNumberFilter>;
  parentId?: InputMaybe<AggregateNumberFilter>;
  position?: InputMaybe<AggregateNumberFilter>;
  prompt?: InputMaybe<AggregateNumberFilter>;
  systemPrompt?: InputMaybe<AggregateNumberFilter>;
  taskId?: InputMaybe<AggregateNumberFilter>;
};

export type StepCountNonNullAggregate = {
  branch: Scalars['Int']['output'];
  cases: Scalars['Int']['output'];
  context: Scalars['Int']['output'];
  createdAt: Scalars['Int']['output'];
  enabled: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  kind: Scalars['Int']['output'];
  model: Scalars['Int']['output'];
  name: Scalars['Int']['output'];
  parentId: Scalars['Int']['output'];
  position: Scalars['Int']['output'];
  prompt: Scalars['Int']['output'];
  systemPrompt: Scalars['Int']['output'];
  taskId: Scalars['Int']['output'];
};

export type StepCountNonNullHaving = {
  branch?: InputMaybe<AggregateNumberFilter>;
  cases?: InputMaybe<AggregateNumberFilter>;
  context?: InputMaybe<AggregateNumberFilter>;
  createdAt?: InputMaybe<AggregateNumberFilter>;
  enabled?: InputMaybe<AggregateNumberFilter>;
  id?: InputMaybe<AggregateNumberFilter>;
  kind?: InputMaybe<AggregateNumberFilter>;
  model?: InputMaybe<AggregateNumberFilter>;
  name?: InputMaybe<AggregateNumberFilter>;
  parentId?: InputMaybe<AggregateNumberFilter>;
  position?: InputMaybe<AggregateNumberFilter>;
  prompt?: InputMaybe<AggregateNumberFilter>;
  systemPrompt?: InputMaybe<AggregateNumberFilter>;
  taskId?: InputMaybe<AggregateNumberFilter>;
};

/** Columns of Step that a query can be made distinct on */
export enum StepDistinctColumn {
  Branch = 'branch',
  Cases = 'cases',
  Context = 'context',
  CreatedAt = 'createdAt',
  Enabled = 'enabled',
  Id = 'id',
  Kind = 'kind',
  Model = 'model',
  Name = 'name',
  ParentId = 'parentId',
  Position = 'position',
  Prompt = 'prompt',
  SystemPrompt = 'systemPrompt',
  TaskId = 'taskId'
}

export type StepFilters = {
  /** Every branch matches */
  AND?: InputMaybe<Array<StepFilters>>;
  /** Negates the nested filters */
  NOT?: InputMaybe<StepFilters>;
  /** At least one branch matches; ANDed with any sibling fields */
  OR?: InputMaybe<Array<StepFilters>>;
  branch?: InputMaybe<StringFilter>;
  cases?: InputMaybe<JsonFilter>;
  context?: InputMaybe<StepsContextEnumFilter>;
  createdAt?: InputMaybe<DateTimeFilter>;
  enabled?: InputMaybe<BooleanFilter>;
  id?: InputMaybe<StringFilter>;
  kind?: InputMaybe<StepsKindEnumFilter>;
  model?: InputMaybe<StringFilter>;
  name?: InputMaybe<StringFilter>;
  parentId?: InputMaybe<StringFilter>;
  position?: InputMaybe<IntFilter>;
  prompt?: InputMaybe<StringFilter>;
  systemPrompt?: InputMaybe<StringFilter>;
  /** Matches rows whose task matches these filters */
  task?: InputMaybe<TaskFilters>;
  taskId?: InputMaybe<StringFilter>;
};

export type StepGroupBy = {
  avg?: Maybe<StepAvgAggregate>;
  count: Scalars['Int']['output'];
  countDistinct?: Maybe<StepCountDistinctAggregate>;
  countNonNull?: Maybe<StepCountNonNullAggregate>;
  group: StepGroupKeys;
  max?: Maybe<StepMaxAggregate>;
  min?: Maybe<StepMinAggregate>;
  sum?: Maybe<StepSumAggregate>;
};

/** Columns of Step that a query can group by */
export enum StepGroupByColumn {
  Branch = 'branch',
  Context = 'context',
  CreatedAt = 'createdAt',
  Enabled = 'enabled',
  Id = 'id',
  Kind = 'kind',
  Model = 'model',
  Name = 'name',
  ParentId = 'parentId',
  Position = 'position',
  Prompt = 'prompt',
  SystemPrompt = 'systemPrompt',
  TaskId = 'taskId'
}

/** The grouped column values of one Step group. A column the query did not group by is null. */
export type StepGroupKeys = {
  branch?: Maybe<Scalars['String']['output']>;
  context?: Maybe<StepsContextEnum>;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  enabled?: Maybe<Scalars['Boolean']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  kind?: Maybe<StepsKindEnum>;
  model?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  parentId?: Maybe<Scalars['String']['output']>;
  position?: Maybe<Scalars['Int']['output']>;
  prompt?: Maybe<Scalars['String']['output']>;
  systemPrompt?: Maybe<Scalars['String']['output']>;
  taskId?: Maybe<Scalars['String']['output']>;
};

/** Filters Step groups by their aggregated values */
export type StepHaving = {
  avg?: InputMaybe<StepAvgHaving>;
  /** Filters groups by how many rows they contain */
  count?: InputMaybe<AggregateNumberFilter>;
  countDistinct?: InputMaybe<StepCountDistinctHaving>;
  countNonNull?: InputMaybe<StepCountNonNullHaving>;
  max?: InputMaybe<StepMaxHaving>;
  min?: InputMaybe<StepMinHaving>;
  sum?: InputMaybe<StepSumHaving>;
};

/** A step of a task's flow, with whatever hangs off it. */
export type StepInput = {
  /** Decision only: what runs under each case. */
  branches?: InputMaybe<Array<StepBranchInput>>;
  /** Decision only, and required for one: the arms it may choose between. */
  cases?: InputMaybe<Array<Scalars['String']['input']>>;
  /** How much of the run so far this step is shown before its own prompt: all (default) | previous | none. Ignored where the prompt places `{{previous}}` or `{{steps.<name>}}` itself. */
  context?: InputMaybe<Scalars['String']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  /** Send back the id of an existing step to edit it in place, so the run history that points at it stays pointed at it. Omit for a new step. */
  id?: InputMaybe<Scalars['String']['input']>;
  /** agent (default) | decision. */
  kind?: InputMaybe<Scalars['String']['input']>;
  /** Empty falls back to the task's, then Settings'. */
  model?: InputMaybe<Scalars['String']['input']>;
  /** What this step is called, in the run history and in `{{steps.<name>}}`. */
  name?: InputMaybe<Scalars['String']['input']>;
  prompt: Scalars['String']['input'];
  systemPrompt?: InputMaybe<Scalars['String']['input']>;
};

export type StepListRelationFilter = {
  /** Every related row matches */
  every?: InputMaybe<StepFilters>;
  /** No related row matches */
  none?: InputMaybe<StepFilters>;
  /** At least one related row matches */
  some?: InputMaybe<StepFilters>;
};

export type StepMaxAggregate = {
  branch?: Maybe<Scalars['String']['output']>;
  context?: Maybe<StepsContextEnum>;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  kind?: Maybe<StepsKindEnum>;
  model?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  parentId?: Maybe<Scalars['String']['output']>;
  position?: Maybe<Scalars['Int']['output']>;
  prompt?: Maybe<Scalars['String']['output']>;
  systemPrompt?: Maybe<Scalars['String']['output']>;
  taskId?: Maybe<Scalars['String']['output']>;
};

export type StepMaxHaving = {
  position?: InputMaybe<AggregateNumberFilter>;
};

export type StepMinAggregate = {
  branch?: Maybe<Scalars['String']['output']>;
  context?: Maybe<StepsContextEnum>;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  kind?: Maybe<StepsKindEnum>;
  model?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  parentId?: Maybe<Scalars['String']['output']>;
  position?: Maybe<Scalars['Int']['output']>;
  prompt?: Maybe<Scalars['String']['output']>;
  systemPrompt?: Maybe<Scalars['String']['output']>;
  taskId?: Maybe<Scalars['String']['output']>;
};

export type StepMinHaving = {
  position?: InputMaybe<AggregateNumberFilter>;
};

export type StepOrderBy = {
  branch?: InputMaybe<InnerOrder>;
  cases?: InputMaybe<InnerOrder>;
  context?: InputMaybe<InnerOrder>;
  createdAt?: InputMaybe<InnerOrder>;
  enabled?: InputMaybe<InnerOrder>;
  id?: InputMaybe<InnerOrder>;
  kind?: InputMaybe<InnerOrder>;
  model?: InputMaybe<InnerOrder>;
  name?: InputMaybe<InnerOrder>;
  parentId?: InputMaybe<InnerOrder>;
  position?: InputMaybe<InnerOrder>;
  prompt?: InputMaybe<InnerOrder>;
  systemPrompt?: InputMaybe<InnerOrder>;
  /** Order by columns of the related task row */
  task?: InputMaybe<TaskOrderBy>;
  taskId?: InputMaybe<InnerOrder>;
};

export type StepSumAggregate = {
  position?: Maybe<Scalars['Float']['output']>;
};

export type StepSumHaving = {
  position?: InputMaybe<AggregateNumberFilter>;
};

export enum StepsContextEnum {
  /** Value: all */
  All = 'all',
  /** Value: none */
  None = 'none',
  /** Value: previous */
  Previous = 'previous'
}

export type StepsContextEnumFilter = {
  /** Every branch matches */
  AND?: InputMaybe<Array<StepsContextEnumFilter>>;
  /** Negates the nested operators */
  NOT?: InputMaybe<StepsContextEnumFilter>;
  /** At least one branch matches; ANDed with any sibling operators */
  OR?: InputMaybe<Array<StepsContextEnumFilter>>;
  /** Matches values containing the given string. `%`, `_` and `\` are matched literally. */
  contains?: InputMaybe<Scalars['String']['input']>;
  /** Matches values ending with the given string. `%`, `_` and `\` are matched literally. */
  endsWith?: InputMaybe<Scalars['String']['input']>;
  /** Equal to */
  eq?: InputMaybe<StepsContextEnum>;
  /** Greater than */
  gt?: InputMaybe<StepsContextEnum>;
  /** Greater than or equal to */
  gte?: InputMaybe<StepsContextEnum>;
  /** Case-insensitive `contains`. */
  iContains?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `endsWith`. */
  iEndsWith?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `startsWith`. */
  iStartsWith?: InputMaybe<Scalars['String']['input']>;
  ilike?: InputMaybe<Scalars['String']['input']>;
  /** Matches any one of these values (SQL `IN`) */
  inArray?: InputMaybe<Array<StepsContextEnum>>;
  /** When true, every comparison operator in this object matches case-insensitively — `eq`, `ne`, the ordering operators, `inArray`/`notInArray` and the pattern operators all compare `lower(column)` against `lower(operand)`. Applies only to the operators beside it; a nested `AND`/`OR`/`NOT` branch sets its own. */
  insensitive?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is not NULL */
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is NULL */
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  like?: InputMaybe<Scalars['String']['input']>;
  /** Less than */
  lt?: InputMaybe<StepsContextEnum>;
  /** Less than or equal to */
  lte?: InputMaybe<StepsContextEnum>;
  /** Not equal to */
  ne?: InputMaybe<StepsContextEnum>;
  notIlike?: InputMaybe<Scalars['String']['input']>;
  /** Matches none of these values (SQL `NOT IN`) */
  notInArray?: InputMaybe<Array<StepsContextEnum>>;
  notLike?: InputMaybe<Scalars['String']['input']>;
  /** Matches values starting with the given string. `%`, `_` and `\` are matched literally. */
  startsWith?: InputMaybe<Scalars['String']['input']>;
};

export enum StepsKindEnum {
  /** Value: agent */
  Agent = 'agent',
  /** Value: decision */
  Decision = 'decision'
}

export type StepsKindEnumFilter = {
  /** Every branch matches */
  AND?: InputMaybe<Array<StepsKindEnumFilter>>;
  /** Negates the nested operators */
  NOT?: InputMaybe<StepsKindEnumFilter>;
  /** At least one branch matches; ANDed with any sibling operators */
  OR?: InputMaybe<Array<StepsKindEnumFilter>>;
  /** Matches values containing the given string. `%`, `_` and `\` are matched literally. */
  contains?: InputMaybe<Scalars['String']['input']>;
  /** Matches values ending with the given string. `%`, `_` and `\` are matched literally. */
  endsWith?: InputMaybe<Scalars['String']['input']>;
  /** Equal to */
  eq?: InputMaybe<StepsKindEnum>;
  /** Greater than */
  gt?: InputMaybe<StepsKindEnum>;
  /** Greater than or equal to */
  gte?: InputMaybe<StepsKindEnum>;
  /** Case-insensitive `contains`. */
  iContains?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `endsWith`. */
  iEndsWith?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `startsWith`. */
  iStartsWith?: InputMaybe<Scalars['String']['input']>;
  ilike?: InputMaybe<Scalars['String']['input']>;
  /** Matches any one of these values (SQL `IN`) */
  inArray?: InputMaybe<Array<StepsKindEnum>>;
  /** When true, every comparison operator in this object matches case-insensitively — `eq`, `ne`, the ordering operators, `inArray`/`notInArray` and the pattern operators all compare `lower(column)` against `lower(operand)`. Applies only to the operators beside it; a nested `AND`/`OR`/`NOT` branch sets its own. */
  insensitive?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is not NULL */
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is NULL */
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  like?: InputMaybe<Scalars['String']['input']>;
  /** Less than */
  lt?: InputMaybe<StepsKindEnum>;
  /** Less than or equal to */
  lte?: InputMaybe<StepsKindEnum>;
  /** Not equal to */
  ne?: InputMaybe<StepsKindEnum>;
  notIlike?: InputMaybe<Scalars['String']['input']>;
  /** Matches none of these values (SQL `NOT IN`) */
  notInArray?: InputMaybe<Array<StepsKindEnum>>;
  notLike?: InputMaybe<Scalars['String']['input']>;
  /** Matches values starting with the given string. `%`, `_` and `\` are matched literally. */
  startsWith?: InputMaybe<Scalars['String']['input']>;
};

export type StringFilter = {
  /** Every branch matches */
  AND?: InputMaybe<Array<StringFilter>>;
  /** Negates the nested operators */
  NOT?: InputMaybe<StringFilter>;
  /** At least one branch matches; ANDed with any sibling operators */
  OR?: InputMaybe<Array<StringFilter>>;
  /** Matches values containing the given string. `%`, `_` and `\` are matched literally. */
  contains?: InputMaybe<Scalars['String']['input']>;
  /** Matches values ending with the given string. `%`, `_` and `\` are matched literally. */
  endsWith?: InputMaybe<Scalars['String']['input']>;
  /** Equal to */
  eq?: InputMaybe<Scalars['String']['input']>;
  /** Greater than */
  gt?: InputMaybe<Scalars['String']['input']>;
  /** Greater than or equal to */
  gte?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `contains`. */
  iContains?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `endsWith`. */
  iEndsWith?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `startsWith`. */
  iStartsWith?: InputMaybe<Scalars['String']['input']>;
  ilike?: InputMaybe<Scalars['String']['input']>;
  /** Matches any one of these values (SQL `IN`) */
  inArray?: InputMaybe<Array<Scalars['String']['input']>>;
  /** When true, every comparison operator in this object matches case-insensitively — `eq`, `ne`, the ordering operators, `inArray`/`notInArray` and the pattern operators all compare `lower(column)` against `lower(operand)`. Applies only to the operators beside it; a nested `AND`/`OR`/`NOT` branch sets its own. */
  insensitive?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is not NULL */
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is NULL */
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  like?: InputMaybe<Scalars['String']['input']>;
  /** Less than */
  lt?: InputMaybe<Scalars['String']['input']>;
  /** Less than or equal to */
  lte?: InputMaybe<Scalars['String']['input']>;
  /** Not equal to */
  ne?: InputMaybe<Scalars['String']['input']>;
  notIlike?: InputMaybe<Scalars['String']['input']>;
  /** Matches none of these values (SQL `NOT IN`) */
  notInArray?: InputMaybe<Array<Scalars['String']['input']>>;
  notLike?: InputMaybe<Scalars['String']['input']>;
  /** Matches values starting with the given string. `%`, `_` and `\` are matched literally. */
  startsWith?: InputMaybe<Scalars['String']['input']>;
};

export type Subscription = {
  /** Watches a run as it happens. Replays what the run has said so far, then follows it live, and completes when the run ends. Subscribing to a run that has not started waits for it; subscribing to one long finished ends straight away. */
  runEvents: RunEvent;
};


export type SubscriptionRunEventsArgs = {
  runId: Scalars['String']['input'];
};

export type Task = {
  createdAt: Scalars['DateTime']['output'];
  /** Opaque cursor of this row's position in the query's ordering. Pass it as `after` to resume from here. Only set on rows returned by a list query. */
  cursor?: Maybe<Scalars['String']['output']>;
  enabled: Scalars['Boolean']['output'];
  id: Scalars['String']['output'];
  model: Scalars['String']['output'];
  name: Scalars['String']['output'];
  prompt: Scalars['String']['output'];
  runs: Array<Run>;
  runsAggregate: RunAggregate;
  steps: Array<Step>;
  stepsAggregate: StepAggregate;
  systemPrompt: Scalars['String']['output'];
  triggers: Array<Trigger>;
  triggersAggregate: TriggerAggregate;
  updatedAt: Scalars['DateTime']['output'];
};


export type TaskRunsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  distinct?: InputMaybe<Array<RunDistinctColumn>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<RunOrderBy>;
  where?: InputMaybe<RunFilters>;
};


export type TaskRunsAggregateArgs = {
  where?: InputMaybe<RunFilters>;
};


export type TaskStepsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  distinct?: InputMaybe<Array<StepDistinctColumn>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<StepOrderBy>;
  where?: InputMaybe<StepFilters>;
};


export type TaskStepsAggregateArgs = {
  where?: InputMaybe<StepFilters>;
};


export type TaskTriggersArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  distinct?: InputMaybe<Array<TriggerDistinctColumn>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<TriggerOrderBy>;
  where?: InputMaybe<TriggerFilters>;
};


export type TaskTriggersAggregateArgs = {
  where?: InputMaybe<TriggerFilters>;
};

export type TaskAggregate = {
  count: Scalars['Int']['output'];
  countDistinct?: Maybe<TaskCountDistinctAggregate>;
  countNonNull?: Maybe<TaskCountNonNullAggregate>;
  max?: Maybe<TaskMaxAggregate>;
  min?: Maybe<TaskMinAggregate>;
};

export type TaskCountDistinctAggregate = {
  createdAt: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  model: Scalars['Int']['output'];
  name: Scalars['Int']['output'];
  prompt: Scalars['Int']['output'];
  systemPrompt: Scalars['Int']['output'];
  updatedAt: Scalars['Int']['output'];
};

export type TaskCountDistinctHaving = {
  createdAt?: InputMaybe<AggregateNumberFilter>;
  id?: InputMaybe<AggregateNumberFilter>;
  model?: InputMaybe<AggregateNumberFilter>;
  name?: InputMaybe<AggregateNumberFilter>;
  prompt?: InputMaybe<AggregateNumberFilter>;
  systemPrompt?: InputMaybe<AggregateNumberFilter>;
  updatedAt?: InputMaybe<AggregateNumberFilter>;
};

export type TaskCountNonNullAggregate = {
  createdAt: Scalars['Int']['output'];
  enabled: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  model: Scalars['Int']['output'];
  name: Scalars['Int']['output'];
  prompt: Scalars['Int']['output'];
  systemPrompt: Scalars['Int']['output'];
  updatedAt: Scalars['Int']['output'];
};

export type TaskCountNonNullHaving = {
  createdAt?: InputMaybe<AggregateNumberFilter>;
  enabled?: InputMaybe<AggregateNumberFilter>;
  id?: InputMaybe<AggregateNumberFilter>;
  model?: InputMaybe<AggregateNumberFilter>;
  name?: InputMaybe<AggregateNumberFilter>;
  prompt?: InputMaybe<AggregateNumberFilter>;
  systemPrompt?: InputMaybe<AggregateNumberFilter>;
  updatedAt?: InputMaybe<AggregateNumberFilter>;
};

/** Columns of Task that a query can be made distinct on */
export enum TaskDistinctColumn {
  CreatedAt = 'createdAt',
  Enabled = 'enabled',
  Id = 'id',
  Model = 'model',
  Name = 'name',
  Prompt = 'prompt',
  SystemPrompt = 'systemPrompt',
  UpdatedAt = 'updatedAt'
}

export type TaskFilters = {
  /** Every branch matches */
  AND?: InputMaybe<Array<TaskFilters>>;
  /** Negates the nested filters */
  NOT?: InputMaybe<TaskFilters>;
  /** At least one branch matches; ANDed with any sibling fields */
  OR?: InputMaybe<Array<TaskFilters>>;
  createdAt?: InputMaybe<DateTimeFilter>;
  enabled?: InputMaybe<BooleanFilter>;
  id?: InputMaybe<StringFilter>;
  model?: InputMaybe<StringFilter>;
  name?: InputMaybe<StringFilter>;
  prompt?: InputMaybe<StringFilter>;
  runs?: InputMaybe<RunListRelationFilter>;
  steps?: InputMaybe<StepListRelationFilter>;
  systemPrompt?: InputMaybe<StringFilter>;
  triggers?: InputMaybe<TriggerListRelationFilter>;
  updatedAt?: InputMaybe<DateTimeFilter>;
};

export type TaskGroupBy = {
  count: Scalars['Int']['output'];
  countDistinct?: Maybe<TaskCountDistinctAggregate>;
  countNonNull?: Maybe<TaskCountNonNullAggregate>;
  group: TaskGroupKeys;
  max?: Maybe<TaskMaxAggregate>;
  min?: Maybe<TaskMinAggregate>;
};

/** Columns of Task that a query can group by */
export enum TaskGroupByColumn {
  CreatedAt = 'createdAt',
  Enabled = 'enabled',
  Id = 'id',
  Model = 'model',
  Name = 'name',
  Prompt = 'prompt',
  SystemPrompt = 'systemPrompt',
  UpdatedAt = 'updatedAt'
}

/** The grouped column values of one Task group. A column the query did not group by is null. */
export type TaskGroupKeys = {
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  enabled?: Maybe<Scalars['Boolean']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  model?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  prompt?: Maybe<Scalars['String']['output']>;
  systemPrompt?: Maybe<Scalars['String']['output']>;
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
};

/** Filters Task groups by their aggregated values */
export type TaskHaving = {
  /** Filters groups by how many rows they contain */
  count?: InputMaybe<AggregateNumberFilter>;
  countDistinct?: InputMaybe<TaskCountDistinctHaving>;
  countNonNull?: InputMaybe<TaskCountNonNullHaving>;
};

export type TaskMaxAggregate = {
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  model?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  prompt?: Maybe<Scalars['String']['output']>;
  systemPrompt?: Maybe<Scalars['String']['output']>;
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
};

export type TaskMinAggregate = {
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  model?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  prompt?: Maybe<Scalars['String']['output']>;
  systemPrompt?: Maybe<Scalars['String']['output']>;
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
};

export type TaskOrderBy = {
  createdAt?: InputMaybe<InnerOrder>;
  enabled?: InputMaybe<InnerOrder>;
  id?: InputMaybe<InnerOrder>;
  model?: InputMaybe<InnerOrder>;
  name?: InputMaybe<InnerOrder>;
  prompt?: InputMaybe<InnerOrder>;
  systemPrompt?: InputMaybe<InnerOrder>;
  updatedAt?: InputMaybe<InnerOrder>;
};

export type Trigger = {
  config?: Maybe<Scalars['JSON']['output']>;
  createdAt: Scalars['DateTime']['output'];
  cron: Scalars['String']['output'];
  /** Opaque cursor of this row's position in the query's ordering. Pass it as `after` to resume from here. Only set on rows returned by a list query. */
  cursor?: Maybe<Scalars['String']['output']>;
  enabled: Scalars['Boolean']['output'];
  event: Scalars['String']['output'];
  id: Scalars['String']['output'];
  kind: TriggersKindEnum;
  runs: Array<Run>;
  runsAggregate: RunAggregate;
  task: Task;
  taskId: Scalars['String']['output'];
  timezone: Scalars['String']['output'];
};


export type TriggerRunsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  distinct?: InputMaybe<Array<RunDistinctColumn>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<RunOrderBy>;
  where?: InputMaybe<RunFilters>;
};


export type TriggerRunsAggregateArgs = {
  where?: InputMaybe<RunFilters>;
};


export type TriggerTaskArgs = {
  where?: InputMaybe<TaskFilters>;
};

export type TriggerAggregate = {
  count: Scalars['Int']['output'];
  countDistinct?: Maybe<TriggerCountDistinctAggregate>;
  countNonNull?: Maybe<TriggerCountNonNullAggregate>;
  max?: Maybe<TriggerMaxAggregate>;
  min?: Maybe<TriggerMinAggregate>;
};

export type TriggerCountDistinctAggregate = {
  createdAt: Scalars['Int']['output'];
  cron: Scalars['Int']['output'];
  event: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  kind: Scalars['Int']['output'];
  taskId: Scalars['Int']['output'];
  timezone: Scalars['Int']['output'];
};

export type TriggerCountDistinctHaving = {
  createdAt?: InputMaybe<AggregateNumberFilter>;
  cron?: InputMaybe<AggregateNumberFilter>;
  event?: InputMaybe<AggregateNumberFilter>;
  id?: InputMaybe<AggregateNumberFilter>;
  kind?: InputMaybe<AggregateNumberFilter>;
  taskId?: InputMaybe<AggregateNumberFilter>;
  timezone?: InputMaybe<AggregateNumberFilter>;
};

export type TriggerCountNonNullAggregate = {
  config: Scalars['Int']['output'];
  createdAt: Scalars['Int']['output'];
  cron: Scalars['Int']['output'];
  enabled: Scalars['Int']['output'];
  event: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  kind: Scalars['Int']['output'];
  taskId: Scalars['Int']['output'];
  timezone: Scalars['Int']['output'];
};

export type TriggerCountNonNullHaving = {
  config?: InputMaybe<AggregateNumberFilter>;
  createdAt?: InputMaybe<AggregateNumberFilter>;
  cron?: InputMaybe<AggregateNumberFilter>;
  enabled?: InputMaybe<AggregateNumberFilter>;
  event?: InputMaybe<AggregateNumberFilter>;
  id?: InputMaybe<AggregateNumberFilter>;
  kind?: InputMaybe<AggregateNumberFilter>;
  taskId?: InputMaybe<AggregateNumberFilter>;
  timezone?: InputMaybe<AggregateNumberFilter>;
};

/** Columns of Trigger that a query can be made distinct on */
export enum TriggerDistinctColumn {
  Config = 'config',
  CreatedAt = 'createdAt',
  Cron = 'cron',
  Enabled = 'enabled',
  Event = 'event',
  Id = 'id',
  Kind = 'kind',
  TaskId = 'taskId',
  Timezone = 'timezone'
}

export type TriggerFilters = {
  /** Every branch matches */
  AND?: InputMaybe<Array<TriggerFilters>>;
  /** Negates the nested filters */
  NOT?: InputMaybe<TriggerFilters>;
  /** At least one branch matches; ANDed with any sibling fields */
  OR?: InputMaybe<Array<TriggerFilters>>;
  config?: InputMaybe<JsonFilter>;
  createdAt?: InputMaybe<DateTimeFilter>;
  cron?: InputMaybe<StringFilter>;
  enabled?: InputMaybe<BooleanFilter>;
  event?: InputMaybe<StringFilter>;
  id?: InputMaybe<StringFilter>;
  kind?: InputMaybe<TriggersKindEnumFilter>;
  runs?: InputMaybe<RunListRelationFilter>;
  /** Matches rows whose task matches these filters */
  task?: InputMaybe<TaskFilters>;
  taskId?: InputMaybe<StringFilter>;
  timezone?: InputMaybe<StringFilter>;
};

export type TriggerGroupBy = {
  count: Scalars['Int']['output'];
  countDistinct?: Maybe<TriggerCountDistinctAggregate>;
  countNonNull?: Maybe<TriggerCountNonNullAggregate>;
  group: TriggerGroupKeys;
  max?: Maybe<TriggerMaxAggregate>;
  min?: Maybe<TriggerMinAggregate>;
};

/** Columns of Trigger that a query can group by */
export enum TriggerGroupByColumn {
  CreatedAt = 'createdAt',
  Cron = 'cron',
  Enabled = 'enabled',
  Event = 'event',
  Id = 'id',
  Kind = 'kind',
  TaskId = 'taskId',
  Timezone = 'timezone'
}

/** The grouped column values of one Trigger group. A column the query did not group by is null. */
export type TriggerGroupKeys = {
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  cron?: Maybe<Scalars['String']['output']>;
  enabled?: Maybe<Scalars['Boolean']['output']>;
  event?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  kind?: Maybe<TriggersKindEnum>;
  taskId?: Maybe<Scalars['String']['output']>;
  timezone?: Maybe<Scalars['String']['output']>;
};

/** Filters Trigger groups by their aggregated values */
export type TriggerHaving = {
  /** Filters groups by how many rows they contain */
  count?: InputMaybe<AggregateNumberFilter>;
  countDistinct?: InputMaybe<TriggerCountDistinctHaving>;
  countNonNull?: InputMaybe<TriggerCountNonNullHaving>;
};

export type TriggerListRelationFilter = {
  /** Every related row matches */
  every?: InputMaybe<TriggerFilters>;
  /** No related row matches */
  none?: InputMaybe<TriggerFilters>;
  /** At least one related row matches */
  some?: InputMaybe<TriggerFilters>;
};

export type TriggerMaxAggregate = {
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  cron?: Maybe<Scalars['String']['output']>;
  event?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  kind?: Maybe<TriggersKindEnum>;
  taskId?: Maybe<Scalars['String']['output']>;
  timezone?: Maybe<Scalars['String']['output']>;
};

export type TriggerMinAggregate = {
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  cron?: Maybe<Scalars['String']['output']>;
  event?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  kind?: Maybe<TriggersKindEnum>;
  taskId?: Maybe<Scalars['String']['output']>;
  timezone?: Maybe<Scalars['String']['output']>;
};

export type TriggerOrderBy = {
  config?: InputMaybe<InnerOrder>;
  createdAt?: InputMaybe<InnerOrder>;
  cron?: InputMaybe<InnerOrder>;
  enabled?: InputMaybe<InnerOrder>;
  event?: InputMaybe<InnerOrder>;
  id?: InputMaybe<InnerOrder>;
  kind?: InputMaybe<InnerOrder>;
  /** Order by columns of the related task row */
  task?: InputMaybe<TaskOrderBy>;
  taskId?: InputMaybe<InnerOrder>;
  timezone?: InputMaybe<InnerOrder>;
};

export enum TriggersKindEnum {
  /** Value: cron */
  Cron = 'cron',
  /** Value: event */
  Event = 'event'
}

export type TriggersKindEnumFilter = {
  /** Every branch matches */
  AND?: InputMaybe<Array<TriggersKindEnumFilter>>;
  /** Negates the nested operators */
  NOT?: InputMaybe<TriggersKindEnumFilter>;
  /** At least one branch matches; ANDed with any sibling operators */
  OR?: InputMaybe<Array<TriggersKindEnumFilter>>;
  /** Matches values containing the given string. `%`, `_` and `\` are matched literally. */
  contains?: InputMaybe<Scalars['String']['input']>;
  /** Matches values ending with the given string. `%`, `_` and `\` are matched literally. */
  endsWith?: InputMaybe<Scalars['String']['input']>;
  /** Equal to */
  eq?: InputMaybe<TriggersKindEnum>;
  /** Greater than */
  gt?: InputMaybe<TriggersKindEnum>;
  /** Greater than or equal to */
  gte?: InputMaybe<TriggersKindEnum>;
  /** Case-insensitive `contains`. */
  iContains?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `endsWith`. */
  iEndsWith?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `startsWith`. */
  iStartsWith?: InputMaybe<Scalars['String']['input']>;
  ilike?: InputMaybe<Scalars['String']['input']>;
  /** Matches any one of these values (SQL `IN`) */
  inArray?: InputMaybe<Array<TriggersKindEnum>>;
  /** When true, every comparison operator in this object matches case-insensitively — `eq`, `ne`, the ordering operators, `inArray`/`notInArray` and the pattern operators all compare `lower(column)` against `lower(operand)`. Applies only to the operators beside it; a nested `AND`/`OR`/`NOT` branch sets its own. */
  insensitive?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is not NULL */
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is NULL */
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  like?: InputMaybe<Scalars['String']['input']>;
  /** Less than */
  lt?: InputMaybe<TriggersKindEnum>;
  /** Less than or equal to */
  lte?: InputMaybe<TriggersKindEnum>;
  /** Not equal to */
  ne?: InputMaybe<TriggersKindEnum>;
  notIlike?: InputMaybe<Scalars['String']['input']>;
  /** Matches none of these values (SQL `NOT IN`) */
  notInArray?: InputMaybe<Array<TriggersKindEnum>>;
  notLike?: InputMaybe<Scalars['String']['input']>;
  /** Matches values starting with the given string. `%`, `_` and `\` are matched literally. */
  startsWith?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateMcpServerInput = {
  args?: InputMaybe<Scalars['JSON']['input']>;
  command?: InputMaybe<Scalars['String']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  env?: InputMaybe<Scalars['JSON']['input']>;
  headers?: InputMaybe<Scalars['JSON']['input']>;
  id?: InputMaybe<Scalars['String']['input']>;
  label?: InputMaybe<Scalars['String']['input']>;
  slug?: InputMaybe<Scalars['String']['input']>;
  transport?: InputMaybe<McpServersTransportEnum>;
  url?: InputMaybe<Scalars['String']['input']>;
};

/** One entry of a batch update of McpServer: the rows `where` matches get this entry's `set` applied. */
export type UpdateMcpServerManyInput = {
  set: UpdateMcpServerInput;
  /** Rows this entry updates. An omitted filter updates every row. */
  where?: InputMaybe<McpServerFilters>;
};

export type UpdateSettingInput = {
  baseUrl?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['String']['input']>;
  maxTokens?: InputMaybe<Scalars['Int']['input']>;
  maxToolIterations?: InputMaybe<Scalars['Int']['input']>;
  model?: InputMaybe<Scalars['String']['input']>;
  systemPrompt?: InputMaybe<Scalars['String']['input']>;
  temperature?: InputMaybe<Scalars['Float']['input']>;
  toolDiscovery?: InputMaybe<SettingsToolDiscoveryEnum>;
  toolSelectModel?: InputMaybe<Scalars['String']['input']>;
};

/** One entry of a batch update of Setting: the rows `where` matches get this entry's `set` applied. */
export type UpdateSettingManyInput = {
  set: UpdateSettingInput;
  /** Rows this entry updates. An omitted filter updates every row. */
  where?: InputMaybe<SettingFilters>;
};

export type UpdateStepInput = {
  branch?: InputMaybe<Scalars['String']['input']>;
  cases?: InputMaybe<Scalars['JSON']['input']>;
  context?: InputMaybe<StepsContextEnum>;
  createdAt?: InputMaybe<Scalars['DateTime']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  id?: InputMaybe<Scalars['String']['input']>;
  kind?: InputMaybe<StepsKindEnum>;
  model?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  parentId?: InputMaybe<Scalars['String']['input']>;
  position?: InputMaybe<Scalars['Int']['input']>;
  prompt?: InputMaybe<Scalars['String']['input']>;
  systemPrompt?: InputMaybe<Scalars['String']['input']>;
  taskId?: InputMaybe<Scalars['String']['input']>;
};

/** One entry of a batch update of Step: the rows `where` matches get this entry's `set` applied. */
export type UpdateStepManyInput = {
  set: UpdateStepInput;
  /** Rows this entry updates. An omitted filter updates every row. */
  where?: InputMaybe<StepFilters>;
};

export type UpdateTaskInput = {
  createdAt?: InputMaybe<Scalars['DateTime']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  id?: InputMaybe<Scalars['String']['input']>;
  model?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  prompt?: InputMaybe<Scalars['String']['input']>;
  systemPrompt?: InputMaybe<Scalars['String']['input']>;
  updatedAt?: InputMaybe<Scalars['DateTime']['input']>;
};

/** One entry of a batch update of Task: the rows `where` matches get this entry's `set` applied. */
export type UpdateTaskManyInput = {
  set: UpdateTaskInput;
  /** Rows this entry updates. An omitted filter updates every row. */
  where?: InputMaybe<TaskFilters>;
};

export type UpdateTriggerInput = {
  config?: InputMaybe<Scalars['JSON']['input']>;
  createdAt?: InputMaybe<Scalars['DateTime']['input']>;
  cron?: InputMaybe<Scalars['String']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  event?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['String']['input']>;
  kind?: InputMaybe<TriggersKindEnum>;
  taskId?: InputMaybe<Scalars['String']['input']>;
  timezone?: InputMaybe<Scalars['String']['input']>;
};

/** One entry of a batch update of Trigger: the rows `where` matches get this entry's `set` applied. */
export type UpdateTriggerManyInput = {
  set: UpdateTriggerInput;
  /** Rows this entry updates. An omitted filter updates every row. */
  where?: InputMaybe<TriggerFilters>;
};

export type McpServersQueryVariables = Exact<{ [key: string]: never; }>;


export type McpServersQuery = { mcpServers: Array<{ id: string, slug: string, label: string, enabled: boolean, transport: McpServersTransportEnum, command: string, args?: unknown | null, env?: unknown | null, url: string, headers?: unknown | null }>, mcpStatus: Array<{ id: string, status: string, error: string, tools: Array<{ name: string, description: string }> }> };

export type CreateMcpServerMutationVariables = Exact<{
  values: CreateMcpServerInput;
}>;


export type CreateMcpServerMutation = { createMcpServer: { id: string } };

export type UpdateMcpServerMutationVariables = Exact<{
  id: Scalars['String']['input'];
  set: UpdateMcpServerInput;
}>;


export type UpdateMcpServerMutation = { updateMcpServerSingle?: { id: string } | null };

export type DeleteMcpServerMutationVariables = Exact<{
  id: Scalars['String']['input'];
}>;


export type DeleteMcpServerMutation = { deleteMcpServerSingle?: { id: string } | null };

export type TestMcpServerMutationVariables = Exact<{
  config: McpConnectionInput;
}>;


export type TestMcpServerMutation = { testMcpServer: { ok: boolean, error: string, tools: Array<{ name: string, description: string }> } };

export type ReconnectMcpMutationVariables = Exact<{ [key: string]: never; }>;


export type ReconnectMcpMutation = { reconnectMcp: Array<{ id: string, status: string, error: string }> };

export type RunsQueryVariables = Exact<{
  taskId?: InputMaybe<Scalars['String']['input']>;
}>;


export type RunsQuery = { runs: Array<{ id: string, taskId: string, status: RunsStatusEnum, startedAt: string, finishedAt?: string | null, output: string, error: string, toolCalls?: unknown | null, totalTokens: number, task: { name: string }, steps: Array<{ id: string, position: number, depth: number, name: string, kind: string, status: RunStepsStatusEnum, branch: string, output: string, error: string, toolCalls?: unknown | null, totalTokens: number }> }> };

export type DeleteRunMutationVariables = Exact<{
  id: Scalars['String']['input'];
}>;


export type DeleteRunMutation = { deleteRunSingle?: { id: string } | null };

export type RunEventsSubscriptionVariables = Exact<{
  runId: Scalars['String']['input'];
}>;


export type RunEventsSubscription = { runEvents: { seq: number, kind: string, text: string, name: string, step: string, ok?: boolean | null } };

export type SettingsQueryVariables = Exact<{ [key: string]: never; }>;


export type SettingsQuery = { settings: Array<{ id: string, baseUrl: string, model: string, systemPrompt: string, maxTokens: number, temperature: number, maxToolIterations: number, toolDiscovery: SettingsToolDiscoveryEnum, toolSelectModel: string }> };

export type ModelsQueryVariables = Exact<{ [key: string]: never; }>;


export type ModelsQuery = { models: Array<string> };

export type UpdateSettingsMutationVariables = Exact<{
  set: UpdateSettingInput;
}>;


export type UpdateSettingsMutation = { updateSettingSingle?: { id: string } | null };

export type SetApiKeyMutationVariables = Exact<{
  apiKey: Scalars['String']['input'];
}>;


export type SetApiKeyMutation = { setApiKey: boolean };

export type TaskFieldsFragment = { id: string, name: string, prompt: string, model: string, systemPrompt: string, enabled: boolean, updatedAt: string, triggers: Array<{ id: string, kind: TriggersKindEnum, cron: string, timezone: string, event: string, enabled: boolean }>, runs: Array<{ id: string, status: RunsStatusEnum, startedAt: string, finishedAt?: string | null }> };

export type StepFieldsFragment = { id: string, parentId?: string | null, branch: string, position: number, kind: StepsKindEnum, name: string, prompt: string, cases?: unknown | null, model: string, systemPrompt: string, context: StepsContextEnum, enabled: boolean };

export type TaskDetailFieldsFragment = { id: string, name: string, prompt: string, model: string, systemPrompt: string, enabled: boolean, updatedAt: string, steps: Array<{ id: string, parentId?: string | null, branch: string, position: number, kind: StepsKindEnum, name: string, prompt: string, cases?: unknown | null, model: string, systemPrompt: string, context: StepsContextEnum, enabled: boolean }>, triggers: Array<{ id: string, kind: TriggersKindEnum, cron: string, timezone: string, event: string, enabled: boolean }>, runs: Array<{ id: string, status: RunsStatusEnum, startedAt: string, finishedAt?: string | null }> };

export type TasksQueryVariables = Exact<{ [key: string]: never; }>;


export type TasksQuery = { tasks: Array<{ id: string, name: string, prompt: string, model: string, systemPrompt: string, enabled: boolean, updatedAt: string, triggers: Array<{ id: string, kind: TriggersKindEnum, cron: string, timezone: string, event: string, enabled: boolean }>, runs: Array<{ id: string, status: RunsStatusEnum, startedAt: string, finishedAt?: string | null }> }>, schedule: Array<{ triggerId: string, nextRun?: string | null }> };

export type TaskQueryVariables = Exact<{
  id: Scalars['String']['input'];
}>;


export type TaskQuery = { task?: { id: string, name: string, prompt: string, model: string, systemPrompt: string, enabled: boolean, updatedAt: string, steps: Array<{ id: string, parentId?: string | null, branch: string, position: number, kind: StepsKindEnum, name: string, prompt: string, cases?: unknown | null, model: string, systemPrompt: string, context: StepsContextEnum, enabled: boolean }>, triggers: Array<{ id: string, kind: TriggersKindEnum, cron: string, timezone: string, event: string, enabled: boolean }>, runs: Array<{ id: string, status: RunsStatusEnum, startedAt: string, finishedAt?: string | null }> } | null };

export type CreateTaskMutationVariables = Exact<{
  values: CreateTaskInput;
}>;


export type CreateTaskMutation = { createTask: { id: string, name: string, prompt: string, model: string, systemPrompt: string, enabled: boolean, updatedAt: string, triggers: Array<{ id: string, kind: TriggersKindEnum, cron: string, timezone: string, event: string, enabled: boolean }>, runs: Array<{ id: string, status: RunsStatusEnum, startedAt: string, finishedAt?: string | null }> } };

export type UpdateTaskMutationVariables = Exact<{
  id: Scalars['String']['input'];
  set: UpdateTaskInput;
}>;


export type UpdateTaskMutation = { updateTaskSingle?: { id: string, name: string, prompt: string, model: string, systemPrompt: string, enabled: boolean, updatedAt: string, triggers: Array<{ id: string, kind: TriggersKindEnum, cron: string, timezone: string, event: string, enabled: boolean }>, runs: Array<{ id: string, status: RunsStatusEnum, startedAt: string, finishedAt?: string | null }> } | null };

export type DeleteTaskMutationVariables = Exact<{
  id: Scalars['String']['input'];
}>;


export type DeleteTaskMutation = { deleteTaskSingle?: { id: string } | null };

export type SetTaskStepsMutationVariables = Exact<{
  taskId: Scalars['String']['input'];
  steps: Array<StepInput> | StepInput;
}>;


export type SetTaskStepsMutation = { setTaskSteps: Array<{ id: string, parentId?: string | null, branch: string, position: number, kind: StepsKindEnum, name: string, prompt: string, cases?: unknown | null, model: string, systemPrompt: string, context: StepsContextEnum, enabled: boolean }> };

export type CreateTriggerMutationVariables = Exact<{
  values: CreateTriggerInput;
}>;


export type CreateTriggerMutation = { createTrigger: { id: string } };

export type UpdateTriggerMutationVariables = Exact<{
  id: Scalars['String']['input'];
  set: UpdateTriggerInput;
}>;


export type UpdateTriggerMutation = { updateTriggerSingle?: { id: string } | null };

export type DeleteTriggerMutationVariables = Exact<{
  id: Scalars['String']['input'];
}>;


export type DeleteTriggerMutation = { deleteTriggerSingle?: { id: string } | null };

export type StopTaskMutationVariables = Exact<{
  taskId: Scalars['String']['input'];
}>;


export type StopTaskMutation = { stopTask: boolean };

export type RunTaskMutationVariables = Exact<{
  taskId: Scalars['String']['input'];
}>;


export type RunTaskMutation = { runTask: { id: string, status: RunsStatusEnum, error: string } };

export const TaskFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TaskFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Task"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"prompt"}},{"kind":"Field","name":{"kind":"Name","value":"model"}},{"kind":"Field","name":{"kind":"Name","value":"systemPrompt"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"triggers"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orderBy"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"createdAt"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"direction"},"value":{"kind":"EnumValue","value":"asc"}},{"kind":"ObjectField","name":{"kind":"Name","value":"priority"},"value":{"kind":"IntValue","value":"1"}}]}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"cron"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"event"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}}]}},{"kind":"Field","name":{"kind":"Name","value":"runs"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"IntValue","value":"1"}},{"kind":"Argument","name":{"kind":"Name","value":"orderBy"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"startedAt"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"direction"},"value":{"kind":"EnumValue","value":"desc"}},{"kind":"ObjectField","name":{"kind":"Name","value":"priority"},"value":{"kind":"IntValue","value":"1"}}]}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"finishedAt"}}]}}]}}]} as unknown as DocumentNode<TaskFieldsFragment, unknown>;
export const StepFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"StepFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Step"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"branch"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"prompt"}},{"kind":"Field","name":{"kind":"Name","value":"cases"}},{"kind":"Field","name":{"kind":"Name","value":"model"}},{"kind":"Field","name":{"kind":"Name","value":"systemPrompt"}},{"kind":"Field","name":{"kind":"Name","value":"context"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}}]}}]} as unknown as DocumentNode<StepFieldsFragment, unknown>;
export const TaskDetailFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TaskDetailFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Task"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"TaskFields"}},{"kind":"Field","name":{"kind":"Name","value":"steps"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orderBy"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"position"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"direction"},"value":{"kind":"EnumValue","value":"asc"}},{"kind":"ObjectField","name":{"kind":"Name","value":"priority"},"value":{"kind":"IntValue","value":"1"}}]}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"StepFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TaskFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Task"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"prompt"}},{"kind":"Field","name":{"kind":"Name","value":"model"}},{"kind":"Field","name":{"kind":"Name","value":"systemPrompt"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"triggers"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orderBy"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"createdAt"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"direction"},"value":{"kind":"EnumValue","value":"asc"}},{"kind":"ObjectField","name":{"kind":"Name","value":"priority"},"value":{"kind":"IntValue","value":"1"}}]}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"cron"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"event"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}}]}},{"kind":"Field","name":{"kind":"Name","value":"runs"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"IntValue","value":"1"}},{"kind":"Argument","name":{"kind":"Name","value":"orderBy"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"startedAt"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"direction"},"value":{"kind":"EnumValue","value":"desc"}},{"kind":"ObjectField","name":{"kind":"Name","value":"priority"},"value":{"kind":"IntValue","value":"1"}}]}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"finishedAt"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"StepFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Step"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"branch"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"prompt"}},{"kind":"Field","name":{"kind":"Name","value":"cases"}},{"kind":"Field","name":{"kind":"Name","value":"model"}},{"kind":"Field","name":{"kind":"Name","value":"systemPrompt"}},{"kind":"Field","name":{"kind":"Name","value":"context"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}}]}}]} as unknown as DocumentNode<TaskDetailFieldsFragment, unknown>;
export const McpServersDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"McpServers"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"mcpServers"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orderBy"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"slug"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"direction"},"value":{"kind":"EnumValue","value":"asc"}},{"kind":"ObjectField","name":{"kind":"Name","value":"priority"},"value":{"kind":"IntValue","value":"1"}}]}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"label"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"transport"}},{"kind":"Field","name":{"kind":"Name","value":"command"}},{"kind":"Field","name":{"kind":"Name","value":"args"}},{"kind":"Field","name":{"kind":"Name","value":"env"}},{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"headers"}}]}},{"kind":"Field","name":{"kind":"Name","value":"mcpStatus"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"error"}},{"kind":"Field","name":{"kind":"Name","value":"tools"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}}]}}]}}]}}]} as unknown as DocumentNode<McpServersQuery, McpServersQueryVariables>;
export const CreateMcpServerDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateMcpServer"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"values"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateMcpServerInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createMcpServer"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"values"},"value":{"kind":"Variable","name":{"kind":"Name","value":"values"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<CreateMcpServerMutation, CreateMcpServerMutationVariables>;
export const UpdateMcpServerDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateMcpServer"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"set"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateMcpServerInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateMcpServerSingle"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"where"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"id"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"eq"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}}]}},{"kind":"Argument","name":{"kind":"Name","value":"set"},"value":{"kind":"Variable","name":{"kind":"Name","value":"set"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<UpdateMcpServerMutation, UpdateMcpServerMutationVariables>;
export const DeleteMcpServerDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteMcpServer"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteMcpServerSingle"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"where"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"id"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"eq"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteMcpServerMutation, DeleteMcpServerMutationVariables>;
export const TestMcpServerDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"TestMcpServer"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"config"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"McpConnectionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"testMcpServer"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"config"},"value":{"kind":"Variable","name":{"kind":"Name","value":"config"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ok"}},{"kind":"Field","name":{"kind":"Name","value":"error"}},{"kind":"Field","name":{"kind":"Name","value":"tools"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}}]}}]}}]}}]} as unknown as DocumentNode<TestMcpServerMutation, TestMcpServerMutationVariables>;
export const ReconnectMcpDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ReconnectMcp"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reconnectMcp"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"error"}}]}}]}}]} as unknown as DocumentNode<ReconnectMcpMutation, ReconnectMcpMutationVariables>;
export const RunsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Runs"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"taskId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runs"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"IntValue","value":"100"}},{"kind":"Argument","name":{"kind":"Name","value":"where"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"taskId"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"eq"},"value":{"kind":"Variable","name":{"kind":"Name","value":"taskId"}}}]}}]}},{"kind":"Argument","name":{"kind":"Name","value":"orderBy"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"startedAt"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"direction"},"value":{"kind":"EnumValue","value":"desc"}},{"kind":"ObjectField","name":{"kind":"Name","value":"priority"},"value":{"kind":"IntValue","value":"1"}}]}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"taskId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"finishedAt"}},{"kind":"Field","name":{"kind":"Name","value":"output"}},{"kind":"Field","name":{"kind":"Name","value":"error"}},{"kind":"Field","name":{"kind":"Name","value":"toolCalls"}},{"kind":"Field","name":{"kind":"Name","value":"totalTokens"}},{"kind":"Field","name":{"kind":"Name","value":"task"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"steps"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orderBy"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"position"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"direction"},"value":{"kind":"EnumValue","value":"asc"}},{"kind":"ObjectField","name":{"kind":"Name","value":"priority"},"value":{"kind":"IntValue","value":"1"}}]}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"depth"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"branch"}},{"kind":"Field","name":{"kind":"Name","value":"output"}},{"kind":"Field","name":{"kind":"Name","value":"error"}},{"kind":"Field","name":{"kind":"Name","value":"toolCalls"}},{"kind":"Field","name":{"kind":"Name","value":"totalTokens"}}]}}]}}]}}]} as unknown as DocumentNode<RunsQuery, RunsQueryVariables>;
export const DeleteRunDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteRun"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteRunSingle"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"where"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"id"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"eq"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteRunMutation, DeleteRunMutationVariables>;
export const RunEventsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"RunEvents"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"runId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runEvents"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"runId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"runId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"seq"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"text"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"step"}},{"kind":"Field","name":{"kind":"Name","value":"ok"}}]}}]}}]} as unknown as DocumentNode<RunEventsSubscription, RunEventsSubscriptionVariables>;
export const SettingsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Settings"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"settings"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"baseUrl"}},{"kind":"Field","name":{"kind":"Name","value":"model"}},{"kind":"Field","name":{"kind":"Name","value":"systemPrompt"}},{"kind":"Field","name":{"kind":"Name","value":"maxTokens"}},{"kind":"Field","name":{"kind":"Name","value":"temperature"}},{"kind":"Field","name":{"kind":"Name","value":"maxToolIterations"}},{"kind":"Field","name":{"kind":"Name","value":"toolDiscovery"}},{"kind":"Field","name":{"kind":"Name","value":"toolSelectModel"}}]}}]}}]} as unknown as DocumentNode<SettingsQuery, SettingsQueryVariables>;
export const ModelsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Models"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"models"}}]}}]} as unknown as DocumentNode<ModelsQuery, ModelsQueryVariables>;
export const UpdateSettingsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateSettings"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"set"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateSettingInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateSettingSingle"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"where"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"id"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"eq"},"value":{"kind":"StringValue","value":"default","block":false}}]}}]}},{"kind":"Argument","name":{"kind":"Name","value":"set"},"value":{"kind":"Variable","name":{"kind":"Name","value":"set"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<UpdateSettingsMutation, UpdateSettingsMutationVariables>;
export const SetApiKeyDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetApiKey"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"apiKey"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setApiKey"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"apiKey"},"value":{"kind":"Variable","name":{"kind":"Name","value":"apiKey"}}}]}]}}]} as unknown as DocumentNode<SetApiKeyMutation, SetApiKeyMutationVariables>;
export const TasksDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Tasks"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"tasks"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orderBy"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"name"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"direction"},"value":{"kind":"EnumValue","value":"asc"}},{"kind":"ObjectField","name":{"kind":"Name","value":"priority"},"value":{"kind":"IntValue","value":"1"}}]}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"TaskFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"schedule"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"triggerId"}},{"kind":"Field","name":{"kind":"Name","value":"nextRun"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TaskFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Task"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"prompt"}},{"kind":"Field","name":{"kind":"Name","value":"model"}},{"kind":"Field","name":{"kind":"Name","value":"systemPrompt"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"triggers"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orderBy"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"createdAt"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"direction"},"value":{"kind":"EnumValue","value":"asc"}},{"kind":"ObjectField","name":{"kind":"Name","value":"priority"},"value":{"kind":"IntValue","value":"1"}}]}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"cron"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"event"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}}]}},{"kind":"Field","name":{"kind":"Name","value":"runs"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"IntValue","value":"1"}},{"kind":"Argument","name":{"kind":"Name","value":"orderBy"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"startedAt"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"direction"},"value":{"kind":"EnumValue","value":"desc"}},{"kind":"ObjectField","name":{"kind":"Name","value":"priority"},"value":{"kind":"IntValue","value":"1"}}]}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"finishedAt"}}]}}]}}]} as unknown as DocumentNode<TasksQuery, TasksQueryVariables>;
export const TaskDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Task"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"task"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"where"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"id"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"eq"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"TaskDetailFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TaskFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Task"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"prompt"}},{"kind":"Field","name":{"kind":"Name","value":"model"}},{"kind":"Field","name":{"kind":"Name","value":"systemPrompt"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"triggers"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orderBy"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"createdAt"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"direction"},"value":{"kind":"EnumValue","value":"asc"}},{"kind":"ObjectField","name":{"kind":"Name","value":"priority"},"value":{"kind":"IntValue","value":"1"}}]}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"cron"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"event"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}}]}},{"kind":"Field","name":{"kind":"Name","value":"runs"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"IntValue","value":"1"}},{"kind":"Argument","name":{"kind":"Name","value":"orderBy"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"startedAt"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"direction"},"value":{"kind":"EnumValue","value":"desc"}},{"kind":"ObjectField","name":{"kind":"Name","value":"priority"},"value":{"kind":"IntValue","value":"1"}}]}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"finishedAt"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"StepFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Step"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"branch"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"prompt"}},{"kind":"Field","name":{"kind":"Name","value":"cases"}},{"kind":"Field","name":{"kind":"Name","value":"model"}},{"kind":"Field","name":{"kind":"Name","value":"systemPrompt"}},{"kind":"Field","name":{"kind":"Name","value":"context"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TaskDetailFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Task"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"TaskFields"}},{"kind":"Field","name":{"kind":"Name","value":"steps"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orderBy"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"position"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"direction"},"value":{"kind":"EnumValue","value":"asc"}},{"kind":"ObjectField","name":{"kind":"Name","value":"priority"},"value":{"kind":"IntValue","value":"1"}}]}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"StepFields"}}]}}]}}]} as unknown as DocumentNode<TaskQuery, TaskQueryVariables>;
export const CreateTaskDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateTask"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"values"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateTaskInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createTask"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"values"},"value":{"kind":"Variable","name":{"kind":"Name","value":"values"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"TaskFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TaskFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Task"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"prompt"}},{"kind":"Field","name":{"kind":"Name","value":"model"}},{"kind":"Field","name":{"kind":"Name","value":"systemPrompt"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"triggers"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orderBy"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"createdAt"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"direction"},"value":{"kind":"EnumValue","value":"asc"}},{"kind":"ObjectField","name":{"kind":"Name","value":"priority"},"value":{"kind":"IntValue","value":"1"}}]}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"cron"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"event"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}}]}},{"kind":"Field","name":{"kind":"Name","value":"runs"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"IntValue","value":"1"}},{"kind":"Argument","name":{"kind":"Name","value":"orderBy"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"startedAt"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"direction"},"value":{"kind":"EnumValue","value":"desc"}},{"kind":"ObjectField","name":{"kind":"Name","value":"priority"},"value":{"kind":"IntValue","value":"1"}}]}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"finishedAt"}}]}}]}}]} as unknown as DocumentNode<CreateTaskMutation, CreateTaskMutationVariables>;
export const UpdateTaskDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateTask"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"set"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateTaskInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateTaskSingle"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"where"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"id"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"eq"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}}]}},{"kind":"Argument","name":{"kind":"Name","value":"set"},"value":{"kind":"Variable","name":{"kind":"Name","value":"set"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"TaskFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TaskFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Task"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"prompt"}},{"kind":"Field","name":{"kind":"Name","value":"model"}},{"kind":"Field","name":{"kind":"Name","value":"systemPrompt"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"triggers"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"orderBy"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"createdAt"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"direction"},"value":{"kind":"EnumValue","value":"asc"}},{"kind":"ObjectField","name":{"kind":"Name","value":"priority"},"value":{"kind":"IntValue","value":"1"}}]}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"cron"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"event"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}}]}},{"kind":"Field","name":{"kind":"Name","value":"runs"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"IntValue","value":"1"}},{"kind":"Argument","name":{"kind":"Name","value":"orderBy"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"startedAt"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"direction"},"value":{"kind":"EnumValue","value":"desc"}},{"kind":"ObjectField","name":{"kind":"Name","value":"priority"},"value":{"kind":"IntValue","value":"1"}}]}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"finishedAt"}}]}}]}}]} as unknown as DocumentNode<UpdateTaskMutation, UpdateTaskMutationVariables>;
export const DeleteTaskDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteTask"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteTaskSingle"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"where"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"id"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"eq"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteTaskMutation, DeleteTaskMutationVariables>;
export const SetTaskStepsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetTaskSteps"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"taskId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"steps"}},"type":{"kind":"NonNullType","type":{"kind":"ListType","type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"StepInput"}}}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setTaskSteps"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"taskId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"taskId"}}},{"kind":"Argument","name":{"kind":"Name","value":"steps"},"value":{"kind":"Variable","name":{"kind":"Name","value":"steps"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"StepFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"StepFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Step"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"branch"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"prompt"}},{"kind":"Field","name":{"kind":"Name","value":"cases"}},{"kind":"Field","name":{"kind":"Name","value":"model"}},{"kind":"Field","name":{"kind":"Name","value":"systemPrompt"}},{"kind":"Field","name":{"kind":"Name","value":"context"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}}]}}]} as unknown as DocumentNode<SetTaskStepsMutation, SetTaskStepsMutationVariables>;
export const CreateTriggerDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateTrigger"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"values"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateTriggerInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createTrigger"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"values"},"value":{"kind":"Variable","name":{"kind":"Name","value":"values"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<CreateTriggerMutation, CreateTriggerMutationVariables>;
export const UpdateTriggerDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateTrigger"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"set"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateTriggerInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateTriggerSingle"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"where"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"id"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"eq"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}}]}},{"kind":"Argument","name":{"kind":"Name","value":"set"},"value":{"kind":"Variable","name":{"kind":"Name","value":"set"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<UpdateTriggerMutation, UpdateTriggerMutationVariables>;
export const DeleteTriggerDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteTrigger"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteTriggerSingle"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"where"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"id"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"eq"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteTriggerMutation, DeleteTriggerMutationVariables>;
export const StopTaskDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"StopTask"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"taskId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"stopTask"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"taskId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"taskId"}}}]}]}}]} as unknown as DocumentNode<StopTaskMutation, StopTaskMutationVariables>;
export const RunTaskDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RunTask"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"taskId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runTask"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"taskId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"taskId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"error"}}]}}]}}]} as unknown as DocumentNode<RunTaskMutation, RunTaskMutationVariables>;