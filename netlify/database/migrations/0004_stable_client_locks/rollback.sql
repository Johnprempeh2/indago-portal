ALTER TABLE indago.sheets DROP CONSTRAINT required_client_locks;
ALTER TABLE indago.sheets ADD CONSTRAINT required_client_locks CHECK (
  (title <> 'Client Findings' OR locked_columns @> '[0,1,2,3,4]'::jsonb)
  AND
  (title <> 'Information Requests' OR locked_columns @> '[0,1,2]'::jsonb)
);
