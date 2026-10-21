-- Export NS-01 field values and history before rollback; this removes both.
DELETE FROM indago.history WHERE record_id IN
  (SELECT id FROM indago.records WHERE sheet_id = 'north-star-requests');
DELETE FROM indago.records WHERE sheet_id = 'north-star-requests';
DELETE FROM indago.sheets WHERE id = 'north-star-requests';
DROP POLICY editors_insert_project_rows ON indago.records;
CREATE POLICY editors_insert_project_rows ON indago.records FOR INSERT TO indago_app
  WITH CHECK (indago.can_edit() AND sheet_id IN (
    SELECT id FROM indago.sheets WHERE title IN
    ('Risks & Issues', 'New Deep Dive Evidence', 'Service Processes', 'Commercial Baseline',
     'Findings', 'Opportunities', 'Decisions', 'GDXP Traceability', 'Validation Log')
  ));
DROP TABLE indago.north_star_history;
DROP TABLE indago.north_star_fields;
DROP TABLE indago.north_star_template;
DROP FUNCTION indago.audit_north_star_field();
