ALTER TABLE todos ADD COLUMN source_id TEXT;
                  ALTER TABLE todos ADD COLUMN external_id TEXT;
                  ALTER TABLE todos ADD COLUMN url TEXT;
                  CREATE UNIQUE INDEX IF NOT EXISTS todos_source_item
                    ON todos (source_id, external_id);