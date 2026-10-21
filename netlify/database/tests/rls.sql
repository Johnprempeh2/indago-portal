\set ON_ERROR_STOP on
BEGIN;
INSERT INTO indago.members(email,user_id,role) VALUES
 ('editor@example.test','editor-1','editor'),
 ('viewer@example.test','viewer-1','viewer');
INSERT INTO indago.sheets VALUES
 ('register:Client Findings','Client Findings ','test','["ID","Area","Class","Original","Source","Status"]','[0,1,2,3,4]',1),
 ('register:Information Requests','Information Requests ','test','["ID","Request","Source","Status"]','[0,1,2]',2),
 ('risks','Risks & Issues','test','["ID","Risk"]','[0]',3),
 ('settings','Portal Settings','test','["Setting"]','[0]',4);
INSERT INTO indago.records(id,sheet_id,position,source_values) VALUES
 ('finding-1','register:Client Findings',1,'["F-1","Area","Class","Original","Source","Open"]'),
 ('request-1','register:Information Requests',1,'["Q-1","Request","Source","Open"]'),
 ('settings','settings',1,'["settings"]');
DO $$ BEGIN
  BEGIN
    UPDATE indago.sheets SET locked_columns='[0]' WHERE id='register:Client Findings';
    RAISE EXCEPTION 'missing client locks accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE indago.sheets SET locked_columns='[0]' WHERE id='register:Information Requests';
    RAISE EXCEPTION 'missing request locks accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
DO $$ BEGIN
  BEGIN
    INSERT INTO indago.sheets VALUES ('bad','Bad','test','["ID"]','["0"]',5);
    RAISE EXCEPTION 'string locked index accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
DO $$ BEGIN
  PERFORM set_config('indago.user_id','editor-1',true);
  BEGIN
    UPDATE indago.records SET source_values='["F-1","Area","Class","Changed","Source","Open"]' WHERE id='finding-1';
    RAISE EXCEPTION 'source row changed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
SET LOCAL ROLE indago_app;
SELECT set_config('indago.user_id','outsider-1',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM indago.records) <> 0 THEN RAISE EXCEPTION 'uninvited read records'; END IF;
  IF (SELECT count(*) FROM indago.sheets) <> 0 THEN RAISE EXCEPTION 'uninvited read sheets'; END IF;
  IF (SELECT count(*) FROM indago.history) <> 0 THEN RAISE EXCEPTION 'uninvited read history'; END IF;
END $$;
SELECT set_config('indago.user_id','viewer-1',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM indago.records) <> 3 THEN RAISE EXCEPTION 'viewer cannot read'; END IF;
  IF (SELECT count(*) FROM indago.members) <> 1 THEN RAISE EXCEPTION 'viewer sees another member'; END IF;
  IF (SELECT count(*) FROM indago.records WHERE id='finding-1' AND edits='{}'::jsonb) <> 1 THEN
    RAISE EXCEPTION 'viewer source missing';
  END IF;
  BEGIN
    UPDATE indago.records SET edits='{"5":"Done"}' WHERE id='finding-1';
    IF FOUND THEN RAISE EXCEPTION 'viewer wrote'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO indago.records(id,sheet_id,position,source_values)
      VALUES('risk-viewer','risks',1,'["R-1","Risk"]');
    RAISE EXCEPTION 'viewer inserted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('indago.user_id','editor-1',true);
DO $$ BEGIN
  BEGIN
    UPDATE indago.records SET edits='{"3":"Changed"}' WHERE id='finding-1';
    RAISE EXCEPTION 'locked finding text changed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE indago.records SET edits='{"0":"Changed"}' WHERE id='request-1';
    RAISE EXCEPTION 'locked request field changed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE indago.records SET changed_at = now() WHERE id='finding-1';
    RAISE EXCEPTION 'editor changed audit column';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM indago.records WHERE id='finding-1';
    RAISE EXCEPTION 'editor deleted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
UPDATE indago.records SET edits='{"5":"Done"}' WHERE id='finding-1';
UPDATE indago.records SET edits='{"kickoff":"2026-10-20"}' WHERE id='settings';
INSERT INTO indago.records(id,sheet_id,position,source_values)
  VALUES('risk-1','risks',1,'["R-1","Example risk"]');
DO $$ BEGIN
  IF (SELECT count(*) FROM indago.history WHERE actor_id='editor-1'
      AND actor_email='editor@example.test') <> 3 THEN RAISE EXCEPTION 'audit actor missing'; END IF;
  IF (SELECT version FROM indago.records WHERE id='finding-1') <> 2 THEN
    RAISE EXCEPTION 'version not advanced'; END IF;
END $$;
SELECT set_config('indago.user_id','viewer-1',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM indago.history) <> 3 THEN RAISE EXCEPTION 'viewer cannot read history'; END IF;
END $$;
SELECT set_config('indago.user_id','outsider-1',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM indago.history) <> 0 THEN RAISE EXCEPTION 'outsider read history'; END IF;
END $$;
SELECT set_config('indago.user_id','open-access',true);
SELECT set_config('indago.open_access','on',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM indago.records) <> 4 THEN RAISE EXCEPTION 'open access cannot read'; END IF;
  BEGIN
    UPDATE indago.records SET edits='{"3":"Changed"}' WHERE id='finding-1';
    RAISE EXCEPTION 'open access changed locked finding field';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE indago.records SET edits='{"0":"Changed"}' WHERE id='request-1';
    RAISE EXCEPTION 'open access changed locked request field';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
UPDATE indago.records SET edits='{"5":"Open edit"}' WHERE id='finding-1';
INSERT INTO indago.records(id,sheet_id,position,source_values)
  VALUES('risk-open','risks',2,'["R-2","Open access risk"]');
DO $$ BEGIN
  IF (SELECT count(*) FROM indago.history WHERE actor_id='open-access'
      AND actor_email='Open access') <> 2 THEN RAISE EXCEPTION 'open access audit actor missing'; END IF;
END $$;
SELECT set_config('indago.open_access','off',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM indago.records) <> 0 THEN RAISE EXCEPTION 'open access stayed enabled'; END IF;
END $$;
ROLLBACK;
SELECT 'Indago RLS, locks, audit and invitation checks passed' AS result;
