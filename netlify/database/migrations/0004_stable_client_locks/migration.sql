-- The importer uses stable source sheet IDs. Titles are display text and may drift.
ALTER TABLE indago.sheets DROP CONSTRAINT required_client_locks;
ALTER TABLE indago.sheets ADD CONSTRAINT required_client_locks CHECK (
  (id <> 'register:Client Findings' OR locked_columns @> '[0,1,2,3,4]'::jsonb)
  AND
  (id <> 'register:Information Requests' OR locked_columns @> '[0,1,2]'::jsonb)
);
