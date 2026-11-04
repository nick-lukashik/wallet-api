-- The ledger and the idempotency refs are append-only for every role,
-- the owner of the tables included: corrections are new operations.
CREATE FUNCTION append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is append-only: % refused', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint
CREATE TRIGGER wallet_tx_append_only BEFORE UPDATE OR DELETE ON wallet_tx FOR EACH ROW EXECUTE FUNCTION append_only();
--> statement-breakpoint
CREATE TRIGGER wallet_tx_no_truncate BEFORE TRUNCATE ON wallet_tx FOR EACH STATEMENT EXECUTE FUNCTION append_only();
--> statement-breakpoint
CREATE TRIGGER wallet_refs_append_only BEFORE UPDATE OR DELETE ON wallet_refs FOR EACH ROW EXECUTE FUNCTION append_only();
