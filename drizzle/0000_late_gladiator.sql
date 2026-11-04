CREATE TABLE "inbox" (
	"consumer" text NOT NULL,
	"event_id" uuid NOT NULL,
	"type" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_consumer_event_id_pk" PRIMARY KEY("consumer","event_id")
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"exchange" text NOT NULL,
	"envelope" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "system_accounts" (
	"code" text NOT NULL,
	"unit" text NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "system_accounts_code_unit_pk" PRIMARY KEY("code","unit")
);
--> statement-breakpoint
CREATE TABLE "wallet_refs" (
	"ref" text PRIMARY KEY NOT NULL,
	"operation" text NOT NULL,
	"tx_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_tx" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"unit" text NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"object_ref" text,
	"ref" text NOT NULL,
	"amount" bigint NOT NULL,
	"balance_before" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"wallet_version" integer NOT NULL,
	"counter_account" text NOT NULL,
	"reason" text,
	"actor_id" text,
	"correlation_id" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_tx_chain" CHECK ("wallet_tx"."balance_after" = "wallet_tx"."balance_before" + "wallet_tx"."amount"),
	CONSTRAINT "wallet_tx_amount_not_zero" CHECK ("wallet_tx"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"user_id" uuid NOT NULL,
	"unit" text NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_user_id_unit_pk" PRIMARY KEY("user_id","unit"),
	CONSTRAINT "wallets_balance_non_negative" CHECK ("wallets"."balance" >= 0)
);
--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox" USING btree ("available_at","created_at") WHERE "outbox"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "outbox_published_idx" ON "outbox" USING btree ("published_at") WHERE "outbox"."status" = 'published';--> statement-breakpoint
CREATE INDEX "wallet_tx_user_idx" ON "wallet_tx" USING btree ("user_id","unit","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);