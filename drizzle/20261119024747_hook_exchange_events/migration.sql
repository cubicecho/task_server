-- agent-core 6 and agent-mcp-pool 4 call a step's two hook points beforeExchange and
-- afterExchange, with no aliases: a row still naming beforeTurn or afterTurn would stop
-- validating and its hooks would never fire.
UPDATE "mcp_servers"
SET "hooks" = (
  SELECT jsonb_agg(
    CASE "hook"->>'on'
      WHEN 'beforeTurn' THEN jsonb_set("hook", '{on}', '"beforeExchange"')
      WHEN 'afterTurn' THEN jsonb_set("hook", '{on}', '"afterExchange"')
      ELSE "hook"
    END
    ORDER BY "position"
  )
  FROM jsonb_array_elements("hooks") WITH ORDINALITY AS "each"("hook", "position")
)
WHERE jsonb_typeof("hooks") = 'array'
  AND ("hooks" @> '[{"on": "beforeTurn"}]' OR "hooks" @> '[{"on": "afterTurn"}]');
