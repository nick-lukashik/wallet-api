-- TRUNCATE skips row triggers, so the refs need a statement trigger like the ledger's.
-- Without the refs the same operation would post a second time; the index is the
-- second line: one ref, one ledger row.
CREATE UNIQUE INDEX "wallet_tx_ref_key" ON "wallet_tx" USING btree ("ref");
--> statement-breakpoint
CREATE TRIGGER wallet_refs_no_truncate BEFORE TRUNCATE ON wallet_refs FOR EACH STATEMENT EXECUTE FUNCTION append_only();
